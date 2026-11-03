import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'recording' | 'error'

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
const MIN_BLOB_SIZE = 800
const MIN_DURATION_MS = 400

export interface UseRecorderOptions {
  /** diary free-talk mode: auto-submit after this much silence (ms)
   *  once the user has actually said something */
  autoStopOnSilenceMs?: number
}

interface UseRecorderResult {
  state: RecorderState
  error: string | null
  recordingMs: number
  /** how long the user has been silent (only counts after speech) */
  silenceMs: number
  /** live mic level has crossed the speech threshold at least once */
  speechDetected: boolean
  start: () => Promise<void>
  stop: () => void
  cancel: () => void
}

/** live "is the user speaking" threshold, dB RMS — same ballpark as the offline VAD */
const LIVE_SPEECH_DB = -40
/** safety cap for a hands-free session */
const MAX_RECORDING_MS = 5 * 60 * 1000
/** hands-free: a recording that never heard speech closes silently
 *  (this is also the natural way to end the conversation loop) */
const NO_SPEECH_CANCEL_MS = 25 * 1000

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

export function useRecorder(
  onFinished: (blob: Blob, durationMs: number) => void,
  options: UseRecorderOptions = {},
): UseRecorderResult {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [recordingMs, setRecordingMs] = useState(0)
  const [silenceMs, setSilenceMs] = useState(0)
  const [speechDetected, setSpeechDetected] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const discardedRef = useRef(false)
  const onFinishedRef = useRef(onFinished)
  const optionsRef = useRef(options)
  const stopRef = useRef<() => void>(() => undefined)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelBufRef = useRef<Float32Array | null>(null)
  const lastLoudAtRef = useRef(0)
  const speechDetectedRef = useRef(false)

  useEffect(() => {
    onFinishedRef.current = onFinished
    optionsRef.current = options
  }, [onFinished, options])

  const cleanup = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    recorderRef.current = null
    void audioCtxRef.current?.close().catch(() => undefined)
    audioCtxRef.current = null
    analyserRef.current = null
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
        setSilenceMs(0)
        setSpeechDetected(false)
        if (discarded) return
        if (blob.size < MIN_BLOB_SIZE || durationMs < MIN_DURATION_MS) {
          setError('Слишком короткая запись — зажми кнопку и говори подольше.')
          return
        }
        onFinishedRef.current(blob, durationMs)
      }

      // live level meter for hands-free auto-submit (diary free-talk)
      lastLoudAtRef.current = Date.now()
      speechDetectedRef.current = false
      try {
        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        audioCtxRef.current = ctx
        analyserRef.current = analyser
        levelBufRef.current = new Float32Array(analyser.fftSize)
      } catch {
        /* level meter is optional — push-to-talk still works */
      }

      recorder.start(250)
      recorderRef.current = recorder
      streamRef.current = stream
      startedAtRef.current = Date.now()
      setRecordingMs(0)
      setSilenceMs(0)
      setSpeechDetected(false)
      timerRef.current = window.setInterval(() => {
        const now = Date.now()
        setRecordingMs(now - startedAtRef.current)
        const analyser = analyserRef.current
        const buf = levelBufRef.current
        if (analyser && buf) {
          analyser.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-10)
          if (db > LIVE_SPEECH_DB) {
            lastLoudAtRef.current = now
            if (!speechDetectedRef.current) {
              speechDetectedRef.current = true
              setSpeechDetected(true)
            }
          }
          const silence = speechDetectedRef.current ? now - lastLoudAtRef.current : 0
          setSilenceMs(silence)
          const autoMs = optionsRef.current.autoStopOnSilenceMs
          const elapsed = now - startedAtRef.current
          if (autoMs && speechDetectedRef.current && silence >= autoMs) {
            // said something, then went quiet — submit
            stopRef.current()
          } else if (autoMs && !speechDetectedRef.current && elapsed >= NO_SPEECH_CANCEL_MS) {
            // the tutor's reply got no answer — close the mic silently
            discardedRef.current = true
            stopRef.current()
          } else if (elapsed >= MAX_RECORDING_MS && speechDetectedRef.current) {
            stopRef.current()
          }
        }
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

  useEffect(() => {
    stopRef.current = stop
  }, [stop])

  return { state, error, recordingMs, silenceMs, speechDetected, start, stop, cancel }
}
