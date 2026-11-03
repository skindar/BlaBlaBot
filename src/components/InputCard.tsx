// The design's input card: the big "Your turn" panel with the speaking
// pill, the hands-free toggle, the typing mode and the live status line.
// Ports all the PushToTalkButton logic: hold-Space, click-to-talk and the
// hands-free auto-submit countdown.

import { useEffect, useRef } from 'react'
import type { Stage } from '../types'
import { useI18n } from '../i18n'
import { Icon } from '../ui/design'

interface Props {
  stage: Stage
  statusText: string
  error: string | null
  /** per-stage timings of the last turn (shown subtly under the card) */
  timings: Record<string, number> | null
  /** live recording time, ms */
  recordingMs: number
  /** hands-free mic: tap to start, auto-submit after a short silence pause */
  handsFree: boolean
  onToggleHandsFree: () => void
  /** end the hands-free session: discard the recording, keep the mic closed */
  onEndSession: () => void
  /** how long the user has been silent (live, only after speech) */
  silenceMs: number
  /** live mic level crossed the speech threshold at least once */
  speechDetected: boolean
  /** auto-submit pause, ms */
  pauseLimitMs: number
  /** typing mode */
  typing: boolean
  draft: string
  setTyping: (v: boolean) => void
  setDraft: (v: string) => void
  onSendText: (text: string) => void
  onStart: () => void
  onStop: () => void
  onCancel: () => void
}

