// Minimal typings for piper-tts-web (the package ships no .d.ts).
// Only the surface this app uses is declared.

declare module 'piper-tts-web' {
  export interface PiperGenerateResult {
    /** 16-bit mono WAV of the synthesised speech */
    file: Blob
    /** duration in ms */
    duration: number
    phonemeData: unknown
  }

  export interface OnnxRuntimeOptions {
    /** where ort-wasm-*.wasm lives (defaults to /onnx/) */
    basePath?: string
    /** wasm threads; 1 avoids the SharedArrayBuffer requirement and the
     *  "falling back to single-threading" warning under memory pressure */
    numThreads?: number
  }

  export class OnnxWebRuntime {
    constructor(options?: OnnxRuntimeOptions)
    destroy(): void
  }

  export class PiperWebEngine {
    constructor(options?: { onnxRuntime?: OnnxWebRuntime; phonemizeRuntime?: unknown; expressionRuntime?: unknown; voiceProvider?: unknown })
    generate(text: string, voice: string, speaker?: number): Promise<PiperGenerateResult>
    expressions(phonemeData: unknown): Promise<unknown>
    destroy(): void
  }

  export const DEFAULT_VOICE: string
}
