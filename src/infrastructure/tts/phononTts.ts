// Phonon TTS in the browser: the official phonon-tts WASM package (streaming 24 kHz,
// WebGPU/CPU). The model is chosen by target language:
//   • de — phonon-40m-de self-hosted (dev files in public/models, GitHub Release
//     in prod) + 13 local voices; an unreachable base falls back to multilingual;
//   • en — public phonon-31m-en (Apache 2.0) + the gradium/phonon-voices catalog;
//   • fr/es/pt — the public mirror of phonon-40m-multilingual (en/fr/de/es/pt)
//     + per-language catalog voices (the per-language gradium models are gated).
// Files are cached in the Cache API after the first download; offline afterwards.

import { PhononTTS, type ModelSpec, type PhononTTS as PhononInstance } from 'phonon-tts'
import { SpeechError } from '../../application/errors'
import { libT } from '../../shared/i18nStrings'
import {
  isHfUrl,
  multilingualFile,
  phonon31mEnFile,
  phononVoices,
  probePhononBase,
  resolvePhononVoice,
  MULTILINGUAL_BASE,
  PHONON_31M_EN_BASE,
  type PhononVoiceInfo,
} from '../../domain/policies/languages'
import type { TargetLang } from '../../domain/models'
import { LruCache, speechCacheKey } from './audioClipCache'

export type { PhononVoiceInfo }

function withSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

/** Voices of a (language, base) pair as a ModelSpec voice map */
function voiceMap(lang: TargetLang, base: string): Record<string, string> {
  const voices: Record<string, string> = {}
  for (const v of phononVoices(lang, base)) voices[v.name] = v.url
  return voices
}

/** Where the checkpoint files are. Always a ModelSpec when the voices come
 *  from elsewhere than the model folder (catalog/HF files) — a plain string
 *  would leave the requested voices unknown to the model. Only a generic
 *  hf:// repo is passed through for phonon-tts to resolve itself. */
function buildModel(lang: TargetLang, base: string): ModelSpec | string {
  // Multilingual model (fr/es/pt default + fallback): weights from the public
  // mirror, voices from the per-language public catalog.
  if (base.startsWith(MULTILINGUAL_BASE)) {
    return {
      weights: { q8: multilingualFile('model.q8.gguf') },
      tokenizer: multilingualFile('tokenizer.json'),
      config: multilingualFile('config.json'),
      voices: voiceMap(lang, base),
      defaultVoice: resolvePhononVoice(lang, base),
    }
  }
  // Public English model: own default voice + the catalog.
  if (lang === 'en' && base.startsWith(PHONON_31M_EN_BASE)) {
    return {
      weights: { q8: phonon31mEnFile('model.q8.gguf') },
      tokenizer: phonon31mEnFile('tokenizer.json'),
      config: phonon31mEnFile('config.json'),
      voices: voiceMap(lang, base),
      defaultVoice: resolvePhononVoice(lang, base),
    }
  }
  // Any other public hf:// repo: let phonon-tts pick the repo's own files/voices.
  if (isHfUrl(base)) return base
  // Self-hosted base (local dev folder, GitHub Release, custom mirror):
  // model files and voice files next to each other.
  const b = withSlash(base)
  return {
    weights: { q8: `${b}model.q8.gguf` },
    tokenizer: `${b}tokenizer.json`,
    config: `${b}config.json`,
    voices: voiceMap(lang, base),
    defaultVoice: resolvePhononVoice(lang, base),
  }
}

export interface SpeakResult {
  /** ms from request to first sound — the honest TTS stage timing */
  firstAudioMs: number
  /** playback duration in ms (at the given rate) */
  playbackMs: number
}

