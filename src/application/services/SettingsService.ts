// Settings service: load once, validate, persist on every change, notify
// subscribers. The UI owns no persistence logic.

import type { SettingsRepository } from '../ports'
import type { Settings } from '../../domain/models'
import { Observable } from '../support/EventBus'
import { CLOUD_PROVIDER_PROFILES, detectCloudProvider } from '../../domain/policies/cloudProviders'

export class SettingsService {
  private readonly state: Observable<Settings>

  constructor(
    private readonly repo: SettingsRepository,
    defaults: () => Settings,
    private readonly isKnownModel: (key: string) => boolean,
  ) {
    const loaded = this.validate(repo.load(), defaults)
    this.state = new Observable(loaded)
    // persist the normalized form so a stale model key never comes back
    this.repo.save(loaded)
  }

  private validate(settings: Settings, defaults: () => Settings): Settings {
    const next = { ...defaults(), ...settings }
    if (!this.isKnownModel(next.llmModel)) next.llmModel = defaults().llmModel
    if (!CLOUD_PROVIDER_PROFILES.some(p => p.id === next.cloudProfile)) {
      next.cloudProfile = detectCloudProvider(next.cloudBaseUrl, next.cloudModel)
    }
    return next
  }

  get(): Settings {
    return this.state.get()
  }

  subscribe(listener: (settings: Settings) => void): () => void {
    return this.state.subscribe(listener)
  }

  update(patch: Partial<Settings>): Settings {
    const next = { ...this.state.get(), ...patch }
    this.state.set(next)
    this.repo.save(next)
    return next
  }

  replace(settings: Settings): void {
    this.state.set(settings)
    this.repo.save(settings)
  }
}
