import { useEffect, useRef } from 'react'
import type { Stage } from '../types'
import { useI18n } from '../i18n'

interface Props {
  stage: Stage
  disabled: boolean
  recordingMs: number
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

export function PushToTalkButton({ stage, disabled, recordingMs, onStart, onStop, onCancel }: Props) {
  const t = useI18n()
  const pressedRef = useRef(false)
  const pressedAtRef = useRef(0)
  const stateRef = useRef({ stage, disabled })
  stateRef.current = { stage, disabled }
  const callbacksRef = useRef({ onStart, onStop, onCancel })
  callbacksRef.current = { onStart, onStop, onCancel }

  const HINTS: Record<Stage, string> = {
    idle: t('pttIdle'),
    recording: t('pttRecording'),
    processing: t('pttProcessing'),
    playing: t('tutorSpeaking', { name: t('appName') }),
  }

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      const { stage: currentStage, disabled: currentDisabled } = stateRef.current
      if (currentStage !== 'idle' || currentDisabled || pressedRef.current) return
      pressedRef.current = true
      pressedAtRef.current = Date.now()
      callbacksRef.current.onStart()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
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
    if (heldMs < CLICK_IGNORE_MS) {
      callbacksRef.current.onCancel()
    } else {
      callbacksRef.current.onStop()
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const { stage: currentStage, disabled: currentDisabled } = stateRef.current
    if (currentStage === 'idle' && !currentDisabled && !pressedRef.current) {
      pressedRef.current = true
      pressedAtRef.current = Date.now()
      callbacksRef.current.onStart()
    }
  }

  const handlePointerUp = () => {
    release()
  }

  return (
    <div className="ptt">
      <button
        type="button"
        className={`ptt-btn ptt-${stage}`}
        disabled={stage === 'processing' || disabled}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label={HINTS[stage]}
      >
        <span className="ptt-ring" aria-hidden="true" />
        <span className="ptt-icon" aria-hidden="true">
          {stage === 'idle' && (
            <svg viewBox="0 0 24 24" width="36" height="36" fill="none">
              <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" fill="currentColor" />
              <path d="M19 12a7 7 0 0 1-14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
          {stage === 'recording' && <span className="rec-dot" />}
          {stage === 'processing' && <span className="spinner" />}
          {stage === 'playing' && (
            <span className="eq eq-lg">
              <i />
              <i />
              <i />
              <i />
            </span>
          )}
        </span>
        {stage === 'recording' && <span className="ptt-timer">{formatMs(recordingMs)}</span>}
      </button>
      <p className="ptt-hint">{HINTS[stage]}</p>
    </div>
  )
}