export class TtsError extends SpeechError {}

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

  /** Load the language's model (or return the loaded one); q8, WebGPU when available.
   *  Only the selected voice is prefetched (~250 KB); the rest of the catalog
   *  loads on first use and is cached. */
  ensure(
    lang: TargetLang,
    base: string,
    voice: string,
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
    this.loadPromise = this.loadWithFallback(lang, base, voice, onProgress)
      .then(tts => {
        // another language may have been requested meanwhile — unload this one then
        if (this.loadedKey === key) this.tts = tts
        else tts.dispose()
        return tts
      })
      .finally(() => {
        if (this.loadedKey === key) this.loadPromise = null
      })
    return this.loadPromise
  }

  /** Load the requested base; if it cannot be reached (gated HF repo, missing
   *  self-hosted files, dead mirror), fall back once to the public
   *  multilingual model with the language's catalog voices — every target
   *  language keeps a working voice instead of a hard error. */
  private async loadWithFallback(
    lang: TargetLang,
    base: string,
    voice: string,
    onProgress: (p: PhononLoadProgress) => void,
  ): Promise<PhononInstance> {
    let effective = base
    // self-hosted base without a config.json: do not even try the weights
    if (!isHfUrl(base) && !(await probePhononBase(base))) effective = MULTILINGUAL_BASE
    try {
      return await this.doLoad(lang, effective, resolvePhononVoice(lang, effective, voice), onProgress)
    } catch (err) {
      if (effective === MULTILINGUAL_BASE) throw err
      return await this.doLoad(
        lang,
        MULTILINGUAL_BASE,
        resolvePhononVoice(lang, MULTILINGUAL_BASE, voice),
        onProgress,
      )
    }
  }

  private doLoad(
    lang: TargetLang,
    base: string,
    voice: string,
    onProgress: (p: PhononLoadProgress) => void,
  ): Promise<PhononInstance> {
    const model = buildModel(lang, base)
    // Russian has no Phonon model — the Piper engine handles it (engine.ts
    // routes ru to piperTts). This is a guard, not a normal path.
    if (lang === 'ru') {
      return Promise.reject(new Error('phonon has no Russian model — use Piper'))
    }
    return PhononTTS.load({
      lang,
      quant: 'q8',
      device: 'auto',
      model,
      // A generic hf:// repo manages its own voice names — nothing to prefetch
      voices: typeof model === 'string' ? undefined : [voice],
      onProgress,
    })
  }

  dispose(): void {
    this.cancel()
    this.cache.clear()
    this.tts?.dispose()
    this.tts = null
    this.loadPromise = null
    this.loadedKey = null
  }

  private stream: { cancel(): void } | null = null
  private ctx: AudioContext | null = null
  private readonly cache = new LruCache<AudioBuffer>(24)

  /** Stop generation and playback */
  cancel(): void {
    this.stream?.cancel()
    this.stream = null
    const ctx = this.ctx
    this.ctx = null
    if (ctx) void ctx.close().catch(() => undefined)
  }

  /** Speak text by streaming: 24 kHz chunks go to an AudioContext as they are
   *  generated. The finished clip is cached, so replaying the same line skips
   *  generation and streaming entirely. */
  async speak(text: string, rate: number, voice: string): Promise<SpeakResult> {
    const tts = this.tts
    if (tts === null) throw new TtsError(libT('errTtsNotLoaded'))
    this.cancel()
    // A stale saved voice name (base switched, voice not hosted) must not
    // kill the line — speak the model's default instead.
    const known = tts.voices
    const effectiveVoice = voice && known.includes(voice) ? voice : (known[0] ?? voice)
    const key = speechCacheKey(['phonon', this.loadedKey ?? '', effectiveVoice, text])
    const cached = this.cache.get(key)
    if (cached !== undefined) return this.playBuffer(cached, rate)

    const started = performance.now()
    const ctx = new AudioContext({ sampleRate: tts.sampleRate })
    this.ctx = ctx
    const stream = tts.stream(text, { voice: effectiveVoice })
    this.stream = stream
    let firstAudioMs = 0
    let lastSource: AudioBufferSourceNode | null = null
    let scheduledUntil = 0
    const chunks: Float32Array[] = []
    let total = 0
    try {
      for await (const pcm of stream) {
        if (firstAudioMs === 0) firstAudioMs = Math.round(performance.now() - started)
        chunks.push(pcm)
        total += pcm.length
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
        await waitForSource(lastSource, playbackMs)
      }
      if (total > 0) {
        const clip = ctx.createBuffer(1, total, tts.sampleRate)
        const data = clip.getChannelData(0)
        let offset = 0
        for (const chunk of chunks) {
          data.set(chunk, offset)
          offset += chunk.length
        }
        this.cache.set(key, clip)
      }
      return { firstAudioMs, playbackMs }
    } finally {
      this.stream = null
      if (this.ctx === ctx) this.ctx = null
      void ctx.close().catch(() => undefined)
    }
  }

  /** Play a cached clip (no model, no streaming) and resolve when it ends. */
  private async playBuffer(buffer: AudioBuffer, rate: number): Promise<SpeakResult> {
    const ctx = new AudioContext({ sampleRate: buffer.sampleRate })
    this.ctx = ctx
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(ctx.destination)
    const playbackMs = Math.max(0, Math.round((buffer.duration / Math.max(0.5, rate)) * 1000))
    const started = performance.now()
    source.start()
    const firstAudioMs = Math.max(0, Math.round(performance.now() - started))
    try {
      await waitForSource(source, playbackMs)
    } finally {
      if (this.ctx === ctx) this.ctx = null
      void ctx.close().catch(() => undefined)
    }
    return { firstAudioMs, playbackMs }
  }

}

/** Resolve by expected duration as a fallback: a host without an audio output
 *  device may never fire `onended`. */
function waitForSource(source: AudioBufferSourceNode, playbackMs: number): Promise<void> {
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, Math.max(200, playbackMs) + 100)
    source.onended = finish
  })
}

/** Model file download progress (phonon-tts LoadProgress shape) */
export interface PhononLoadProgress {
  file: string
  loaded: number
  total: number | null
  cached: boolean
}
