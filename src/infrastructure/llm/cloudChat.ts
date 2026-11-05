// OpenAI-compatible chat client (bring-your-own endpoint). Streamed so the
// TTFT/decode numbers are real, not estimated.

import { LlmError } from '../../application/errors'
import type { LlmCallOptions, LlmMessage, LlmPerf, LlmReply } from '../../domain/models'
import { libT } from '../../shared/i18nStrings'

export interface CloudConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/** One OpenAI-compatible chat call, streamed so TTFT/decode rate are real. */
export async function cloudChat(
  cfg: CloudConfig,
  messages: LlmMessage[],
  opts: LlmCallOptions = {},
): Promise<LlmReply> {
  const base = normalizeBase(cfg.baseUrl)
  if (!base || !cfg.apiKey.trim() || !cfg.model.trim()) {
    throw new LlmError(libT('errCloudNotConfigured'))
  }
  const directStepFun = /^https?:\/\/api\.stepfun\.ai/i.test(base)
  const isStepFun =
    directStepFun || /__cloud\/stepfun/i.test(base) || /^step-/i.test(cfg.model.trim())
  // StepFun has no CORS headers. In dev we transparently route the direct URL
  // through Vite's same-origin proxy so the existing settings just work.
  const effectiveBase = directStepFun && import.meta.env.DEV ? '/__cloud/stepfun/v1' : base
  const t0 = performance.now()
  let ttftMs: number | null = null
  // GLM-5.x spends most of the token budget on hidden reasoning before the
  // answer — deadly for a voice tutor. Z.AI/BigModel endpoints accept an
  // explicit off-switch; other providers get the param omitted.
  const glmHost = /z\.ai|bigmodel|zhipu/i.test(base)
  const buildBody = (withThinkingOff: boolean) => ({
    model: cfg.model.trim(),
    messages,
    stream: true,
    temperature: opts.temperature ?? 0.7,
    ...(opts.topP != null ? { top_p: opts.topP } : {}),
    // Reasoning models can burn the whole budget on hidden thinking and
    // return an empty `content` (measured: step-3.7-flash exhausted 900).
    max_tokens: Math.max(opts.maxTokens ?? 900, isStepFun ? 4096 : 900),
    ...(opts.stop ? { stop: opts.stop } : {}),
    ...(withThinkingOff ? { thinking: { type: 'disabled' } } : {}),
    ...(isStepFun ? { reasoning_effort: 'low' } : {}),
  })
  let response: Response
  try {
    response = await fetch(`${effectiveBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify(buildBody(glmHost)),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    // TypeError on fetch is almost always CORS or offline — the two things
    // a browser user can actually act on
    throw new LlmError(libT(isStepFun ? 'errCloudStepfunCors' : 'errCloudFetch'))
  }
  if (!response.ok || !response.body) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    if (response.status === 401 || response.status === 403) {
      throw new LlmError(libT('errCloud401'))
    }
    throw new LlmError(libT('errCloudHttp', { status: response.status, detail }))
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let finishReason: string | null = null
  let completionTokens: number | null = null
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
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
          usage?: { completion_tokens?: number } | null
        }
        const choice = chunk.choices?.[0]
        const delta = choice?.delta?.content
        if (delta) {
          if (ttftMs === null) ttftMs = Math.round(performance.now() - t0)
          text += delta
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (chunk.usage?.completion_tokens != null) {
          completionTokens = chunk.usage.completion_tokens
        }
      } catch {
        /* partial JSON line — wait for the next chunk */
      }
    }
  }
  if (!text.trim()) {
    throw new LlmError(libT(finishReason === 'length' ? 'errCloudReasoningTruncated' : 'errCloudEmpty'))
  }
  const wallMs = Math.round(performance.now() - t0)
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
