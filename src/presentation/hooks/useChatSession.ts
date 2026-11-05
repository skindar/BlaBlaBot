// Chat session controller: owns the bubbles, stage, timings and the calls
// into the turn pipeline. The UI renders state; it does not orchestrate.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, Settings, Stage, TargetLang, TurnInput, TurnResult } from '../../domain/models'
import { EmptyAudioError } from '../../application/errors'
import { speechSelectionFor } from '../../application/services/speechSelection'
import { tutorNameForVoice } from '../../domain/policies/voiceName'
import { useServices } from '../context'
import { useI18n } from '../i18n'
import { speechWatchdogMs } from './speechTiming'

export interface ChatSession {
  messages: ChatMessage[]
  stage: Stage
  setStage: (stage: Stage | ((prev: Stage) => Stage)) => void
  timings: Record<string, number> | null
  error: string | null
  notice: string | null
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
  send: (input: TurnInput) => Promise<TurnResult | null>
  speakTutor: (text: string, replay?: boolean) => void
  speakText: (text: string) => void
  cancelSpeech: () => void
  /** Hard-stop the current turn: ignore late ASR/LLM/TTS results. */
  cancelTurn: () => void
  reset: (lang: TargetLang) => void
  openChat: (id: string) => void
  loadHistory: (lang: TargetLang) => void
}

function toChatMessage(entry: ReturnType<ReturnType<typeof useServices>['conversation']['recent']>[number]): ChatMessage {
  return {
    id: `db-${entry.id}`,
    role: entry.role,
    createdAt: Date.parse(entry.createdAt) || undefined,
    text: entry.text,
    userTranslation: entry.userTranslation || undefined,
    corrections: entry.corrections.length > 0 ? entry.corrections : undefined,
    translation: entry.translation || undefined,
    canSpeak: entry.role === 'tutor',
  }
}

export function useChatSession(settings: Settings): ChatSession {
  const services = useServices()
  const t = useI18n()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [stage, setStage] = useState<Stage>('idle')
  const [timings, setTimings] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const speakingRef = useRef(false)
  const watchdogRef = useRef<number | null>(null)
  const turnRef = useRef(0)

  const lang = settings.targetLang

  const loadHistory = useCallback(
    (target: TargetLang) => {
      setMessages(services.conversation.recent(target).map(toChatMessage))
    },
    [services],
  )

  useEffect(() => {
    loadHistory(lang)
  }, [lang, loadHistory])

  const cancelSpeech = useCallback(() => {
    if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current)
    watchdogRef.current = null
    speakingRef.current = false
    services.turns.cancelSpeech()
    setStage(current => (current === 'playing' ? 'idle' : current))
  }, [services])

  // A turn may already be awaiting ASR/LLM/TTS. The generation counter makes
  // its eventual result a no-op instead of appending a reply or starting
  // playback after the user pressed Stop.
  const cancelTurn = useCallback(() => {
    turnRef.current += 1
    cancelSpeech()
    setStage('idle')
  }, [cancelSpeech])

  const speakTutor = useCallback(
    (text: string, replay = false) => {
      void replay
      cancelSpeech()
      speakingRef.current = true
      setStage('playing')
      // Watchdog: speechSynthesis/AudioBuffer onended occasionally never fire
      // (autoplay policy, voice swap mid-utterance) — without this the stage
      // sticks at 'playing' and silently eats every chip click.
      //
      // It must cover SYNTHESIS too, not just playback: a cold Piper line can
      // take 4–6 s before the first sound (ONNX + voice download/recompile),
      // then 3–5 s of speech. The old 8 s cap cut the tail, flipped the stage
      // to idle and hands-free reopened the mic mid-sentence.
      watchdogRef.current = window.setTimeout(
        () => cancelSpeech(),
        speechWatchdogMs(text, settings.ttsSpeed),
      )
      services.turns
        .speak(text, {
          lang,
          rate: settings.ttsSpeed,
          speech: speechSelectionFor(settings),
          onFirstAudio: ms => setTimings(current => (current ? { ...current, tts_ms: ms } : current)),
        })
        .catch(err => setError(err instanceof Error ? err.message : t('audioFailed')))
        .finally(() => {
          if (watchdogRef.current !== null) window.clearTimeout(watchdogRef.current)
          watchdogRef.current = null
          speakingRef.current = false
          setStage(current => (current === 'playing' ? 'idle' : current))
        })
    },
    [cancelSpeech, lang, services, settings, t],
  )

  const speakText = useCallback(
    (text: string) => {
      services.turns
        .speak(text, { lang, rate: settings.ttsSpeed, speech: speechSelectionFor(settings) })
        .catch(err => setError(err instanceof Error ? err.message : t('audioFailed')))
    },
    [lang, services, settings, t],
  )

  const send = useCallback(
    async (input: TurnInput): Promise<TurnResult | null> => {
      const turn = ++turnRef.current
      setStage('processing')
      const speech = speechSelectionFor(settings)
      try {
        const data = await services.turns.process(input, {
          level: settings.level,
          targetLang: lang,
          uiLang: settings.uiLang,
          llmKey: settings.llmModel,
          extraPrompt: settings.extraPrompt.trim(),
          topicId: settings.topics[lang],
          diaryMode: settings.diaryMode,
          freeTalk: settings.talkMode === 'free',
          temperature: settings.freeTalkTemperature,
          tutorName: tutorNameForVoice(lang, speech.voice, speech.engine),
          speech,
        })
        if (turn !== turnRef.current) return null
        setTimings(data.timings)
        const stamp = Date.now()
        setMessages(prev => [
          ...prev,
          {
            id: `u-${stamp}`,
            role: 'user',
            text: data.userText,
            userTranslation: data.userTranslation || undefined,
            createdAt: stamp,
          },
          {
            id: `t-${stamp}`,
            role: 'tutor',
            createdAt: stamp,
            text: data.reply,
            corrections: data.corrections,
            translation: data.translation || undefined,
            followUp: data.followUp || undefined,
            followUpTranslation: data.followUpTranslation || undefined,
            suggestions: data.suggestions,
            canSpeak: data.canSpeak,
          },
        ])
        if (data.canSpeak) speakTutor(data.reply)
        else setStage('idle')
        return data
      } catch (err) {
        if (turn !== turnRef.current) return null
        setStage('idle')
        if (err instanceof EmptyAudioError) {
          setNotice(err.message || t('errNothingHeard'))
        } else {
          setError(err instanceof Error ? err.message : t('unknownError'))
        }
        return null
      }
    },
    [lang, services, settings, speakTutor, t],
  )

  const openChat = useCallback(
    (id: string) => {
      if (id === 'current') return
      cancelTurn()
      if (!services.conversation.openArchive(id)) return
      services.sessions.reset(lang)
      setMessages(services.conversation.recent(lang).map(toChatMessage))
      setTimings(null)
      setNotice(null)
    },
    [cancelTurn, lang, services],
  )

  const reset = useCallback(
    (target: TargetLang) => {
      cancelTurn()
      services.conversation.reset(target)
      services.sessions.reset(target)
      setMessages([])
      setTimings(null)
      setNotice(null)
    },
    [cancelTurn, services],
  )

  return {
    messages,
    stage,
    setStage,
    timings,
    error,
    notice,
    setError,
    setNotice,
    send,
    speakTutor,
    speakText,
    cancelSpeech,
    cancelTurn,
    reset,
    openChat,
    loadHistory,
  }
}
