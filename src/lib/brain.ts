// Brain router: the single chat entry for the whole app. 'local' answers via
// WebLLM (in-tab, private, offline); 'cloud' sends the same messages to any
// OpenAI-compatible endpoint the user configured (GLM-4-flash via Custom URL,
// OpenRouter, Groq, a local llama.cpp server, …). The scenario system, ASR
// and TTS do not know the difference — they only see messages in, text out.

import { llmEngine, type ChatResult, type LlmPerf, type LoadProgress } from './llm'
import { libT } from '../i18n'
import type { LlmMessage } from '../prompts'

export interface CloudConfig {
  /** OpenAI-compatible base, e.g. https://openrouter.ai/api/v1 */
  baseUrl: string
  apiKey: string
  model: string
}

export interface BrainConfig {
  kind: 'local' | 'cloud'
  cloud: CloudConfig
}

let brain: BrainConfig = { kind: 'local', cloud: { baseUrl: '', apiKey: '', model: '' } }

export function setBrain(next: BrainConfig): void {
  brain = next
}

export function getBrain(): BrainConfig {
  return brain
}

export function brainInUse(): 'local' | 'cloud' {
  return brain.kind
}

export interface CloudCallDetail {
  ttftMs: number | null
  decodeTokS: number | null
}

class CloudError extends Error {}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** One OpenAI-compatible chat call, streamed so TTFT/decode rate are real. */
export async function cloudChat(
  cfg: CloudConfig,
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; stop?: string[] } = {},
): Promise<ChatResult> {
  const base = normalizeBase(cfg.baseUrl)
  if (!base || !cfg.apiKey.trim() || !cfg.model.trim()) {
    throw new CloudError(libT('errCloudNotConfigured'))
  }
  const t0 = performance.now()
  let ttftMs: number | null = null
  let response: Response
  try {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: cfg.model.trim(),
        messages,
        stream: true,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 900,
        ...(opts.stop ? { stop: opts.stop } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err) {
    // TypeError on fetch is almost always CORS or offline — the two things
    // a browser user can actually act on
    void err
    throw new CloudError(libT('errCloudFetch'))
  }
  if (!response.ok || !response.body) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudError(libT('errCloud401'))
    }
    throw new CloudError(libT('errCloudHttp', { status: response.status, detail }))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let completionTokens: number | null = null
  const toolStart = performance.now()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') continue
      try {
        const chunk = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>
          usage?: { completion_tokens?: number } | null
        }
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          if (ttftMs === null) ttftMs = Math.round(performance.now() - t0)
          text += delta
        }
        if (chunk.usage?.completion_tokens != null) {
          completionTokens = chunk.usage.completion_tokens
        }
      } catch {
        /* partial JSON line — wait for the next chunk */
      }
    }
  }
  const wallMs = Math.round(performance.now() - t0)
  void toolStart
  const decodeTokS =
    completionTokens != null && wallMs > 0 ? Math.round((completionTokens / (wallMs / 1000)) * 10) / 10 : null
  const perf: LlmPerf = {
    promptTokens: null,
    completionTokens,
    ttftMs,
    prefillTokS: null,
    decodeTokS,
    e2eMs: wallMs,
  }
  return { text, perf }
}

/** The one chat entry every caller uses — routes local/cloud by settings. */
export async function chatBrain(
  messages: LlmMessage[],
  opts: { temperature?: number; maxTokens?: number; stop?: string[] } = {},
): Promise<ChatResult> {
  if (brain.kind === 'cloud') return cloudChat(brain.cloud, messages, opts)
  return llmEngine.chat(messages, opts)
}

export type { LoadProgress }
