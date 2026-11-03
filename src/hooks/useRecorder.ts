import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'recording' | 'error'

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const MIN_BLOB_SIZE = 800
const MIN_DURATION_MS = 400

interface UseRecorderResult {
  state: RecorderState
  error: string | null
  recordingMs: number
  start: () => Promise<void>
  stop: () => void
  cancel: () => void
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported(m))
}

function micErrorMessage(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return 'Доступ к микрофону запрещён. Разреши его в настройках сайта в браузере.'
    }
    if (err.name === 'NotFoundError') return 'Микрофон не найден.'
  }
  return 'Не удалось начать запись. Проверь, что микрофон доступен браузеру.'
}

export function useRecorder(onFinished: (blob: Blob, durationMs: number) => void): UseRecorderResult {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recordingMs, setRecordingMs] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const discardedRef = useRef(false)
  const onFinishedRef = useRef(onFinished)

  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    if (recorderRef.current) return
    setError(null)
    discardedRef.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      if (discardedRef.current) {
        stream.getTracks().forEach(track => track.stop())
        setState('idle')
        return
      }
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      discardedRef.current = false

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setError('Ошибка записи — попробуй ещё раз.')
        cleanup()
        setState('idle')
        setRecordingMs(0)
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        const durationMs = Date.now() - startedAtRef.current
        const discarded = discardedRef.current
        cleanup()
        setState('idle')
        setRecordingMs(0)
        if (discarded) return
        if (blob.size < MIN_BLOB_SIZE || durationMs < MIN_DURATION_MS) {
          setError('Слишком короткая запись — зажми кнопку и говори подольше.')
          return
        }
        onFinishedRef.current(blob, durationMs)
      }

      recorder.start(250)
      recorderRef.current = recorder
      streamRef.current = stream
      startedAtRef.current = Date.now()
      setRecordingMs(0)
      timerRef.current = window.setInterval(() => {
        setRecordingMs(Date.now() - startedAtRef.current)
      }, 200)
      setState('recording')
    } catch (err) {
      setError(micErrorMessage(err))
      setState('error')
    }
  }, [cleanup])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      discardedRef.current = true
    }
  }, [])

  const cancel = useCallback(() => {
    discardedRef.current = true
    stop()
  }, [stop])

  return { state, error, recordingMs, start, stop, cancel }
}
