import { describe, expect, it } from 'vitest'
import { SettingsService } from '../SettingsService'
import type { Settings, SettingsRepository } from '../../ports'
import { defaultSettings } from '../../../domain/policies/settings'

function memoryRepo(initial: Settings | null): SettingsRepository & { saved: Settings[] } {
  let value = initial
  const saved: Settings[] = []
  return {
    saved,
    load: () => value ?? defaultSettings('ru', { llmModel: 'model-a', asrModel: 'base' }),
    save: (settings: Settings) => {
      value = settings
      saved.push(settings)
    },
  }
}

const known = (key: string) => key === 'model-a' || key === 'model-b'
const defaults = () => defaultSettings('ru', { llmModel: 'model-a', asrModel: 'base' })

describe('SettingsService', () => {
  it('loads defaults and persists the normalized settings', () => {
    const repo = memoryRepo(null)
    const service = new SettingsService(repo, defaults, known)
    expect(service.get().llmModel).toBe('model-a')
    expect(repo.saved).toHaveLength(1)
  })

  it('resets a stale model key to the default', () => {
    const stale = { ...defaults(), llmModel: 'removed-model' }
    const repo = memoryRepo(stale)
    const service = new SettingsService(repo, defaults, known)
    expect(service.get().llmModel).toBe('model-a')
  })

  it('notifies subscribers and persists each update', () => {
    const repo = memoryRepo(null)
    const service = new SettingsService(repo, defaults, known)
    const seen: string[] = []
    const unsubscribe = service.subscribe(s => seen.push(s.level))
    service.update({ level: 'B1' })
    expect(service.get().level).toBe('B1')
    expect(seen).toEqual(['A2', 'B1'])
    expect(repo.saved.at(-1)?.level).toBe('B1')
    unsubscribe()
    service.update({ level: 'B2' })
    expect(seen).toEqual(['A2', 'B1'])
  })
})
