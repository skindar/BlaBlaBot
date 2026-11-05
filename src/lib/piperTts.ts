// Piper TTS (VITS, ONNX) — the Russian voice. Phonon has no Russian model,
// and Piper's ru_RU voices are small (~63 MB), run on plain CPU wasm and
// speak faster than real time, which keeps the reply latency of the voice
// loop intact for every language the app supports.
//
// Assets (onnx runtime wasm, piper phonemizer, workers) are copied to the
// site root by vite-plugin-static-copy — see vite.config.ts.

import type { TargetLang } from './langs'
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
      const mod = (await import('piper-tts-web')) as { PiperWebEngine: PiperCtor }
      const EngineCtor = mod.PiperWebEngine
      this.engine = new EngineCtor()
      // No warm-up here: a pre-generate call on a fresh engine blocks until
      // the voice is downloaded AND the onnx graph is built, which under the
      // real load order looks like a hang. The first reply pays that cost
      // once (~3 s) and every later one is ~0.5 s.
    })().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  /** Speak text in the given voice; resolves when playback finishes */
  async speak(text: string, voice: string, rate = 1): Promise<PiperSpeakResult> {
    if (this.engine === null) await this.ensure()
    const engine = this.engine
    if (engine === null) throw new PiperError('Piper engine failed to start')
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
    this.currentVoice = voice

    const AudioCtx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    const bytes = await response.file.arrayBuffer()
    const buffer = await ctx.decodeAudioData(bytes)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = rate
    source.connect(ctx.destination)
    const durationMs = Math.round(buffer.duration * 1000)
    const playMs = Math.max(500, durationMs / Math.max(0.5, rate))
    source.start()
    // Resolve by the expected duration instead of `onended`: a host without an
    // audio output device (headless/CI) never fires onended and the caller
    // would hang forever; the timer is bounded and closes the context itself.
    await new Promise<void>(resolve => {
      const timer = window.setTimeout(resolve, playMs)
      source.onended = () => {
        window.clearTimeout(timer)
        resolve()
      }
    })
    void ctx.close().catch(() => undefined)
    return { firstAudioMs: synthMs, synthMs, durationMs }
  }

  cancel(): void {
    // the generated audio is short; closing happens per call
  }
}

/** The single Piper engine instance */
export const piperEngine = new PiperEngine()
