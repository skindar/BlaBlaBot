// ASR adapter: whisper via transformers.js (ONNX Runtime Web). WebGPU is the
// primary path (fp32 encoder + q4 decoder); without WebGPU it degrades to
// WASM q8 — slow, but works.

import { pipeline, env } from '@huggingface/transformers'
import type { AsrPort, LoadProgress } from '../../application/ports'
import { AsrError } from '../../application/errors'
import type { TargetLang } from '../../domain/models'
import { langInfo } from '../../domain/policies/languages'
import { libT } from '../../shared/i18nStrings'

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

type AsrPipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string }>

// Weights are cached by the browser; no network round-trips unless needed.
env.remoteHost = 'https://huggingface.co'

export class TransformersAsrEngine implements AsrPort {
  private pipe: AsrPipeline | null = null
  private currentKey: string | null = null
  private usedDevice: 'webgpu' | 'wasm' | null = null
  /** Load serialization: without it StrictMode/double invoke would load the model twice */
  private ensureQueue: Promise<void> = Promise.resolve()

  get loadedKey(): string | null {
    return this.currentKey
  }

  get device(): 'webgpu' | 'wasm' | null {
    return this.usedDevice
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
    const attempts: Array<{ device: 'webgpu' | 'wasm'; dtype: DtypeMap }> = TransformersAsrEngine.hasWebGpu()
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
        this.usedDevice = attempt.device
        return
      } catch (err) {
        lastError = err
      }
    }
    throw new AsrError(
      libT('errAsrLoad', { reason: lastError instanceof Error ? lastError.message : String(lastError) }),
    )
  }

  /**
   * Warm the pipeline: the first call compiles the WebGPU kernels (5–15 s on
   * a cold tab). Running it right after load turns the first real turn from
   * "looks frozen" into a normal one. Silence input is cheap and produces ''.
   */
  async warmUp(targetLang: TargetLang): Promise<void> {
    if (this.pipe === null) return
    const silence = new Float32Array(16000 * 0.4)
    try {
      await this.pipe(silence, { language: langInfo(targetLang).whisper, task: 'transcribe' })
    } catch {
      // warming is best-effort — a real transcribe will surface any real error
    }
  }

  /** Transcribe mono Float32 @ 16 kHz in the target language. Long inputs are
   *  chunked by Whisper itself instead of being pre-split by the caller. */
  async transcribe(pcm16k: Float32Array, targetLang: TargetLang, opts: { long?: boolean } = {}): Promise<string> {
    if (this.pipe === null) throw new AsrError(libT('errAsrNotLoaded'))
    const seconds = pcm16k.length / 16000
    const out = await this.pipe(pcm16k, {
      language: langInfo(targetLang).whisper,
      task: 'transcribe',
      ...(opts.long || seconds > 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    })
    return out.text.trim()
  }
}
