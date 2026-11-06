// Browser capability probes shared by application/presentation code. No
// adapter imports — this is deliberately just feature detection.

type SpeechRecognitionCtor = new () => unknown

export function isWebSpeechAsrSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}
