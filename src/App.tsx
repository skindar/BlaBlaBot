import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BenchView } from './components/BenchView'
import { DiaryView } from './components/DiaryView'
import { FlashcardsView } from './components/FlashcardsView'
import { InputCard } from './components/InputCard'
import { MessageList } from './components/MessageList'
import { OnboardingModal } from './components/OnboardingModal'
import { RightPanel } from './components/RightPanel'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar, type NavTab } from './components/Sidebar'
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
import { DEFAULT_LLM_KEY, availableLlmModels } from './lib/llm'
import { TARGET_LANG_LIST, langInfo, resolvePhononVoice } from './lib/langs'
import { conversation, onboarding } from './lib/store'
import { getSyncStatus, subscribeSync } from './lib/sync'
import { configureSync, initSyncEvents } from './lib/sync'
import { I18nProvider, makeT, setLibLang, type UiLang } from './i18n'
import { setBrain } from './lib/brain'
import { BotMark, Icon, SageButton } from './ui/design'
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
    handsFree: true,
    extraPrompt: '',
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
    // the saved model may have been removed from the curated list
    if (!availableLlmModels().some(m => m.key === s.llmModel)) s.llmModel = DEFAULT_LLM_KEY
    if (parsed.ttsVoice && !parsed.ttsVoices) s.ttsVoices = { de: parsed.ttsVoice }
    if (parsed.phononBase && !parsed.phononBases) s.phononBases = { de: parsed.phononBase }
    delete (s as unknown as Record<string, unknown>).ttsVoice
    delete (s as unknown as Record<string, unknown>).phononBase
    delete (s as unknown as Record<string, unknown>).topic
    delete (s as unknown as Record<string, unknown>).googleClientId
    return s
  } catch {
    return defaultSettings()
  }
}

/** Voice for the target language: saved value or the default. For Phonon the
 *  name is validated against what the selected model actually offers — a
 *  stale name (base switched, voice not hosted) falls back to the default. */
