import { describe, expect, it } from 'vitest'
import { cloudProviderById, detectCloudProvider } from '../cloudProviders'

describe('cloud provider profiles', () => {
  it('detects StepFun from its base URL or model', () => {
    expect(detectCloudProvider('https://api.stepfun.ai/v1', 'step-3.7-flash')).toBe('stepfun')
    expect(detectCloudProvider('https://my-proxy.example.com/v1', 'step-3.7-flash')).toBe('stepfun')
  })

  it('detects Z.AI and falls back to custom', () => {
    expect(detectCloudProvider('https://open.bigmodel.cn/api/paas/v4', 'glm-4-flash')).toBe('zhipu')
    expect(detectCloudProvider('https://example.com/v1', 'my-model')).toBe('custom')
  })

  it('returns the StepFun URL/model without a token', () => {
    const profile = cloudProviderById('stepfun')
    expect(profile.baseUrl).toBe('https://api.stepfun.ai/v1')
    expect(profile.model).toBe('step-3.7-flash')
    expect(Object.keys(profile)).not.toContain('token')
    expect(Object.keys(profile)).not.toContain('apiKey')
  })
})
