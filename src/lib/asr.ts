// ASR: whisper via transformers.js (ONNX Runtime Web). WebGPU is the primary path
// (as in the official whisper-web demo: fp32 encoder + q4 decoder);
// without WebGPU it degrades to WASM q8 — slow, but works.

import { pipeline, env } from '@huggingface/transformers'
import { libT } from '../i18n'
import type { TargetLang } from './langs'
import type { LoadProgress } from './llm'

export interface AsrModelOption {
  key: string
  modelId: string
  label: string
  size: string
}

export const ASR_MODELS: AsrModelOption[] = [
  { key: 'tiny', modelId: 'onnx-community/whisper-tiny', label: 'Whisper tiny', size: '~40 МБ' },
  { key: 'base', modelId: 'onnx-community/whisper-base', label: 'Whisper base', size: '~80 МБ' },
  { key: 'small', modelId: 'onnx-community/whisper-small', label: 'Whisper small', size: '~250 МБ' },
]

export const DEFAULT_ASR_KEY = 'base'

export function asrModelByKey(key: string): AsrModelOption {
  return ASR_MODELS.find(m => m.key === key) ?? ASR_MODELS[1]
}

export class AsrError extends Error {}
export class AsrNotSupportedError extends AsrError {}

type AsrPipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string }>

// Weights are cached by the browser; no network round-trips unless needed.
env.remoteHost = 'https://huggingface.co'

export class AsrEngine {
  private pipe: AsrPipeline | null = null
  private currentKey: string | null = null
  /** 'webgpu' | 'wasm' — what actually got used */
  device: string | null = null
  /** Load serialization: without it StrictMode/double invoke would load the model twice */
  private ensureQueue: Promise<void> = Promise.resolve()

  get loadedKey(): string | null {
    return this.currentKey
  }

  static hasWebGpu(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  ensure(key: string, onProgress: (p: LoadProgress) => void): Promise<void> {
    const run = this.ensureQueue.then(
      () => this.doEnsure(key, onProgress),
      () => this.doEnsure(key, onProgress),
    )
    this.ensureQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async doEnsure(key: string, onProgress: (p: LoadProgress) => void): Promise<void> {
    if (this.currentKey === key && this.pipe !== null) return
    const option = asrModelByKey(key)
    type DtypeMap = Record<string, 'fp32' | 'q4' | 'q8'>
    const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: DtypeMap }> = AsrEngine.hasWebGpu()
      ? [
          { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
          { device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
        ]
      : [{ device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } }]

    let lastError: unknown = null
    for (const attempt of attempts) {
      try {
        this.pipe = null
        this.currentKey = null
        const created = (await pipeline('automatic-speech-recognition', option.modelId, {
          device: attempt.device,
          dtype: attempt.dtype,
          progress_callback: (info: unknown) => {
            const p = info as { status?: string; progress?: number; file?: string }
            if (p && (p.status === 'progress' || p.status === 'download') && typeof p.progress === 'number') {
              onProgress({ progress: p.progress / 100, text: `${p.file ?? '…'} ${Math.round(p.progress)}%` })
            } else if (p && p.status === 'ready') {
              onProgress({ progress: 1, text: '…' })
            }
          },
        })) as unknown as AsrPipeline
        this.pipe = created
        this.currentKey = key
        this.device = attempt.device
        return
      } catch (err) {
        lastError = err
      }
    }
    throw new AsrError(libT('errAsrLoad', { reason: lastError instanceof Error ? lastError.message : String(lastError) }))
  }

  /** Transcribe the target language from mono Float32 @ 16 kHz */
  async transcribe(pcm16k: Float32Array, targetLang: TargetLang): Promise<string> {
    if (this.pipe === null) throw new AsrError(libT('errAsrNotLoaded'))
    const out = await this.pipe(pcm16k, { language: targetLang, task: 'transcribe' })
    return out.text.trim()
  }
}

/** The single ASR engine instance */
export const asrEngine = new AsrEngine()
