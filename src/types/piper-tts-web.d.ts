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

  export class PiperWebEngine {
    constructor(options?: { onnxRuntime?: unknown })
    generate(text: string, voice: string, speaker?: number): Promise<PiperGenerateResult>
    expressions(phonemeData: unknown): Promise<unknown>
  }

  export const DEFAULT_VOICE: string
}
