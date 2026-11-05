// Curated WebLLM model catalog, filtered against the installed prebuilt list.
// Keeping the catalog in infrastructure means the application only sees a
// model key and its capabilities (tiny vs full, prompt budget).

import * as webllm from '@mlc-ai/web-llm'

export interface LlmModelOption {
  key: string
  modelId: string
  label: string
  /** approximate first-download size */
  size: string
  /** ~1B and below: use the tiny-tier prompt contract */
  tiny?: boolean
}

/** Note the Gemma-3 ID: "gemma3-1b-it…" (no hyphen in "gemma3"). */
const MODEL_CANDIDATES: LlmModelOption[] = [
  { key: 'gemma-3-1b', modelId: 'gemma3-1b-it-q4f16_1-MLC', label: 'Gemma-3-1B-IT 🌐', size: '', tiny: true },
  { key: 'llama-3.2-1b', modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama-3.2-1B-Instruct', size: '', tiny: true },
  { key: 'llama-3.2-1b-f32', modelId: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', label: 'Llama-3.2-1B-Instruct (f32)', size: '', tiny: true },
  { key: 'qwen2.5-1.5b', modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-1.5B-Instruct', size: '' },
  { key: 'qwen2.5-1.5b-f32', modelId: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC', label: 'Qwen2.5-1.5B-Instruct (f32)', size: '' },
  { key: 'qwen2.5-3b', modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5-3B-Instruct', size: '' },
  { key: 'gemma-4-e2b', modelId: 'gemma-4-E2B-it-q4f16_1-MLC', label: 'Gemma-4 E2B', size: '' },
]

export const DEFAULT_LLM_KEY = 'gemma-3-1b'

export interface SamplingDefaults {
  /** undefined = let the caller choose */
  temperature?: number
  topP: number
  repetitionPenalty: number
}

/** Sampling defaults per model family. Qwen2.5 values come from the model's
 *  own `generation_config.json` (temperature 0.7, top_p 0.8,
 *  repetition_penalty 1.1); top_k is not exposed by WebLLM's chat API. The
 *  other families keep a neutral nucleus/penalty and the caller's temperature. */
export function samplingForModel(modelId: string): SamplingDefaults {
  if (/Qwen2\.5/i.test(modelId)) return { temperature: 0.7, topP: 0.8, repetitionPenalty: 1.1 }
  return { topP: 0.9, repetitionPenalty: 1.0 }
}

/** Models actually present in this web-llm version's prebuilt config.
 *  size comes from the config's vram_required_MB — the honest tab-memory cost. */
export function availableLlmModels(): LlmModelOption[] {
  const byId = new Map(webllm.prebuiltAppConfig.model_list.map(m => [m.model_id, m]))
  const found: Array<{ option: LlmModelOption; vramMb: number }> = MODEL_CANDIDATES.filter(m =>
    byId.has(m.modelId),
  ).map(m => {
    const vramMb = byId.get(m.modelId)?.vram_required_MB
    const known = typeof vramMb === 'number' && Number.isFinite(vramMb)
    return {
      option: {
        ...m,
        size: known ? `RAM ~${((vramMb as number) / 1024).toFixed(1)} ГБ` : m.size,
      },
      // unknown memory cost sorts last instead of breaking the order
      vramMb: known ? (vramMb as number) : Number.POSITIVE_INFINITY,
    }
  })
  // smallest → largest (tab memory, then label as the tie-breaker)
  found.sort((a, b) => a.vramMb - b.vramMb || a.option.label.localeCompare(b.option.label))
  const options = found.map(f => f.option)
  return options.length > 0 ? options : MODEL_CANDIDATES.slice(0, 1)
}

export function llmModelByKey(key: string): LlmModelOption {
  return availableLlmModels().find(m => m.key === key) ?? availableLlmModels()[0]
}

export function isKnownLlmKey(key: string): boolean {
  return availableLlmModels().some(m => m.key === key)
}

/** Context window of the prebuilt web-llm build (overrides.context_window_size,
 *  hard-capped to 4096 in every prebuilt model regardless of the model's native
 *  capability) plus the KV-cache margin to reserve for generation. */
export function contextWindowFor(key: string): { window: number; promptBudget: number } {
  const option = llmModelByKey(key)
  const rec = webllm.prebuiltAppConfig.model_list.find(m => m.model_id === option.modelId)
  const window =
    (rec as { overrides?: { context_window_size?: number } } | undefined)?.overrides?.context_window_size ?? 4096
  // reserve: max_tokens (900) + safety margin (256)
  return { window, promptBudget: Math.max(0, window - 900 - 256) }
}
