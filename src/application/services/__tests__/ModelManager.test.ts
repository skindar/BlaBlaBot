import { describe, expect, it, vi } from 'vitest'
import { ModelManager } from '../ModelManager'
import type { LlmLoaderPort, LoadProgress, ModelManagerPort } from '../../ports'
import { FakeAsr, FakeClock, FakeSpeech, FakeTelemetry } from '../../../test/fakes'
import { defaultSettings } from '../../../domain/policies/settings'
import type { Settings } from '../../../domain/models'

class FakeLoader implements LlmLoaderPort {
  loadedKey: string | null = null
  deviceLabel = 'WebGPU'
  ensureCalls: string[] = []
  supported(): boolean {
    return true
  }
  ensure(key: string, onProgress: (p: LoadProgress) => void): Promise<void> {
    this.ensureCalls.push(key)
    onProgress({ progress: 0.5, text: 'fetching 50%' })
    this.loadedKey = key
    onProgress({ progress: 1, text: 'ready' })
    return Promise.resolve()
  }
}

function build(settings: Settings, systemAsrAvailable = true) {
  const llm = new FakeLoader()
  const asr = new FakeAsr()
  const speech = new FakeSpeech()
  const telemetry = new FakeTelemetry()
  const clock = new FakeClock()
  const configureBrain = vi.fn()
  const manager: ModelManagerPort = new ModelManager({
    llm,
    asr,
    speech,
    telemetry,
    clock,
    configureBrain,
    brainKind: s => s.brain,
    llmLabel: key => `label:${key}`,
    asrDevice: () => 'WebGPU',
    systemAsrAvailable: () => systemAsrAvailable,
  })
  manager.apply(settings)
  return { manager, llm, asr, speech, telemetry, configureBrain }
}

describe('ModelManager', () => {
  it('loads TTS, ASR and the local LLM, then reports ready', async () => {
    const settings = defaultSettings('ru', { llmModel: 'gemma-3-1b', asrModel: 'base' })
    const ctx = build(settings)
    await vi.waitFor(() => expect(ctx.manager.status().ready).toBe(true))
    const status = ctx.manager.status()
    expect(status.models.tts.state).toBe('ready')
    expect(status.models.asr.state).toBe('ready')
    expect(status.models.llm.state).toBe('ready')
    expect(status.llmCurrent).toBe('gemma-3-1b')
    expect(ctx.llm.ensureCalls).toEqual(['gemma-3-1b'])
    expect(ctx.telemetry.loadLog.length).toBeGreaterThanOrEqual(2)
    expect(ctx.configureBrain).toHaveBeenCalled()
  })

  it('does not download the local model when the cloud brain is selected', async () => {
    const settings: Settings = {
      ...defaultSettings('ru', { llmModel: 'gemma-3-1b', asrModel: 'base' }),
      brain: 'cloud',
      cloudBaseUrl: 'https://example.test/v1',
      cloudApiKey: 'key',
      cloudModel: 'glm-4-flash',
    }
    const ctx = build(settings)
    await vi.waitFor(() => expect(ctx.manager.status().models.llm.state).toBe('ready'))
    expect(ctx.llm.ensureCalls).toEqual([])
    expect(ctx.manager.status().llmCurrent).toBe('cloud')
  })

  it('skips Whisper when the system recognizer is selected', async () => {
    const settings: Settings = {
      ...defaultSettings('ru', { llmModel: 'gemma-3-1b', asrModel: 'base' }),
      asrEngine: 'system',
    }
    const ctx = build(settings)
    await vi.waitFor(() => expect(ctx.manager.status().ready).toBe(true))
    expect(ctx.manager.status().models.asr.state).toBe('ready')
    expect(ctx.asr.ensureCalls).toBe(0)
  })

  it('reports a clear error when system ASR is unavailable', async () => {
    const settings: Settings = {
      ...defaultSettings('ru', { llmModel: 'gemma-3-1b', asrModel: 'base' }),
      asrEngine: 'system',
    }
    const ctx = build(settings, false)
    await vi.waitFor(() => expect(ctx.manager.status().models.asr.state).toBe('error'))
    expect(ctx.manager.status().models.asr.error).toContain('недоступно')
    expect(ctx.manager.status().ready).toBe(false)
  })

  it('does not reload models when only the level changes', async () => {
    const settings = defaultSettings('ru', { llmModel: 'gemma-3-1b', asrModel: 'base' })
    const ctx = build(settings)
    await vi.waitFor(() => expect(ctx.manager.status().ready).toBe(true))
    const loadsBefore = ctx.telemetry.loadLog.length
    ctx.manager.apply({ ...settings, level: 'B1' })
    await new Promise(r => setTimeout(r, 10))
    expect(ctx.telemetry.loadLog.length).toBe(loadsBefore)
    expect(ctx.llm.ensureCalls).toEqual(['gemma-3-1b'])
  })

  it('surfaces an honest error when a model fails to load', async () => {
    const settings = defaultSettings('ru', { llmModel: 'gemma-3-1b', asrModel: 'base' })
    const ctx = build(settings)
    ctx.llm.ensure = () => Promise.reject(new Error('download failed'))
    ctx.manager.apply({ ...settings, llmModel: 'gemma-3-1b', targetLang: 'en' })
    await vi.waitFor(() => expect(ctx.manager.status().models.llm.state).toBe('error'))
    expect(ctx.manager.status().models.llm.error).toContain('download failed')
    expect(ctx.manager.status().ready).toBe(false)
  })
})
