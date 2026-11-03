import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlashcardsView } from './components/FlashcardsView'
import { MessageList } from './components/MessageList'
import { OnboardingModal } from './components/OnboardingModal'
import { PushToTalkButton } from './components/PushToTalkButton'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { useRecorder } from './hooks/useRecorder'
import { useEngine } from './hooks/useEngine'
import {
  cancelSpeech,
  processChat,
  processVocab,
  speak,
  EmptyAudioError,
  ModelsNotReadyError,
  PipelineError,
  type TtsSettings,
} from './lib/engine'
import { DEFAULT_ASR_KEY } from './lib/asr'
import { DEFAULT_LLM_KEY } from './lib/llm'
import { defaultPhononVoice, langInfo } from './lib/langs'
import { conversation, onboarding } from './lib/store'
import { I18nProvider, makeT, setLibLang, type UiLang } from './i18n'
import type { TargetLang } from './lib/langs'
import type { ChatMessage, ChatResponse, Settings, Stage } from './types'

const SETTINGS_KEY = 'blablabot-settings'
const LEGACY_SETTINGS_KEY = 'german-tutor-web-settings'

function detectUiLang(): UiLang {
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

function defaultSettings(): Settings {
  return {
    uiLang: detectUiLang(),
    targetLang: 'de',
    theme: 'system',
    level: 'A2',
    llmModel: DEFAULT_LLM_KEY,
    asrModel: DEFAULT_ASR_KEY,
    ttsEngine: 'phonon',
    ttsVoices: {},
    phononBases: {},
    ttsSpeed: 1,
    showTranslation: true,
    extraPrompt: '',
    googleClientId: '',
    driveAutoSync: true,
  }
}

function loadSettings(): Settings {
  let raw = localStorage.getItem(SETTINGS_KEY)
  if (!raw) {
    // Migration from the German-only app settings key (german-tutor-web-settings)
    raw = localStorage.getItem(LEGACY_SETTINGS_KEY)
    if (raw) {
      try {
        localStorage.setItem(SETTINGS_KEY, raw)
      } catch {
        /* private mode: read without persisting */
      }
    }
  }
  if (!raw) return defaultSettings()
  try {
    const parsed = JSON.parse(raw) as Partial<Settings> & { ttsVoice?: string; phononBase?: string }
    const s: Settings = { ...defaultSettings(), ...parsed }
    if (parsed.ttsVoice && !parsed.ttsVoices) s.ttsVoices = { de: parsed.ttsVoice }
    if (parsed.phononBase && !parsed.phononBases) s.phononBases = { de: parsed.phononBase }
    delete (s as unknown as Record<string, unknown>).ttsVoice
    delete (s as unknown as Record<string, unknown>).phononBase
    return s
  } catch {
    return defaultSettings()
  }
}

/** Voice for the target language: saved value or the default */
function resolveVoice(settings: Settings, lang: TargetLang): string {
  const saved = settings.ttsVoices[lang]
  if (saved) return saved
  return settings.ttsEngine === 'phonon' ? defaultPhononVoice(lang) : ''
}

/** Phonon model base URL for the target language: saved value or the default */
function resolvePhononBase(settings: Settings, lang: TargetLang): string {
  return settings.phononBases[lang] || langInfo(lang).phononBase
}

function AppInner() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [timings, setTimings] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'chat' | 'cards'>('chat')
  const [selection, setSelection] = useState<{ word: string; x: number; y: number } | null>(null)
  const [vocabToast, setVocabToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(() => !onboarding.done())
  const speakingRef = useRef(false)

  const t = useMemo(() => makeT(settings.uiLang), [settings.uiLang])
  const lang = settings.targetLang

  const [statusText, setStatusText] = useState(() => makeT(settings.uiLang)('loadingModels'))

  const health = useEngine({
    targetLang: lang,
    llmKey: settings.llmModel,
    asrKey: settings.asrModel,
    ttsKind: settings.ttsEngine,
    ttsVoice: resolveVoice(settings, lang),
    phononBase: resolvePhononBase(settings, lang),
  })

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  }, [])

  // UI language: library strings + html lang
  useEffect(() => {
    setLibLang(settings.uiLang)
    document.documentElement.lang = settings.uiLang
  }, [settings.uiLang])

  // Theme: data-theme on <html>; "system" follows prefers-color-scheme
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark =
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    if (settings.theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings.theme])

  // Current-language history from localStorage (analog of GET /api/history)
  useEffect(() => {
    setMessages(
      conversation.recent(lang).map(m => ({
        id: `db-${m.id}`,
        role: m.role,
        text: m.text,
        userTranslation: m.user_translation || undefined,
        corrections: m.corrections ?? undefined,
        translation: m.translation || undefined,
        follow_up: m.follow_up || undefined,
        audio_url: m.role === 'tutor' ? 'speech' : undefined,
      })),
    )
  }, [lang])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 6000)
    return () => window.clearTimeout(timer)
  }, [error])

  // The status bar reflects model readiness
  useEffect(() => {
    if (stage !== 'idle') return
    if (health.ready) {
      setStatusText(t('readyToTalk'))
    } else if (health.models.llm.state === 'error' || health.models.asr.state === 'error') {
      setStatusText(t('modelsErrorStatus'))
    } else {
      setStatusText(`${t('loadingModelsShort')}: ${(health.models.llm.progressText ?? '').slice(0, 60)}`)
    }
  }, [stage, health, t])

  /** Shared TTS settings for speak()/processChat() */
  const ttsSettings: TtsSettings = {
    engine: settings.ttsEngine,
    voice: resolveVoice(settings, lang),
    phononBase: resolvePhononBase(settings, lang),
  }

  /** Speak a tutor reply with the selected engine (Phonon or system voice) */
  const speakTutor = useCallback(
    (text: string) => {
      cancelSpeech()
      speakingRef.current = true
      setStage('playing')
      setStatusText(t('tutorSpeaking', { name: t('appName') }))
      speak(text, {
        ...ttsSettings,
        targetLang: lang,
        rate: settings.ttsSpeed,
        onFirstAudio: ms => setTimings(t0 => (t0 ? { ...t0, tts_ms: ms } : t0)),
      })
        .catch(err => {
          setError(err instanceof Error ? err.message : t('audioFailed'))
        })
        .finally(() => {
          speakingRef.current = false
          setStage(s => (s === 'playing' ? 'idle' : s))
          setStatusText(t('readyToTalk'))
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.ttsEngine, settings.ttsSpeed, settings.ttsVoices, settings.phononBases, lang, t],
  )

  const sendChat = useCallback(
    async (args: { blob?: Blob; text?: string }) => {
      setStage('processing')
      setStatusText(t('recognizing'))
      try {
        const data = (await processChat({
          blob: args.blob,
          text: args.text,
          level: settings.level,
          targetLang: lang,
          uiLang: settings.uiLang,
          llmKey: settings.llmModel,
          extraPrompt: settings.extraPrompt,
          tts: ttsSettings,
        })) as ChatResponse
        setTimings(data.timings)
        const stamp = Date.now()
        setMessages(prev => [
          ...prev,
          { id: `u-${stamp}`, role: 'user', text: data.user_text, userTranslation: data.user_translation },
          {
            id: `t-${stamp}`,
            role: 'tutor',
            text: data.reply,
            corrections: data.corrections,
            translation: data.translation,
            follow_up: data.follow_up,
            follow_up_translation: data.follow_up_translation,
            suggestions: data.suggestions,
            audio_url: data.audio_url,
          },
        ])
        setStatusText(data.warning ?? t('answerReady'))
        if (data.audio_url) speakTutor(data.reply)
        else setStage('idle')
      } catch (err) {
        setStage('idle')
        setStatusText(t('readyToTalk'))
        setError(
          err instanceof EmptyAudioError || err instanceof PipelineError || err instanceof ModelsNotReadyError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('unknownError'),
        )
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.level, settings.llmModel, settings.extraPrompt, settings.uiLang, settings.ttsEngine, settings.ttsVoices, settings.phononBases, lang, t, speakTutor],
  )

  const handleBlob = useCallback(
    async (blob: Blob) => {
      await sendChat({ blob })
    },
    [sendChat],
  )

  const handleText = useCallback(
    (text: string) => {
      if (stage !== 'idle') return
      void sendChat({ text })
    },
    [sendChat, stage],
  )

  const recorder = useRecorder(handleBlob)

  const prevRecorderState = useRef(recorder.state)
  useEffect(() => {
    if (recorder.state === 'recording') {
      setStage('recording')
      setStatusText(t('recordingStatus'))
    } else if (prevRecorderState.current === 'recording' && recorder.state === 'idle') {
      setStage(s => (s === 'recording' ? 'idle' : s))
      setStatusText(s => (s === t('recordingStatus') ? t('readyToTalk') : s))
    } else {
      setStage(s => (s === 'recording' ? 'idle' : s))
    }
    prevRecorderState.current = recorder.state
  }, [recorder.state, t])

  const startRecording = useCallback(() => {
    setError(null)
    cancelSpeech()
    if (stage === 'idle' || stage === 'playing') recorder.start()
  }, [recorder, stage])

  const speakWord = useCallback(
    (text: string) => {
      speak(text, { ...ttsSettings, targetLang: lang, rate: settings.ttsSpeed }).catch(err => {
        setError(err instanceof Error ? err.message : t('audioFailed'))
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.ttsEngine, settings.ttsSpeed, settings.ttsVoices, settings.phononBases, lang, t],
  )

  const handleSelection = useCallback(() => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!sel || !text || text.length > 60 || text.split(/\s+/).length > 4) {
      setSelection(null)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setSelection({ word: text, x: rect.left + rect.width / 2, y: rect.bottom + 10 })
  }, [])

  const addToVocab = useCallback(
    async (word: string) => {
      setSelection(null)
      window.getSelection()?.removeAllRanges()
      try {
        const result = await processVocab(word, settings.llmModel, lang, settings.uiLang)
        setVocabToast(
          result.existed
            ? t('vocabExisted', { word: result.item.word, translation: result.item.translation })
            : t('vocabAdded', { word: result.item.word, translation: result.item.translation }),
        )
        window.setTimeout(() => setVocabToast(null), 4000)
      } catch (err) {
        setVocabToast(err instanceof Error ? err.message : t('vocabFailed'))
        window.setTimeout(() => setVocabToast(null), 4000)
      }
    },
    [settings.llmModel, settings.uiLang, lang, t],
  )

  const resetDialog = useCallback(() => {
    cancelSpeech()
    conversation.reset(lang)
    setMessages([])
    setTimings(null)
    setSettingsOpen(false)
    setStatusText(t('newDialogStarted'))
  }, [lang, t])

  const finishOnboarding = useCallback(
    (uiLang: UiLang, targetLang: TargetLang) => {
      onboarding.complete()
      updateSettings({ uiLang, targetLang })
      setNeedsOnboarding(false)
    },
    [updateSettings],
  )

  return (
    <I18nProvider lang={settings.uiLang}>
      <div className="app">
        <Sidebar
          settings={settings}
          onChange={updateSettings}
          health={health}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="chat-pane">
        <div className="tabs">
          <button type="button" className={`tab${tab === 'chat' ? ' active' : ''}`} onClick={() => setTab('chat')}>
            {t('tabChat')}
          </button>
          <button type="button" className={`tab${tab === 'cards' ? ' active' : ''}`} onClick={() => setTab('cards')}>
            {t('tabCards')}
          </button>
          <button
            type="button"
            className="tab-btn-icon"
            onClick={() => setSettingsOpen(true)}
            title={t('openSettings')}
            aria-label={t('openSettings')}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M12 2.8l1.2 2.3a7 7 0 0 1 2.3.96l2.5-.7 1.7 2.9-1.9 1.8a7 7 0 0 1 0 2.68l1.9 1.8-1.7 2.9-2.5-.7a7 7 0 0 1-2.3.96L12 21.2l-1.2-2.3a7 7 0 0 1-2.3-.96l-2.5.7-1.7-2.9 1.9-1.8a7 7 0 0 1 0-2.68L4.3 9.46 6 6.56l2.5.7a7 7 0 0 1 2.3-.96L12 2.8z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <StatusBar
          stage={stage}
          statusText={error ?? statusText}
          isError={Boolean(error)}
          timings={timings}
          health={health}
        />
        {tab === 'chat' ? (
          <>
            <div className="message-list-wrap" onMouseUp={handleSelection}>
              <MessageList
                messages={messages}
                showTranslation={settings.showTranslation}
                targetLang={lang}
                uiLang={settings.uiLang}
                onReplay={msg => speakTutor(msg.text)}
                onSuggest={handleText}
              />
            </div>
            <div className="ptt-area">
              <PushToTalkButton
                stage={stage}
                disabled={false}
                recordingMs={recorder.recordingMs}
                onStart={startRecording}
                onStop={recorder.stop}
                onCancel={recorder.cancel}
              />
              {recorder.error && <p className="recorder-error">{recorder.error}</p>}
            </div>
          </>
        ) : (
          <FlashcardsView
            active={tab === 'cards'}
            speakWord={speakWord}
            llmModel={settings.llmModel}
            targetLang={lang}
            uiLang={settings.uiLang}
          />
        )}
        {selection && (
          <button
            type="button"
            className="add-vocab-btn"
            style={{ left: selection.x, top: selection.y }}
            onClick={() => void addToVocab(selection.word)}
          >
            {t('addToVocab')}
          </button>
        )}
        {vocabToast && <div className="vocab-toast">{vocabToast}</div>}
      </main>
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          health={health}
          onClose={() => setSettingsOpen(false)}
          onReset={resetDialog}
        />
      )}
      {needsOnboarding && <OnboardingModal initialUiLang={settings.uiLang} onDone={finishOnboarding} />}
      </div>
    </I18nProvider>
  )
}

export default function App() {
  return <AppInner />
}
