// Composition of the whole screen: navigation, conversation, side panels
// and modals. All persistence/inference work is delegated to the services.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BenchView } from './components/BenchView'
import { AchievementsView } from './components/AchievementsView'
import { DiaryView } from './components/DiaryView'
import { FlashcardsView } from './components/FlashcardsView'
import { InputCard } from './components/InputCard'
import { MessageList } from './components/MessageList'
import { OnboardingModal } from './components/OnboardingModal'
import { RightPanel } from './components/RightPanel'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar, type NavTab } from './components/Sidebar'
import { useChatSession } from './hooks/useChatSession'
import { useRecorder } from './hooks/useRecorder'
import { useSystemAsr } from './hooks/useSystemAsr'
import { useHealth, useServices, useSettings } from './context'
import { useSyncStatus } from './context'
import { TARGET_LANG_LIST, langInfo } from '../domain/policies/languages'
import { resolvePhononBase, resolveVoice } from '../domain/policies/settings'
import { I18nProvider, makeT, setLibLang, type UiLang } from './i18n'
import { BotMark, Icon, SageButton } from './ui/design'
import type { TargetLang } from '../domain/models'

const HANDS_FREE_MIN_MS = 1000
const HANDS_FREE_MAX_MS = 30_000

export function ChatApp(): JSX.Element {
  const services = useServices()
  const [settings, updateSettings] = useSettings()
  const health = useHealth()
  const sync = useSyncStatus()
  const chat = useChatSession(settings)
  const { messages, stage, setStage, error, setError, notice, setNotice, timings } = chat

  const [tab, setTab] = useState<NavTab>('conversation')
  const [selection, setSelection] = useState<{ word: string; x: number; y: number } | null>(null)
  const [vocabToast, setVocabToast] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(() => !services.onboarding.done())
  const [rightPanel, setRightPanel] = useState(true)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const [ended, setEnded] = useState(false)
  const [statusText, setStatusText] = useState(() => makeT(settings.uiLang)('loadingModels'))

  const t = useMemo(() => makeT(settings.uiLang), [settings.uiLang])
  const lang = settings.targetLang
  const googleSignedIn = sync.signedIn

  const handsFreePauseMs = Math.min(
    HANDS_FREE_MAX_MS,
    Math.max(HANDS_FREE_MIN_MS, settings.handsFreePauseMs),
  )
  const prevStageRef = useRef(stage)
  const replayingRef = useRef(false)
  /** set by Stop / New chat: hands-free must not reopen the mic by itself */
  const manualStopRef = useRef(false)
  const recorderRefLive = useRef<{ state: string; cancel: () => void } | null>(null)
  const startRecordingRef = useRef<() => void>(() => undefined)

  // UI language: string catalog + html lang
  useEffect(() => {
    setLibLang(settings.uiLang)
    document.documentElement.lang = settings.uiLang
  }, [settings.uiLang])

  // Bring the app up: load settings, models, sync events.
  useEffect(() => {
    services.start()
  }, [services])

  useEffect(() => {
    services.sync.configure({ autoSync: settings.driveAutoSync })
  }, [services, settings.driveAutoSync])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), 6000)
    return () => window.clearTimeout(timer)
  }, [error, setError])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice, setNotice])

  // The status line reflects model readiness.
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

  /** Send a turn and reflect its warning in the status line. */
  const sendChat = useCallback(
    async (args: { blob?: Blob; text?: string }) => {
      replayingRef.current = false
      setStatusText(t('recognizing'))
      let timer: number | null = null
      const timeout = new Promise<'timeout'>(resolve => {
        timer = window.setTimeout(() => resolve('timeout'), 60_000)
      })
      const data = await Promise.race([chat.send(args), timeout])
      if (timer !== null) window.clearTimeout(timer)
      if (data === 'timeout') {
        chat.cancelTurn()
        setError(t('errTurnTimeout'))
        setStatusText(t('readyToTalk'))
        return
      }
      if (data) setStatusText(data.warning ?? t('answerReady'))
      else setStatusText(t('readyToTalk'))
    },
    [chat, setError, t],
  )

  const systemAsr = useSystemAsr()

  useEffect(() => {
    if (systemAsr.error) setError(systemAsr.error)
  }, [systemAsr.error, setError])

  const handleBlob = useCallback(
    async (blob: Blob) => {
      // A late MediaRecorder onstop after Stop must not start a new turn.
      if (manualStopRef.current) return
      if (settings.asrEngine === 'system') {
        const text = await systemAsr.stop()
        if (text) {
          await sendChat({ text })
        } else {
          setStage('idle')
          setStatusText(t('readyToTalk'))
          setNotice(t('errNothingHeard'))
        }
        return
      }
      await sendChat({ blob })
    },
    [sendChat, settings.asrEngine, systemAsr, setStage, setNotice, t],
  )

  // Hands-free loop: when the tutor finishes speaking, the mic opens again.
  useEffect(() => {
    const prev = prevStageRef.current
    prevStageRef.current = stage
    if (!settings.handsFree) return
    if (manualStopRef.current) return
    if (stage !== 'idle' || tab !== 'conversation') return
    if (error || ended) return
    if (prev !== 'processing' && prev !== 'playing') return
    if (replayingRef.current) {
      replayingRef.current = false
      return
    }
    startRecordingRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, settings.handsFree, tab, ended, error])

  // Switching the topic starts a fresh conversation.
  const topicIdRef = useRef(settings.topics[lang])
  useEffect(() => {
    const current = settings.topics[lang]
    if (topicIdRef.current !== undefined && current !== topicIdRef.current) {
      resetDialog()
    }
    topicIdRef.current = current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.topics, lang])

  // Turning hands-free off while it listens: close the mic, discard.
  useEffect(() => {
    if (!settings.handsFree && recorder.state === 'recording') recorder.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.handsFree])

  const recorder = useRecorder(handleBlob, {
    autoStopOnSilenceMs: settings.handsFree ? handsFreePauseMs : undefined,
    onNoSpeech: () => setNotice(t('errNothingHeard')),
    requireSpeech: settings.asrEngine !== 'system',
  })

  recorderRefLive.current = { state: recorder.state, cancel: recorder.cancel }

  useEffect(() => {
    if (recorder.error) {
      systemAsr.cancel()
      setError(recorder.error)
    }
  }, [recorder.error, setError, systemAsr])

  const prevRecorderState = useRef(recorder.state)
  useEffect(() => {
    if (recorder.state === 'recording') {
      setStage('recording')
      setStatusText(t('recordingStatus'))
    } else if (prevRecorderState.current === 'recording' && recorder.state === 'idle') {
      setStage(current => (current === 'recording' ? 'idle' : current))
      setStatusText(current => (current === t('recordingStatus') ? t('readyToTalk') : current))
    } else {
      setStage(current => (current === 'recording' ? 'idle' : current))
    }
    prevRecorderState.current = recorder.state
  }, [recorder.state, setStage, t])

  const handleText = useCallback(
    (text: string) => {
      if (stage === 'processing') return
      manualStopRef.current = false
      if (stage === 'playing') chat.cancelSpeech()
      if (stage === 'recording') {
        systemAsr.cancel()
        recorder.cancel()
      }
      void sendChat({ text })
    },
    [chat, recorder, sendChat, stage, systemAsr],
  )

  const startRecording = useCallback(() => {
    setError(null)
    setNotice(null)
    replayingRef.current = false
    manualStopRef.current = false
    chat.cancelSpeech()
    if (settings.asrEngine === 'system') {
      if (!systemAsr.supported) {
        setError(t('errSystemAsrUnsupported'))
        return
      }
      systemAsr.start(langInfo(lang).bcp47)
    }
    if (stage === 'idle' || stage === 'playing') void recorder.start()
  }, [chat, lang, recorder, setError, setNotice, settings.asrEngine, stage, systemAsr, t])
  startRecordingRef.current = startRecording

  const stopMic = useCallback(() => {
    manualStopRef.current = true
    systemAsr.cancel()
    chat.cancelTurn()
    if (recorderRefLive.current?.state === 'recording') recorderRefLive.current.cancel()
    setStage('idle')
    setStatusText(t('readyToTalk'))
  }, [chat, setStage, systemAsr, t])

  const resetDialog = useCallback(() => {
    stopMic()
    chat.reset(lang)
    setSettingsOpen(false)
    setStatusText(t('newDialogStarted'))
  }, [chat, lang, stopMic, t])

  const openChat = useCallback(
    (id: string) => {
      stopMic()
      chat.openChat(id)
      setTab('conversation')
      setStatusText(t('readyToTalk'))
    },
    [chat, stopMic, t],
  )

  const deleteChat = useCallback(
    (id: string) => {
      if (!window.confirm(t('deleteChatConfirm'))) return
      if (id === 'current') stopMic()
      services.conversation.deleteChat(id, lang)
      chat.loadHistory(lang)
      setStatusText(t('readyToTalk'))
    },
    [chat, lang, services, stopMic, t],
  )

  const endSession = useCallback(() => {
    stopMic()
    resetDialog()
    setEnded(true)
  }, [resetDialog, stopMic])

  const speakWord = useCallback(
    (text: string) => {
      chat.speakText(text)
    },
    [chat],
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
        const result = await services.vocabulary.lookup(word, {
          llmKey: settings.llmModel,
          targetLang: lang,
          uiLang: settings.uiLang,
        })
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
    [lang, services.vocabulary, settings.llmModel, settings.uiLang, t],
  )

  const finishOnboarding = useCallback(
    (uiLang: UiLang, targetLang: TargetLang) => {
      services.onboarding.complete()
      updateSettings({ uiLang, targetLang })
      setNeedsOnboarding(false)
    },
    [services.onboarding, updateSettings],
  )

  const replay = useCallback(
    (text: string) => {
      replayingRef.current = true
      chat.speakTutor(text, true)
    },
    [chat],
  )

  // Effective voice/base for the right panel and the turn pipeline.
  const ttsVoice = resolveVoice(settings, lang)
  const phononBase = resolvePhononBase(settings, lang)

  if (ended) {
    return (
      <I18nProvider lang={settings.uiLang}>
        <main className="flex min-h-dvh items-center justify-center bg-[#faf9f6] p-6">
          <section className="w-full max-w-md rounded-[24px] border border-[#e5e6de] bg-white p-10 text-center shadow-sm">
            <div className="mx-auto mb-6 flex w-fit">
              <BotMark large />
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.6px] text-[#292e2a]">{t('endedTitle')}</h1>
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
          onOpenChat={openChat}
          onDeleteChat={deleteChat}
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
                    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold tracking-[1px] text-[#94988f]">
                      {t('learningLanguage').toUpperCase()}
                    </p>
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

          <nav
            aria-label="Primary navigation"
            className="flex gap-2 border-b border-[#e5e6de] px-5 py-2 lg:hidden"
          >
            {(
              [
                [t('navConversation'), 'conversation'],
                [t('navCards'), 'cards'],
                [t('navDiary'), 'diary'],
                [t('navAchv'), 'achv'],
              ] as Array<[string, NavTab]>
            ).map(([label, nav]) => (
              <button
                className={`rounded-full px-3 py-1.5 text-xs ${
                  tab === nav ? 'bg-[#e5ece4] font-semibold text-[#526f60]' : 'text-[#737970]'
                }`}
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
                      onReplay={msg => replay(msg.text)}
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
                    notice={notice}
                    recordingMs={recorder.recordingMs}
                    handsFree={Boolean(settings.handsFree)}
                    onToggleHandsFree={() => {
                      manualStopRef.current = false
                      updateSettings({ handsFree: !settings.handsFree })
                    }}
                    silenceMs={recorder.silenceMs}
                    speechDetected={recorder.speechDetected}
                    pauseLimitMs={handsFreePauseMs}
                    typing={typing}
                    draft={draft}
                    setTyping={setTyping}
                    setDraft={setDraft}
                    onSendText={handleText}
                    onStart={startRecording}
                    onStop={recorder.stop}
                    onCancel={stopMic}
                    onAbort={stopMic}
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
              ) : tab === 'achv' ? (
                <div className="scroll-sage min-h-0 flex-1 overflow-y-auto">
                  <AchievementsView active={tab === 'achv'} uiLang={settings.uiLang} />
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
                ttsVoice={ttsVoice}
                phononBase={phononBase}
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