function resolveVoice(settings: Settings, lang: TargetLang): string {
  const saved = settings.ttsVoices[lang]
  if (settings.ttsEngine === 'phonon') {
    return resolvePhononVoice(lang, resolvePhononBase(settings, lang), saved)
  }
  return saved ?? ''
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
  const [tab, setTab] = useState<NavTab>('conversation')
  const [selection, setSelection] = useState<{ word: string; x: number; y: number } | null>(null)
  const [vocabToast, setVocabToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(() => !onboarding.done())
  // Google Drive sign-in gates the diary: no account — no diary mode/tab
  const [googleSignedIn, setGoogleSignedIn] = useState(() => getSyncStatus().signedIn)
  // hands-free mic: auto-submit after this much silence
  // hands-free auto-submit pause: user-configurable, clamped 1–30 s
  const HANDS_FREE_PAUSE_MS = Math.min(30_000, Math.max(1_000, settings.handsFreePauseMs ?? 3_000))
  const speakingRef = useRef(false)
  const prevStageRef = useRef<Stage>('idle')
  /** always-current recorder handle: callbacks read state through it instead of
   *  closing over a per-render object (keeps their dependency lists stable) */
  const recorderRefLive = useRef<{ state: string; cancel: () => void } | null>(null)
  /** the current playback is a replay of an old line ("Listen"), not the
   *  tutor's fresh reply — replaying must not restart the hands-free loop */
  const replayingRef = useRef(false)
  // design UI state
  const [rightPanel, setRightPanel] = useState(true)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [ended, setEnded] = useState(false)

  const t = useMemo(() => makeT(settings.uiLang), [settings.uiLang])
  const lang = settings.targetLang

  const [statusText, setStatusText] = useState(() => makeT(settings.uiLang)('loadingModels'))

  // Brain routing: cloud (Custom URL) or the local WebLLM engine
  const cloudBrain = settings.brain === 'cloud'
  useEffect(() => {
    setBrain({
      kind: cloudBrain ? 'cloud' : 'local',
      cloud: {
        baseUrl: settings.cloudBaseUrl ?? '',
        apiKey: settings.cloudApiKey ?? '',
        model: settings.cloudModel ?? '',
      },
    })
  }, [cloudBrain, settings.cloudBaseUrl, settings.cloudApiKey, settings.cloudModel])

  const health = useEngine({
    targetLang: lang,
    llmKey: settings.llmModel,
    asrKey: settings.asrModel,
    ttsKind: settings.ttsEngine,
    ttsVoice: resolveVoice(settings, lang),
    phononBase: resolvePhononBase(settings, lang),
    cloudBrain,
    cloudModel: settings.cloudModel ?? '',
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

  useEffect(() => subscribeSync(st => setGoogleSignedIn(st.signedIn)), [])

  // sign-out mid-diary: the mode and the tab cannot stay on
  useEffect(() => {
    if (!googleSignedIn && settings.diaryMode) updateSettings({ diaryMode: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleSignedIn])
  useEffect(() => {
    // the diary works offline; no Google account required
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleSignedIn])

  // UI language: library strings + html lang
  useEffect(() => {
    setLibLang(settings.uiLang)
    document.documentElement.lang = settings.uiLang
  }, [settings.uiLang])

  // Drive sync: wire store events once, follow the client id / auto-sync settings
  useEffect(() => {
    initSyncEvents()
  }, [])
  useEffect(() => {
    configureSync({ autoSync: settings.driveAutoSync })
  }, [settings.driveAutoSync])

  // Current-language history from localStorage (analog of GET /api/history)
  useEffect(() => {
    setMessages(
      conversation.recent(lang).map(m => ({
        id: `db-${m.id}`,
        role: m.role,
        createdAt: Date.parse(m.created_at) || undefined,
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

  // The status line reflects model readiness
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
    (text: string, replay = false) => {
      cancelSpeech()
      speakingRef.current = true
      replayingRef.current = replay
      setStage('playing')
      setStatusText(t('tutorSpeaking', { name: t('appName') }))
      // Watchdog: speechSynthesis/AudioBuffer onended events occasionally
      // never fire (autoplay policy, voice swap mid-utterance) — without this
      // the stage sticks at 'playing' and silently eats every chip click.
      const words = text.split(/\s+/).length
      const watchdog = window.setTimeout(
        () => cancelSpeech(),
        Math.max(8000, words * 420 / Math.max(0.5, settings.ttsSpeed) + 4000),
      )
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
          window.clearTimeout(watchdog)
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
      // a real turn supersedes any replay flag left by an interrupted "Listen"
      replayingRef.current = false
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
          extraPrompt: settings.extraPrompt.trim(),
          topicId: settings.topics?.[lang],
          diaryMode: settings.diaryMode,
          tts: ttsSettings,
        })) as ChatResponse
        setTimings(data.timings)
        const stamp = Date.now()
        setMessages(prev => [
          ...prev,
          { id: `u-${stamp}`, role: 'user', text: data.user_text, userTranslation: data.user_translation, createdAt: stamp },
          {
            id: `t-${stamp}`,
            role: 'tutor',
            createdAt: stamp,
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
    [settings.level, settings.llmModel, settings.extraPrompt, settings.topics, settings.uiLang, settings.ttsEngine, settings.ttsVoices, settings.phononBases, lang, t, speakTutor],
  )

  const handleBlob = useCallback(
    async (blob: Blob) => {
      await sendChat({ blob })
    },
    [sendChat],
  )

  // Hands-free loop: when the tutor finishes speaking, the mic opens again
  // by itself — the conversation keeps flowing without touching anything.
  // Only after a clean turn (reply played/processed), on the conversation tab,
  // without an error — and it can be ended by simply staying silent.
  useEffect(() => {
    const prev = prevStageRef.current
    prevStageRef.current = stage
    if (!settings.handsFree) return
    if (stage !== 'idle' || tab !== 'conversation') return
    if (error) return
    if (ended) return
    if (prev !== 'processing' && prev !== 'playing') return
    // "Listen" replays an old line while the conversation is idle — finishing
    // that playback must not open the mic as if a turn had just completed
    if (replayingRef.current) {
      replayingRef.current = false
      return
    }
    void recorder.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, settings.handsFree, tab, ended])

  // Switching the topic starts a fresh conversation: the scenario session
  // restarts by definition (topicKey mismatch), and leaving the old history
  // in the prompt drags the tutor back to old questions ("What is your
  // name?" while the chips already belong to the new scenario).
  const topicIdRef = useRef(settings.topics?.[lang])
  useEffect(() => {
    const current = settings.topics?.[lang]
    if (topicIdRef.current !== undefined && current !== topicIdRef.current) {
      resetDialog()
    }
    topicIdRef.current = current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.topics, lang])

  // Turning hands-free off while it listens: close the mic, discard
  useEffect(() => {
    if (!settings.handsFree && recorder.state === 'recording') recorder.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.handsFree])

  // hands-free mic: auto-submit after a short silence pause
  const recorder = useRecorder(handleBlob, {
    autoStopOnSilenceMs: settings.handsFree ? HANDS_FREE_PAUSE_MS : undefined,
  })

  const handleText = useCallback(
    (text: string) => {
      if (stage === 'processing') return
      // chips and typed lines must always reach the tutor: interrupt playback,
      // and in hands-free mode close the auto-opened mic (its recording is
      // discarded — the chip text is what the student chose to say)
      if (stage === 'playing') cancelSpeech()
      if (stage === 'recording') recorder.cancel()
      void sendChat({ text })
    },
    [sendChat, stage, recorder],
  )

  recorderRefLive.current = { state: recorder.state, cancel: recorder.cancel }
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
    replayingRef.current = false
    cancelSpeech()
    if (stage === 'idle' || stage === 'playing') recorder.start()
  }, [recorder, stage])

  /** Close the mic without submitting: an in-flight recording is discarded.
   *  Used by "End session"; the hands-free loop reopens the mic only while
   *  the conversation is live. */
  const stopMic = useCallback(() => {
    cancelSpeech()
    const rec = recorderRefLive.current
    if (rec && rec.state === 'recording') rec.cancel()
    setStage('idle')
    setStatusText(t('readyToTalk'))
  }, [t])

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
    // a fresh conversation must not receive the phrase the user was still
    // recording when they pressed "New conversation"
    const rec = recorderRefLive.current
    if (rec && rec.state === 'recording') rec.cancel()
    conversation.reset(lang)
    setMessages([])
    setTimings(null)
    setSettingsOpen(false)
    setStatusText(t('newDialogStarted'))
  }, [lang, t])

  /** "End session" (the design): stop the mic, close the conversation,
   *  show the farewell card */
  const endSession = useCallback(() => {
    stopMic()
    resetDialog()
    setEnded(true)
  }, [stopMic, resetDialog])

  const finishOnboarding = useCallback(
    (uiLang: UiLang, targetLang: TargetLang) => {
      onboarding.complete()
      updateSettings({ uiLang, targetLang })
      setNeedsOnboarding(false)
    },
    [updateSettings],
  )

  if (ended) {
    return (
      <I18nProvider lang={settings.uiLang}>
        <main className="flex min-h-dvh items-center justify-center bg-[#faf9f6] p-6">
          <section className="w-full max-w-md rounded-[24px] border border-[#e5e6de] bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-6 flex w-fit">
              <BotMark large />
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.6px] text-[#292e2a]">
              {t('endedTitle')}
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#737970]">{t('endedText')}</p>
            <SageButton className="mt-7" onClick={() => setEnded(false)}>
              {t('returnToConversation')}
            </SageButton>
          </section>
        </main>
      </I18nProvider>
    )
  }

  return (
    <I18nProvider lang={settings.uiLang}>
      <main className="flex h-dvh overflow-hidden bg-[#faf9f6] text-[#292e2a]">
        <Sidebar
          settings={settings}
          active={tab}
          googleSignedIn={googleSignedIn}
          onNav={setTab}
          onNewConversation={() => {
            resetDialog()
            setTab('conversation')
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-24 items-center justify-between gap-3 border-b border-[#e5e6de] px-5 sm:px-8 xl:px-10">
            <div className="min-w-0">
              <h1 className="truncate text-[23px] font-semibold tracking-[-0.6px]">
                {t('convTitle', { lang: langInfo(lang).nativeName })}
              </h1>
              <div className="mt-[7px] flex items-center gap-1.5">
                <Icon name="dot" size={5} />
                <p className="truncate text-xs text-[#737970]">{t('tagline2')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:gap-6">
              {!rightPanel && (
                <button
                  aria-label={t('openPanel')}
                  className="hidden rounded-lg border border-[#e5e6de] p-2 xl:block"
                  onClick={() => setRightPanel(true)}
                  type="button"
                >
                  <Icon name="sparkles" size={16} />
                </button>
              )}
              <div className="relative">
                <button
                  className="flex items-center gap-2 rounded-lg border border-[#e5e6de] px-3 py-[9px] text-xs font-medium"
                  onClick={() => setLanguageOpen(!languageOpen)}
                  type="button"
                >
                  <Icon name="globe" size={16} />
                  <span className="hidden sm:inline">{langInfo(lang).nativeName}</span>
                  <Icon name="chevron" size={13} />
                </button>
                {languageOpen && (
                  <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-[#e5e6de] bg-white p-1.5 text-xs shadow-lg">
                    {TARGET_LANG_LIST.map(code => {
                      const info = langInfo(code)
                      return (
                        <button
                          className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-[#f1f0eb] ${
                            code === lang ? 'font-semibold text-[#526f60]' : ''
                          }`}
                          key={code}
                          onClick={() => {
                            updateSettings({ targetLang: code })
                            setLanguageOpen(false)
                          }}
                          type="button"
                        >
                          {info.flag} {info.nativeName}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              <button
                className="whitespace-nowrap text-xs font-medium text-[#737970] hover:text-[#292e2a]"
                onClick={endSession}
                type="button"
              >
                {t('endSession')}
              </button>
            </div>
          </header>

          {/* compact navigation for small screens (the sidebar is lg+) */}
          <nav
            aria-label="Primary navigation"
            className="flex gap-2 border-b border-[#e5e6de] px-5 py-2 lg:hidden"
          >
            {([
              [t('navConversation'), 'conversation'],
              [t('navCards'), 'cards'],
              [t('navDiary'), 'diary'],
            ] as Array<[string, NavTab]>).map(([label, nav]) => (
              <button
                className={`rounded-full px-3 py-1.5 text-xs ${
                  tab === nav ? 'bg-[#e5ece4] font-semibold text-[#526f60]' : 'text-[#737970]'
                } ${nav === 'diary' && !googleSignedIn ? 'opacity-50' : ''}`}
                disabled={nav === 'diary' && !googleSignedIn}
                key={nav}
                onClick={() => setTab(nav)}
                type="button"
              >
                {label}
              </button>
            ))}
            <button
              className="ml-auto rounded-full p-1.5 text-[#737970]"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              <Icon name="settings" size={16} />
            </button>
          </nav>

          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {tab === 'conversation' ? (
                <>
                  <div className="scroll-sage min-h-0 flex-1 overflow-y-auto" onMouseUp={handleSelection}>
                    <MessageList
                      messages={messages}
                      showTranslation={settings.showTranslation}
                      targetLang={lang}
                      uiLang={settings.uiLang}
                      onReplay={msg => speakTutor(msg.text, true)}
                      onSuggest={handleText}
                      onSavePhrase={text => void addToVocab(text)}
                      onStartHint={text => {
                        setDraft(text)
                        setTyping(true)
                      }}
                    />
                  </div>
                  <InputCard
                    timings={timings}
                    stage={stage}
                    statusText={statusText}
                    error={error}
                    recordingMs={recorder.recordingMs}
                    handsFree={Boolean(settings.handsFree)}
                    onToggleHandsFree={() => updateSettings({ handsFree: !settings.handsFree })}
                    silenceMs={recorder.silenceMs}
                    speechDetected={recorder.speechDetected}
                    pauseLimitMs={HANDS_FREE_PAUSE_MS}
                    typing={typing}
                    draft={draft}
                    setTyping={setTyping}
                    setDraft={setDraft}
                    onSendText={handleText}
                    onStart={startRecording}
                    onStop={settings.handsFree && !recorder.speechDetected ? recorder.cancel : recorder.stop}
                    onCancel={recorder.cancel}
                  />
                </>
              ) : tab === 'cards' ? (
                <div className="scroll-sage min-h-0 flex-1 overflow-y-auto">
                  <FlashcardsView
                    active={tab === 'cards'}
                    speakWord={speakWord}
                    llmModel={settings.llmModel}
                    targetLang={lang}
                    uiLang={settings.uiLang}
                  />
                </div>
              ) : tab === 'diary' ? (
                <div className="scroll-sage min-h-0 flex-1 overflow-y-auto">
                  <DiaryView
                    active={tab === 'diary'}
                    targetLang={lang}
                    uiLang={settings.uiLang}
                    level={settings.level}
                    llmModel={settings.llmModel}
                  />
                </div>
              ) : tab === 'bench' && settings.showBench ? (
                <div className="scroll-sage min-h-0 flex-1 overflow-y-auto">
                  <BenchView active={tab === 'bench'} targetLang={lang} uiLang={settings.uiLang} />
                </div>
              ) : null}
            </div>

            {tab === 'conversation' && rightPanel && (
              <RightPanel
                settings={settings}
                onChange={updateSettings}
                onAddWord={word => void addToVocab(word)}
                onClose={() => setRightPanel(false)}
              />
            )}
          </div>
        </section>

        {selection && (
          <button
            type="button"
            className="fixed z-50 -translate-x-1/2 rounded-full bg-[#526f60] px-4 py-2 text-xs text-white shadow-lg"
            style={{ left: selection.x, top: selection.y }}
            onClick={() => void addToVocab(selection.word)}
          >
            {t('addToVocab')}
          </button>
        )}
        {vocabToast && (
          <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#292e2a] px-5 py-2.5 text-xs text-white shadow-lg">
            {vocabToast}
          </div>
        )}

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
      </main>
    </I18nProvider>
  )
}

export default function App() {
  return <AppInner />
}