const CLICK_IGNORE_MS = 350

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function InputCard({
  stage,
  statusText,
  error,
  timings,
  recordingMs,
  handsFree,
  onToggleHandsFree,
  onEndSession,
  silenceMs,
  speechDetected,
  pauseLimitMs,
  typing,
  draft,
  setTyping,
  setDraft,
  onSendText,
  onStart,
  onStop,
  onCancel,
}: Props) {
  const t = useI18n()
  const pressedRef = useRef(false)
  const pressedAtRef = useRef(0)
  const stateRef = useRef({ stage })
  stateRef.current = { stage }
  const callbacksRef = useRef({ onStart, onStop, onCancel })
  callbacksRef.current = { onStart, onStop, onCancel }
  const handsFreeRef = useRef(handsFree)
  handsFreeRef.current = handsFree

  // keyboard: hold Space to talk (or toggle in hands-free mode)
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      const { stage: currentStage } = stateRef.current
      if (handsFreeRef.current) {
        if (currentStage === 'idle') callbacksRef.current.onStart()
        else if (currentStage === 'recording') callbacksRef.current.onStop()
        return
      }
      if (currentStage !== 'idle' || pressedRef.current) return
      pressedRef.current = true
      pressedAtRef.current = Date.now()
      callbacksRef.current.onStart()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      if (handsFreeRef.current) return
      release()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const release = () => {
    if (!pressedRef.current) return
    pressedRef.current = false
    const heldMs = Date.now() - pressedAtRef.current
    if (heldMs < CLICK_IGNORE_MS) callbacksRef.current.onCancel()
    else callbacksRef.current.onStop()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (stage === 'processing' || stage === 'playing') return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const { stage: currentStage } = stateRef.current
    if (handsFreeRef.current) {
      // one tap starts, the next tap submits
      if (currentStage === 'idle') callbacksRef.current.onStart()
      else if (currentStage === 'recording') callbacksRef.current.onStop()
      return
    }
    if (currentStage === 'idle' && !pressedRef.current) {
      pressedRef.current = true
      pressedAtRef.current = Date.now()
      callbacksRef.current.onStart()
    }
  }

  const handlePointerUp = () => {
    if (handsFreeRef.current) return
    release()
  }

  const micDisabled = stage === 'processing' || stage === 'playing'
  const recording = stage === 'recording'
  const countdown =
    handsFree && recording && speechDetected && silenceMs >= 1500
      ? Math.max(1, Math.ceil((pauseLimitMs - silenceMs) / 1000))
      : null

  const title = recording
    ? t('wereListening')
    : stage === 'processing'
      ? statusText
      : stage === 'playing'
        ? statusText
        : t('yourTurn')
  const subtitle = recording
    ? countdown !== null
      ? t('pttFreeCountdown', { left: countdown })
      : t('speakNaturally')
    : healthReady(statusText)
      ? t('takeYourTime')
      : statusText

  return (
    <div className="mx-auto w-full max-w-[896px] px-5 pb-[26px] pt-[22px] sm:px-8 xl:px-11">
      <div className="rounded-[20px] border border-[#e5e6de] bg-white px-[22px] py-5">
        {typing ? (
          <div className="flex items-end gap-3">
            <textarea
              className="max-h-40 min-h-14 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-[#94988f]"
              onChange={event => setDraft(event.target.value)}
              placeholder={t('typeAnswer')}
              value={draft}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  if (draft.trim() && stage === 'idle') {
                    onSendText(draft.trim())
                    setDraft('')
                    setTyping(false)
                  }
                }
              }}
            />
            <button
              className="shrink-0 rounded-full bg-[#526f60] px-5 py-3 text-sm text-white transition-colors hover:bg-[#466052] disabled:opacity-40"
              disabled={!draft.trim() || stage !== 'idle'}
              onClick={() => {
                if (!draft.trim()) return
                onSendText(draft.trim())
                setDraft('')
                setTyping(false)
              }}
              type="button"
            >
              {t('send')}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[15px]">{title}</p>
              <p className="mt-[7px] truncate text-xs text-[#737970]">{subtitle}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {recording && (
                <span className="text-xs tabular-nums text-[#9c625c]">{formatMs(recordingMs)}</span>
              )}
              {handsFree && recording && (
                <button
                  className="rounded-full border border-[#9c625c] px-4 py-2 text-xs text-[#9c625c] transition-colors hover:bg-[#f7efee]"
                  onClick={onEndSession}
                  title={t('handsFreeStopHint')}
                  type="button"
                >
                  {t('handsFreeStop')}
                </button>
              )}
              <button
                className={`flex h-14 shrink-0 items-center gap-[11px] rounded-full px-[23px] text-[15px] text-white transition-colors ${
                  recording ? 'bg-[#9c625c]' : 'bg-[#526f60] hover:bg-[#466052]'
                } ${micDisabled ? 'opacity-60' : ''}`}
                disabled={micDisabled}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                type="button"
              >
                {stage === 'processing' ? (
                  <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Icon name="mic" size={22} />
                )}
                <span className="hidden sm:inline">
                  {stage === 'processing'
                    ? t('recognizing')
                    : recording
                      ? t('stopSpeaking')
                      : t('startSpeaking')}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-[18px] flex flex-wrap items-center justify-between gap-3 px-1">
        <button
          className="flex items-center gap-2 text-xs text-[#737970]"
          onClick={onToggleHandsFree}
          title={handsFree ? t('handsFreeOnHint') : t('handsFreeOffHint')}
          type="button"
        >
          {handsFree ? (
            <span className="flex h-[18px] w-[30px] items-center justify-end rounded-full bg-[#526f60] p-0.5">
              <span className="size-3.5 rounded-full bg-white" />
            </span>
          ) : (
            <Icon className="h-[18px] w-[30px]" name="toggle" size={18} />
          )}
          {t('handsFree')}
        </button>
        <div className="hidden items-center gap-1.5 text-[11px] text-[#94988f] sm:flex">
          <span>{t('orHold')}</span>
          <kbd className="rounded border border-[#e5e6de] px-[7px] py-[3px] text-[10px] text-[#737970]">
            Space
          </kbd>
          <span>{t('toTalk')}</span>
        </div>
        <button
          className="flex items-center gap-[7px] text-xs text-[#737970]"
          onClick={() => setTyping(!typing)}
          type="button"
        >
          <Icon name="keyboard" size={16} />
          {typing ? t('useVoice') : t('typeInstead')}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-[#e8d5d2] bg-[#faf3f2] px-4 py-2.5 text-xs leading-relaxed text-[#9c625c]">
          {error}
        </p>
      )}
      {timings && import.meta.env.DEV && (
        <p className="mt-2 text-center text-[10px] tabular-nums text-[#94988f]">
          {/* dev-only: raw stage timings; users see them properly on the Bench tab */}
          {[timings.asr_ms, timings.llm_ms, timings.translation_ms, timings.tts_ms, timings.total_ms]
            .filter(v => typeof v === 'number')
            .map(v => `${v}`)
            .join(' · ')}
        </p>
      )}
      <p className="mt-[18px] text-center text-[11px] text-[#94988f]">{t('noPressure')}</p>
    </div>
  )
}

/** the subtitle stays calm while everything is loaded and idle */
function healthReady(statusText: string): boolean {
  return !/…|\.\.\.|%/.test(statusText)
}
