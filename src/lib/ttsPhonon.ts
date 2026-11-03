// Phonon TTS in the browser: the official phonon-tts WASM package (streaming 24 kHz,
// WebGPU/CPU). The model is chosen by target language:
//   • de — phonon-40m-de + 13 local voices (as in the native version);
//   • en — public phonon-31m-en (hf://, Apache 2.0) + the gradium/phonon-voices catalog;
//   • fr/es/pt — phonon-40m-XX (gated on HF) — files hosted next to the app
//     or on GitHub Release; voice = default-voice from the same folder.
// Files are cached in the Cache API after the first download; offline afterwards.

import { PhononTTS, type ModelSpec, type PhononTTS as PhononInstance } from 'phonon-tts'
import { libT } from '../i18n'
import { phononVoices, type PhononVoiceInfo, type TargetLang } from './langs'

export type { PhononVoiceInfo }

function withSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

function buildModel(lang: TargetLang, base: string): ModelSpec | string {
  // hf://<owner>/<repo> — phonon-tts maps the repository files itself
  if (base.startsWith('hf://')) return base
  const b = withSlash(base)
  const voices: Record<string, string> = {}
  for (const v of phononVoices(lang, base)) voices[v.name] = v.url
  return {
    weights: { q8: `${b}model.q8.gguf` },
    tokenizer: `${b}tokenizer.json`,
    config: `${b}config.json`,
    voices,
    defaultVoice: phononVoices(lang, base)[0]?.name,
  }
}

export interface SpeakResult {
  /** ms from request to first sound — the honest TTS stage timing */
  firstAudioMs: number
  /** playback duration in ms (at the given rate) */
  playbackMs: number
}

export class TtsError extends Error {}

export class PhononEngine {
  private tts: PhononInstance | null = null
  private loadedKey: string | null = null // `${lang}|${base}`
  private loadPromise: Promise<PhononInstance> | null = null

  get ready(): boolean {
    return this.tts !== null
  }

  get deviceLabel(): string {
    return this.tts ? `${this.tts.device === 'webgpu' ? 'WebGPU' : `CPU×${this.tts.threads}`}` : ''
  }

  voiceLabel(): string {
    return this.tts ? `Phonon · ${this.deviceLabel}` : 'Phonon'
  }

  /** Load the language's model (or return the loaded one); q8, WebGPU when available */
  ensure(
    lang: TargetLang,
    base: string,
    onProgress: (p: PhononLoadProgress) => void,
  ): Promise<PhononInstance> {
    const key = `${lang}|${base}`
    if (this.tts !== null && this.loadedKey === key) return Promise.resolve(this.tts)
    if (this.loadPromise !== null && this.loadedKey === key) return this.loadPromise
    if (this.tts !== null || this.loadPromise !== null) {
      // language or base changed — unload the previous model
      this.dispose()
    }
    this.loadedKey = key
    this.loadPromise = PhononTTS.load({
      lang,
      quant: 'q8',
      device: 'auto',
      model: buildModel(lang, base),
      // voices are ~250 KB each — prefetch all so voice switching works offline
      voices: phononVoices(lang, base).map(v => v.name),
      onProgress,
    }).then(tts => {
      // another language may have been requested meanwhile — unload this one then
      if (this.loadedKey === key) this.tts = tts
      else tts.dispose()
      return tts
    }).finally(() => {
      if (this.loadedKey === key) this.loadPromise = null
    })
    return this.loadPromise
  }

  get loadedBaseUrl(): string | null {
    return this.loadedKey ? this.loadedKey.split('|')[1] : null
  }

  dispose(): void {
    this.tts?.dispose()
    this.tts = null
    this.loadPromise = null
    this.loadedKey = null
  }

  private stream: { cancel(): void } | null = null
  private ctx: AudioContext | null = null

  /** Stop generation and playback */
  cancel(): void {
    this.stream?.cancel()
    this.stream = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx) void ctx.close().catch(() => undefined)
  }

  /** Speak text by streaming: 24 kHz chunks go to an AudioContext as they are generated */
  async speak(text: string, rate: number, voice: string): Promise<SpeakResult> {
    const tts = this.tts
    if (tts === null) throw new TtsError(libT('errTtsNotLoaded'))
    this.cancel()
    const started = performance.now()
    const ctx = new AudioContext({ sampleRate: tts.sampleRate })
    this.ctx = ctx
    const stream = tts.stream(text, { voice })
    this.stream = stream
    let firstAudioMs = 0
    let lastSource: AudioBufferSourceNode | null = null
    let scheduledUntil = 0
    try {
      for await (const pcm of stream) {
        if (firstAudioMs === 0) firstAudioMs = Math.round(performance.now() - started)
        const buffer = ctx.createBuffer(1, pcm.length, tts.sampleRate)
        buffer.getChannelData(0).set(pcm)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.playbackRate.value = rate
        source.connect(ctx.destination)
        scheduledUntil = Math.max(scheduledUntil, ctx.currentTime)
        source.start(scheduledUntil)
        scheduledUntil += buffer.duration / rate
        lastSource = source
      }
      if (firstAudioMs === 0) firstAudioMs = Math.round(performance.now() - started)
      // measure remaining playback BEFORE waiting: after onended it is always ~0
      const playbackMs = Math.max(0, Math.round((scheduledUntil - ctx.currentTime) * 1000))
      if (lastSource !== null) {
        await new Promise<void>(resolve => {
          lastSource!.onended = () => resolve()
        })
      }
      return { firstAudioMs, playbackMs }
    } finally {
      this.stream = null
      if (this.ctx === ctx) this.ctx = null
      void ctx.close().catch(() => undefined)
    }
  }
}

/** Model file download progress (phonon-tts LoadProgress shape) */
export interface PhononLoadProgress {
  file: string
  loaded: number
  total: number | null
  cached: boolean
}

/** The single Phonon engine instance */
export const phononEngine = new PhononEngine()
