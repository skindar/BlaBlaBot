// Built-in OpenAI-compatible provider profiles. A profile is ONLY a display
// name + base URL + model; the API token is a separate setting and never goes
// into a profile.

export interface CloudProviderProfile {
  id: string
  label: string
  baseUrl: string
  model: string
}

export const CLOUD_PROVIDER_PROFILES: CloudProviderProfile[] = [
  {
    id: 'stepfun',
    label: 'StepFun · step-3.7-flash',
    baseUrl: 'https://api.stepfun.ai/v1',
    model: 'step-3.7-flash',
  },
  {
    id: 'zhipu',
    label: 'Z.AI / BigModel · glm-4-flash',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter · openai/gpt-4o-mini',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  {
    id: 'custom',
    label: 'Custom endpoint',
    baseUrl: '',
    model: '',
  },
]

export function cloudProviderById(id: string): CloudProviderProfile {
  return CLOUD_PROVIDER_PROFILES.find(p => p.id === id) ?? CLOUD_PROVIDER_PROFILES[CLOUD_PROVIDER_PROFILES.length - 1]
}

/** Detect the profile from an already saved URL/model pair. */
export function detectCloudProvider(baseUrl: string, model: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return 'custom'
  const exact = CLOUD_PROVIDER_PROFILES.find(
    p => p.id !== 'custom' && p.baseUrl.replace(/\/+$/, '') === base,
  )
  if (exact) return exact.id
  if (/stepfun\.ai/i.test(base) || /^step-/i.test(model.trim())) return 'stepfun'
  if (/bigmodel\.cn|z\.ai/i.test(base)) return 'zhipu'
  if (/openrouter\.ai/i.test(base)) return 'openrouter'
  return 'custom'
}
