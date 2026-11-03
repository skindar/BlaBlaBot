// Tutor LLM via WebLLM (@mlc-ai/web-llm): q4f16 weights are downloaded from the HF CDN
// on first run and cached by the browser (Cache API); offline afterwards.

import * as webllm from '@mlc-ai/web-llm'
import { libT } from '../i18n'
import type { LlmMessage } from '../prompts'

export interface LlmModelOption {
  key: string
  modelId: string
  label: string
  /** approximate first-download size */
  size: string
}

/** Sidebar candidates; filtered against the installed web-llm prebuilt list */
const MODEL_CANDIDATES: LlmModelOption[] = [
  { key: 'qwen3-1.7b', modelId: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3-1.7B', size: '' },
  { key: 'gemma-4-e2b', modelId: 'gemma-4-E2B-it-q4f16_1-MLC', label: 'Gemma-4 E2B (как нативная)', size: '' },
  { key: 'qwen3-4b', modelId: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen3-4B', size: '' },
  { key: 'qwen3-0.6b', modelId: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3-0.6B', size: '' },
  { key: 'gemma3-1b', modelId: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma-3-1B', size: '' },
  { key: 'qwen2.5-3b', modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-3B', size: '' },
  { key: 'qwen2.5-1.5b', modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-1.5B', size: '' },
  { key: 'llama-3.2-3b', modelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama-3.2-3B', size: '' },
  { key: 'llama-3.2-1b', modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama-3.2-1B', size: '' },
  { key: 'gemma-2-2b', modelId: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma-2-2B', size: '' },
]

export const DEFAULT_LLM_KEY = 'qwen3-1.7b'

/** Models actually present in this web-llm version's prebuilt config.
 *  size comes from the config's vram_required_MB — the honest tab-memory cost. */
export function availableLlmModels(): LlmModelOption[] {
  const byId = new Map(webllm.prebuiltAppConfig.model_list.map(m => [m.model_id, m]))
  const found = MODEL_CANDIDATES.filter(m => byId.has(m.modelId)).map(m => {
    const vramMb = byId.get(m.modelId)?.vram_required_MB
    const size =
      typeof vramMb === 'number' && Number.isFinite(vramMb)
        ? `RAM ~${(vramMb / 1024).toFixed(1)} ГБ`
        : m.size
    return { ...m, size }
  })
  return found.length > 0 ? found : MODEL_CANDIDATES.slice(0, 1)
}

export function llmModelByKey(key: string): LlmModelOption {
  return availableLlmModels().find(m => m.key === key) ?? availableLlmModels()[0]
}

export interface LoadProgress {
  /** 0..1 when known */
  progress: number
  text: string
}

export class LlmError extends Error {}
export class LlmNotSupportedError extends LlmError {}

export class LlmEngine {
  private engine: webllm.MLCEngine | null = null
  private currentKey: string | null = null
  private loading = false
  /** Load serialization: two parallel ensure() calls must not create
   *  a second engine — two TVM runtimes in one page throw a BindingError
   *  («Expected null or instance of VectorInt…», mlc-ai/web-llm#689) */
  private ensureQueue: Promise<void> = Promise.resolve()

  get loadedKey(): string | null {
    return this.currentKey
  }

  get busy(): boolean {
    return this.loading
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  /** Load (or switch) the model; progress goes to onProgress */
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
    if (this.currentKey === key && this.engine !== null) return
    if (!LlmEngine.supported()) {
      throw new LlmNotSupportedError(libT('errWebgpuMissing'))
    }
    const option = llmModelByKey(key)
    this.loading = true
    try {
      if (this.engine !== null) {
        await this.engine.unload()
        this.engine = null
        this.currentKey = null
      }
      this.engine = await webllm.CreateMLCEngine(option.modelId, {
        initProgressCallback: (report: webllm.InitProgressReport) => {
          onProgress({ progress: report.progress, text: report.text })
        },
      })
      this.currentKey = key
    } finally {
      this.loading = false
    }
  }

  /**
   * One chat call. For Qwen3, thinking is disabled (enable_thinking: false);
   * the parser strips <think> blocks anyway in case the model still emits them.
   */
  async chat(
    messages: LlmMessage[],
    opts: { temperature?: number; maxTokens?: number } = {},
  ): Promise<string> {
    if (this.engine === null || this.currentKey === null) {
      throw new LlmError('LLM ещё не загружена')
    }
    const modelId = llmModelByKey(this.currentKey).modelId
    const isQwen3 = modelId.startsWith('Qwen3')
    // Double protection against Qwen3 thinking: the request flag plus the soft
    // /no_think switch in the system prompt (as the native MLX version did)
    const finalMessages: LlmMessage[] = isQwen3
      ? messages.map((m, i) =>
          i === 0 && m.role === 'system' ? { ...m, content: `${m.content}\n/no_think` } : m,
        )
      : messages
    const body: Record<string, unknown> = {
      messages: finalMessages,
      stream: false,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 900,
    }
    if (isQwen3) body.enable_thinking = false
    // stream: false selects the non-streaming overload → Promise<ChatCompletion>
    const response = await this.engine.chat.completions.create(
      body as unknown as webllm.ChatCompletionRequestNonStreaming,
    )
    const choice = response.choices[0]
    return choice?.message?.content ?? ''
  }
}

/** The single LLM engine instance (shared by engine.ts and useEngine.ts) */
export const llmEngine = new LlmEngine()
