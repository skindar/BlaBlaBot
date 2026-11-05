// React wiring for the composition root: every UI feature reads its
// dependencies from here instead of importing module singletons.

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelManager } from '../application/services/ModelManager'
import type { SettingsService } from '../application/services/SettingsService'
import type { SyncService } from '../application/services/SyncService'
import type { TurnService } from '../application/services/TurnService'
import type { VocabularyService } from '../application/services/VocabularyService'
import type { DiaryService } from '../application/services/DiaryService'
import type { DiagnosticsPort } from '../application/telemetry'
import type {
  ActivityRepository,
  ConversationRepository,
  EventBusPort,
  OnboardingRepository,
  SessionRepository,
  SpeechPort,
  SyncStatus,
  VocabularyRepository,
  DiaryRepository,
} from '../application/ports'
import type { HealthInfo, Settings } from '../domain/models'

export interface ModelOption {
  key: string
  modelId: string
  label: string
  size: string
  tiny?: boolean
}

/** Read-only catalog/config the UI may display (no adapters leaked). */
export interface CatalogPort {
  llmModels(): ModelOption[]
  llmModel(key: string): ModelOption
  asrModels(): ModelOption[]
  defaultAsrKey: string
  webgpuSupported(): boolean
  googleClientId: string
}

export interface AppServices {
  settings: SettingsService
  models: ModelManager
  turns: TurnService
  vocabulary: VocabularyService
  diary: DiaryService
  achievements: import('../application/services/AchievementsService').AchievementsService
  bench: DiagnosticsPort
  sync: SyncService
  conversation: ConversationRepository
  vocab: VocabularyRepository
  diaryRepo: DiaryRepository
  sessions: SessionRepository
  activity: ActivityRepository
  achievementsRepo: import('../application/ports').AchievementsRepository
  onboarding: OnboardingRepository
  speech: SpeechPort
  catalog: CatalogPort
  bus: EventBusPort
  start(): void
}

const ServicesContext = createContext<AppServices | null>(null)

export function ServicesProvider({ value, children }: { value: AppServices; children: ReactNode }): JSX.Element {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('useServices() outside <ServicesProvider>')
  return services
}

/** Settings + updater. The service persists every change itself. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const { settings } = useServices()
  const [state, setState] = useState(() => settings.get())
  useEffect(() => settings.subscribe(setState), [settings])
  return [state, patch => settings.update(patch)]
}

export function useHealth(): HealthInfo {
  const { models } = useServices()
  const [health, setHealth] = useState(() => models.status())
  useEffect(() => models.subscribe(setHealth), [models])
  return health
}

export function useSyncStatus(): SyncStatus {
  const { sync } = useServices()
  const [status, setStatus] = useState(() => sync.status())
  useEffect(() => sync.subscribe(setStatus), [sync])
  return status
}
