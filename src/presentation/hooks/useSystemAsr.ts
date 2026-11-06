// Browser system speech recognition (Web Speech API): live transcription
// without downloading a Whisper model. Chrome/Edge use the platform service
// (usually cloud-backed); Firefox has no implementation. The app records the
// same microphone in parallel for VAD/duration, then submits this transcript.

import { useCallback, useMemo, useRef, useState } from 'react'
import { isWebSpeechAsrSupported } from '../../shared/platform'

interface RecognitionAlternative {
  transcript: string
}
interface RecognitionResult {
  isFinal: boolean
  [index: number]: RecognitionAlternative
}
interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
interface RecognitionErrorEvent {
  error: string
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type RecognitionCtor = new () => Recognition

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface SystemAsr {
  supported: boolean
  error: string | null
  start: (lang: string) => void
  stop: () => Promise<string>
  cancel: () => void
}

export function useSystemAsr(): SystemAsr {
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<Recognition | null>(null)
  const finalRef = useRef('')
  const interimRef = useRef('')
  const finishRef = useRef<((text: string) => void) | null>(null)
  const settledRef = useRef(true)

  const textSoFar = (): string =>
    (finalRef.current || interimRef.current).replace(/\s+/g, ' ').trim()

  const settle = useCallback(() => {
    if (settledRef.current) return
    settledRef.current = true
    const text = textSoFar()
    const finish = finishRef.current
    finishRef.current = null
    recognitionRef.current = null
    finish?.(text)
  }, [])

  const cancel = useCallback(() => {
    finalRef.current = ''
    interimRef.current = ''
    const rec = recognitionRef.current
    recognitionRef.current = null
    try {
      rec?.abort()
    } catch {
      /* already stopped */
    }
    if (!settledRef.current) {
      settledRef.current = true
      const finish = finishRef.current
      finishRef.current = null
      finish?.('')
    }
  }, [])

  const start = useCallback(
    (lang: string) => {
      const Ctor = ctor()
      if (!Ctor) {
        setError('SpeechRecognition is not supported in this browser')
        return
      }
      cancel()
      setError(null)
      finalRef.current = ''
      interimRef.current = ''
      finishRef.current = null
      settledRef.current = false

      const rec = new Ctor()
      rec.lang = lang
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = 1
      rec.onresult = (event: RecognitionEvent) => {
        let final = ''
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i]
          const transcript = result[0]?.transcript ?? ''
          if (result.isFinal) final += `${transcript} `
          else interim += `${transcript} `
        }
        if (final) finalRef.current += final
        interimRef.current = interim
      }
      rec.onerror = (event: RecognitionErrorEvent) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setError(event.error)
        }
      }
      rec.onend = () => {
        recognitionRef.current = null
        settle()
      }
      recognitionRef.current = rec
      try {
        rec.start()
      } catch (err) {
        recognitionRef.current = null
        settledRef.current = true
        setError(err instanceof Error ? err.message : 'SpeechRecognition failed')
      }
    },
    [cancel, settle],
  )

  const stop = useCallback(
    () =>
      new Promise<string>(resolve => {
        const rec = recognitionRef.current
        if (!rec) {
          resolve(textSoFar())
          return
        }
        settledRef.current = false
        finishRef.current = resolve
        try {
          rec.stop()
        } catch {
          settle()
        }
        // Chrome occasionally never fires onend after an early stop.
        window.setTimeout(() => {
          if (recognitionRef.current) {
            try {
              rec.abort()
            } catch {
              /* ignore */
            }
          }
          settle()
        }, 2500)
      }),
    [settle],
  )

  const supported = isWebSpeechAsrSupported()
  return useMemo(() => ({ supported, error, start, stop, cancel }), [supported, error, start, stop, cancel])
}
