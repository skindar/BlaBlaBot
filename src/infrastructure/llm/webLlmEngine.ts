// WebLLM adapter: model download/switch + one non-streaming chat call.
// Implements the application's LlmLoaderPort; it is the only module that
// imports @mlc-ai/web-llm directly.

import * as webllm from '@mlc-ai/web-llm'
import type { LlmLoaderPort, LoadProgress } from '../../application/ports'
import { LlmError, LlmNotSupportedError } from '../../application/errors'
import type { LlmCallOptions, LlmMessage, LlmPerf, LlmReply } from '../../domain/models'
import { libT } from '../../shared/i18nStrings'
import { llmModelByKey, samplingForModel } from './catalog'

export class WebLlmEngine implements LlmLoaderPort {
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

  /** Where inference runs — WebLLM is WebGPU-only. */
  get deviceLabel(): string {
    return WebLlmEngine.supported() ? 'WebGPU' : 'none'
  }

  static supported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator
  }

  supported(): boolean {
    return WebLlmEngine.supported()
  }

  /** Load (or switch) the model; progress goes to onProgress. */
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
    if (!WebLlmEngine.supported()) {
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
   * One chat call. Qwen3 thinking is disabled (request flag + /no_think);
   * the parser strips  thinking blocks regardless.
   */
  async chat(messages: LlmMessage[], opts: LlmCallOptions = {}): Promise<LlmReply> {
    if (this.engine === null || this.currentKey === null) {
      throw new LlmError(libT('errLlmNotLoaded'))
    }
    const modelId = llmModelByKey(this.currentKey).modelId
    const isQwen3 = modelId.startsWith('Qwen3')
    const finalMessages: LlmMessage[] = isQwen3
      ? messages.map((m, i) =>
          i === 0 && m.role === 'system' ? { ...m, content: `${m.content}\n/no_think` } : m,
        )
      : messages
    const sampling = samplingForModel(modelId)
    const body: Record<string, unknown> = {
      messages: finalMessages,
      stream: false,
      temperature: opts.temperature ?? sampling.temperature ?? 0.7,
      top_p: opts.topP ?? sampling.topP,
      repetition_penalty: opts.repetitionPenalty ?? sampling.repetitionPenalty,
      max_tokens: opts.maxTokens ?? 900,
    }
    if (opts.stop && opts.stop.length > 0) body.stop = opts.stop
    if (isQwen3) body.enable_thinking = false
    const response = await this.engine.chat.completions.create(
      body as unknown as webllm.ChatCompletionRequestNonStreaming,
    )
    const choice = response.choices[0]
    const usage = response.usage
    let perf: LlmPerf | null = null
    if (usage) {
      perf = {
        promptTokens: usage.prompt_tokens ?? null,
        completionTokens: usage.completion_tokens ?? null,
        ttftMs: usage.extra?.time_to_first_token_s != null ? usage.extra.time_to_first_token_s * 1000 : null,
        prefillTokS: usage.extra?.prefill_tokens_per_s ?? null,
        decodeTokS: usage.extra?.decode_tokens_per_s ?? null,
        e2eMs: usage.extra?.e2e_latency_s != null ? usage.extra.e2e_latency_s * 1000 : null,
      }
    }
    return { text: choice?.message?.content ?? '', perf }
  }
}
