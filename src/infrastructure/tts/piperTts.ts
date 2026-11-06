// Piper TTS (VITS, ONNX) — the Russian voice. Phonon has no Russian model,
// and Piper's ru_RU voices are small (~63 MB), run on plain CPU wasm and
// speak faster than real time, which keeps the reply latency of the voice
// loop intact for every language the app supports.
//
// Assets (onnx runtime wasm, piper phonemizer, workers) are copied to the
// site root by vite-plugin-static-copy — see vite.config.ts.

import type { TargetLang } from '../../domain/models'
import { LruCache, speechCacheKey } from './audioClipCache'
import type { PiperWebEngine as PiperWebEngineType } from 'piper-tts-web'

export interface PiperVoice {
  /** voice id used by the engine and by the voice picker */
  id: string
  label: string
}

/** Voices per target language. Only languages Phonon cannot speak live here;
 *  the list is static so the picker works offline. */
export const PIPER_VOICES: Partial<Record<TargetLang, PiperVoice[]>> = {
  ru: [
    { id: 'ru_RU-irina-medium', label: 'Ирина' },
    { id: 'ru_RU-denis-medium', label: 'Денис' },
    { id: 'ru_RU-dmitri-medium', label: 'Дмитрий' },
    { id: 'ru_RU-ruslan-medium', label: 'Руслан' },
  ],
}

export function piperVoiceOrDefault(lang: TargetLang, voice?: string): string {
  const list = PIPER_VOICES[lang] ?? []
  if (voice && list.some(v => v.id === voice)) return voice
  return list[0]?.id ?? ''
}

export class PiperError extends Error {}

type PiperCtor = new (options?: { onnxRuntime?: unknown }) => PiperWebEngineType

export interface PiperSpeakResult {
  /** ms from request to first sound */
  firstAudioMs: number
  /** total ms spent synthesising */
  synthMs: number
  durationMs: number
}

export class PiperEngine {
  private engine: PiperWebEngineType | null = null
  private loading: Promise<void> | null = null
  private currentVoice: string | null = null
  private active: { source: AudioBufferSourceNode; ctx: AudioContext; finish: () => void } | null = null
  private readonly cache = new LruCache<AudioBuffer>(32)
  private warming: Promise<void> | null = null
  private warmedVoice: string | null = null

  get ready(): boolean {
    return this.engine !== null
  }

  get voice(): string | null {
    return this.currentVoice
  }

  /** Load the engine (wasm + onnx runtime); voices load on first use */
  async ensure(): Promise<void> {
    if (this.engine !== null) return
    if (this.loading !== null) return this.loading
    this.loading = (async () => {
      // lazy: the piper/onnx runtime is ~40 MB of JS — only Russian learners
      // ever download it, the main bundle stays lean
      // Load the prebuilt ESM as a static asset, not through Rollup: the
      // bundle is ~44 MB and minifying it in CI took many minutes.
      const piperUrl = new URL('piper-tts-web.js', document.baseURI).href
      const mod = (await import(/* @vite-ignore */ piperUrl)) as {
        PiperWebEngine: PiperCtor
        OnnxWebRuntime: new (options?: { numThreads?: number; basePath?: string }) => unknown
      }
      // ONNX Runtime defaults to navigator.hardwareConcurrency wasm threads.
      // Without SharedArrayBuffer (crossOriginIsolated=false) it falls back to
      // single-threading with a warning — and on memory-heavy pages (a 1.5B
      // WebLLM model next to Whisper) the fallback can die with Aborted(OOM).
      // One thread is enough for a ~0.5 s Russian line and much lighter.
      const onnxRuntime = new mod.OnnxWebRuntime({ numThreads: 1 })
      this.engine = new mod.PiperWebEngine({ onnxRuntime })
    })().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  /** Download the voice and build the ONNX graph BEFORE the first user turn.
   *  A cold `generate` costs 4–5 s; doing it during model loading makes the
   *  first spoken reply feel instant. The generated WAV is discarded — this
   *  method never touches an AudioContext or the speakers. */
  async warmUp(voice: string): Promise<void> {
    if (!voice || this.warmedVoice === voice) return
    if (this.warming !== null) return this.warming
    this.warming = (async () => {
      await this.ensure()
      const engine = this.engine
      if (engine === null) throw new PiperError('Piper engine failed to start')
      await engine.generate('Привет.', voice, 0)
      this.currentVoice = voice
      this.warmedVoice = voice
    })().finally(() => {
      this.warming = null
    })
    return this.warming
  }

  /** Speak text in the given voice; resolves when playback finishes.
   *  The decoded clip is cached: a repeated "Listen" on the same line skips
   *  ONNX synthesis entirely. */
  async speak(text: string, voice: string, rate = 1): Promise<PiperSpeakResult> {
    if (this.engine === null) await this.ensure()
    const engine = this.engine
    if (engine === null) throw new PiperError('Piper engine failed to start')
    this.currentVoice = voice

    const key = speechCacheKey(['piper', voice, text])
    const cached = this.cache.get(key)
    if (cached !== undefined) return this.playBuffer(cached, rate, 0)

    const t0 = performance.now()
    let response: Awaited<ReturnType<PiperWebEngineType['generate']>>
    try {
      response = await engine.generate(text, voice, 0)
    } catch (err) {
      throw new PiperError(
        `piper failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const synthMs = Math.round(performance.now() - t0)
    const bytes = await response.file.arrayBuffer()
    const decodeCtx = new AudioContext()
    const buffer = await decodeCtx.decodeAudioData(bytes)
    void decodeCtx.close().catch(() => undefined)
    this.cache.set(key, buffer)
    return this.playBuffer(buffer, rate, synthMs)
  }

  private async playBuffer(buffer: AudioBuffer, rate: number, synthMs: number): Promise<PiperSpeakResult> {
    // Stop whatever was still playing: pressing "Listen" twice must not
    // stack two voices (and two AudioContexts) on top of each other.
    this.cancel()

    const AudioCtx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(ctx.destination)
    const durationMs = Math.round(buffer.duration * 1000)
    const playMs = Math.max(500, durationMs / Math.max(0.5, rate))
    let finished = false
    let timer = 0
    let resolveDone: (() => void) | null = null
    const done = new Promise<void>(resolve => {
      resolveDone = resolve
    })
    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      if (this.active?.source === source) this.active = null
      resolveDone?.()
    }
    source.onended = finish
    // Resolve by the expected duration instead of `onended`: a host without an
    // audio output device (headless/CI) never fires onended and the caller
    // would hang forever; the timer is bounded and closes the context itself.
    timer = window.setTimeout(finish, playMs)
    this.active = { source, ctx, finish }
    source.start()
    await done
    void ctx.close().catch(() => undefined)
    return { firstAudioMs: synthMs, synthMs, durationMs }
  }

  cancel(): void {
    const active = this.active
    if (!active) return
    this.active = null
    try {
      active.source.stop()
    } catch {
      /* already stopped */
    }
    active.finish()
    void active.ctx.close().catch(() => undefined)
  }
}
