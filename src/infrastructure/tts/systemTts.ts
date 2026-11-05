// "System voice" TTS option: the browser's speechSynthesis (OS voices).
// 0 MB download, instant start — but voices depend on the OS.
// Never read text in the wrong language: if no voice exists for the target
// language, fail honestly and suggest switching to Phonon.

import { SpeechError } from '../../application/errors'
import type { TargetLang } from '../../domain/models'
import { TARGET_LANGS } from '../../domain/policies/languages'
import { libT } from '../../shared/i18nStrings'

export class TtsError extends SpeechError {}

/** macOS novelty voices — fine for fun, not for a tutor */
const NOVELTY_RE = /eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bells|jester|organ|zarvox|trinoids|albert/i

export interface SpeakStartOptions {
  voiceUri?: string
  onFirstAudio?: (ms: number) => void
}

export class TtsEngine {
  private voice: SpeechSynthesisVoice | null = null
  private voiceLang: TargetLang | null = null

  static supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  }

  /** Voices load asynchronously — wait for voiceschanged or a timeout */
  private async waitForVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
    const synth = window.speechSynthesis
    const existing = synth.getVoices()
    if (existing.length > 0) return existing
    return new Promise(resolve => {
      const timer = window.setTimeout(() => resolve(synth.getVoices()), timeoutMs)
      synth.addEventListener(
        'voiceschanged',
        () => {
          window.clearTimeout(timer)
          resolve(synth.getVoices())
        },
        { once: true },
      )
    })
  }

  /** All system voices for the target language (for the sidebar picker) */
  async listVoices(targetLang: TargetLang): Promise<SpeechSynthesisVoice[]> {
    if (!TtsEngine.supported()) return []
    const voices = await this.waitForVoices()
    const prefix = TARGET_LANGS[targetLang].bcp47.slice(0, 2)
    return voices
      .filter(v => v.lang.toLowerCase().replace('_', '-').startsWith(prefix))
      .sort((a, b) => this.rank(b, targetLang) - this.rank(a, targetLang))
  }

  /** Voice rank: quality and regular voices up, novelty voices down */
  private rank(v: SpeechSynthesisVoice, targetLang: TargetLang): number {
    let r = 0
    if (/premium|enhanced|siri|multilingual/i.test(v.name)) r += 4
    if (/google/i.test(v.name)) r += 3
    const locale = TARGET_LANGS[targetLang].bcp47.toLowerCase()
    if (v.lang.toLowerCase().replace('_', '-') === locale) r += 2
    if (!v.localService) r += 1 // network voices usually sound more natural
    if (NOVELTY_RE.test(v.name)) r -= 10
    return r
  }

  /** Pick a voice: explicit (URI) → saved → best by rank */
  async ensure(voiceUri: string | undefined, targetLang: TargetLang): Promise<SpeechSynthesisVoice | null> {
    if (!TtsEngine.supported()) throw new TtsError(libT('errTtsUnsupported'))
    const voices = await this.listVoices(targetLang)
    if (voices.length === 0) {
      this.voice = null
      this.voiceLang = null
      return null
    }
    if (voiceUri) {
      const picked = voices.find(v => v.voiceURI === voiceUri) ?? null
      if (picked) {
        this.voice = picked
        this.voiceLang = targetLang
        return picked
      }
    }
    if (this.voiceLang !== targetLang || !this.voice || !voices.includes(this.voice)) {
      this.voice = voices[0]
      this.voiceLang = targetLang
    }
    return this.voice
  }

  voiceLabel(): string {
    if (!this.voice) return '—'
    const novelty = NOVELTY_RE.test(this.voice.name) ? ` ${libT('systemVoiceNovelty')}` : ''
    return `${this.voice.name}${novelty}`
  }

  cancel(): void {
    if (TtsEngine.supported()) window.speechSynthesis.cancel()
  }

  /** Speak text; the promise settles when playback ends or fails.
   *  onFirstAudio fires on utterance.onstart — the latency to first sound. */
  speak(text: string, rate = 1, targetLang: TargetLang, opts: SpeakStartOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!TtsEngine.supported()) {
        reject(new TtsError(libT('errTtsUnavailable')))
        return
      }
      const synth = window.speechSynthesis
      synth.cancel()
      const speakNow = (voice: SpeechSynthesisVoice | null) => {
        if (voice === null) {
          reject(new TtsError(libT('errTtsNoVoice')))
          return
        }
        const started = performance.now()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.voice = voice
        utterance.lang = voice.lang
        utterance.rate = rate
        let firstFired = false
        utterance.onstart = () => {
          if (!firstFired) {
            firstFired = true
            opts.onFirstAudio?.(Math.round(performance.now() - started))
          }
        }
        utterance.onend = () => resolve()
        utterance.onerror = (e: SpeechSynthesisErrorEvent) => {
          // "interrupted"/"canceled" means the user hit cancel — not a user-facing error
          if (e.error === 'interrupted' || e.error === 'canceled') resolve()
          else reject(new TtsError(libT('errTtsSpeak', { error: e.error })))
        }
        synth.speak(utterance)
      }
      if (this.voice && this.voiceLang === targetLang) {
        speakNow(this.voice)
      } else {
        void this.ensure(opts.voiceUri, targetLang).then(v => speakNow(v))
      }
    })
  }
}
