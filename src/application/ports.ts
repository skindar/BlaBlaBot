// Ports: the contracts the application layer owns.
//
// Infrastructure implements them (WebLLM, transformers.js, Phonon/Piper,
// localStorage, Google Drive); the application never imports an adapter.
// Every port is small enough to fake in a unit test without a browser.

import type {
  BrainKind,
  ChatFunction,
  ChatSummary,
  ConversationEntry,
  Correction,
  DiaryEntry,
  DiaryPage,
  HealthInfo,
  LlmMessage,
  Settings,
  TargetLang,
  TtsEngineKind,
  VocabItem,
} from '../domain/models'

export interface LoadProgress {
  progress: number
  text: string
}

// ---------- Inference ----------

export interface BrainConfig {
  kind: BrainKind
  /** local model key */
  llmKey: string
  cloud: { baseUrl: string; apiKey: string; model: string }
}

export interface BrainInfo {
  kind: BrainKind
  modelKey: string
  modelId: string
  /** ~1B and below: use the tiny-tier prompt contract */
  tiny: boolean
  /** label shown in diagnostics */
  device: string
  /** context window budget for the prompt, in tokens */
  promptBudget: number
}

/** A configured chat brain (local WebLLM or a cloud endpoint). */
export interface BrainPort extends BrainInfo {
  isReady(): boolean
  chat: ChatFunction
}

export interface LlmLoaderPort {
  readonly loadedKey: string | null
  readonly deviceLabel: string
  supported(): boolean
  ensure(key: string, onProgress: (p: LoadProgress) => void): Promise<void>
}

export interface AsrPort {
  readonly loadedKey: string | null
  readonly device: 'webgpu' | 'wasm' | null
  ensure(key: string, onProgress: (p: LoadProgress) => void): Promise<void>
  warmUp(lang: TargetLang): Promise<void>
  transcribe(pcm16k: Float32Array, lang: TargetLang, opts?: { long?: boolean }): Promise<string>
}

export interface SpeechSelection {
  engine: TtsEngineKind
  voice: string
  phononBase: string
}

export interface SpeechResult {
  firstAudioMs: number | null
}

export interface SpeakOptions extends SpeechSelection {
  lang: TargetLang
  rate: number
  onFirstAudio?: (ms: number) => void
}

export interface SystemVoice {
  uri: string
  name: string
  lang: string
  localService: boolean
}

export interface SpeechLoadResult {
  /** non-null when speech is unavailable but the lesson can continue */
  warning: string | null
  /** what the settings/diagnostics show */
  label: string
}

/** One facade over the three speech engines; the router picks per language. */
export interface SpeechPort {
  ensure(lang: TargetLang, selection: SpeechSelection, onProgress?: (p: LoadProgress) => void): Promise<SpeechLoadResult>
  speak(text: string, opts: SpeakOptions): Promise<SpeechResult>
  cancel(): void
  listSystemVoices(lang: TargetLang): Promise<SystemVoice[]>
  loadedLabel(): string
}

// ---------- Persistence ----------

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export type DataKind = 'vocab' | 'history' | 'diary' | 'activity'

export interface DataChange {
  kind: DataKind
  lang: TargetLang
}

export type DataChangeListener = (change: DataChange) => void

export interface EventBusPort {
  publish(change: DataChange): void
  subscribe(listener: DataChangeListener): () => void
}

export interface ClockPort {
  nowIso(): string
  nowMs(): number
}

export interface IdPort {
  uuid(): string
  /** monotonic sequence shared by the record repositories */
  nextId(): number
}

export interface SettingsRepository {
  load(): Settings
  save(settings: Settings): void
}

export interface ConversationRepository {
  addUser(lang: TargetLang, text: string, translation: string): void
  addTutor(lang: TargetLang, text: string, corrections: Correction[], translation: string, followUp: string): void
  historyForLlm(lang: TargetLang, limit?: number): LlmMessage[]
  recent(lang: TargetLang, limit?: number): ConversationEntry[]
  /** Start a new chat; the current one is archived (never deleted). */
  reset(lang: TargetLang): void
  load(lang: TargetLang): ConversationEntry[]
  replace(lang: TargetLang, entries: ConversationEntry[]): void
  currentChat(lang: TargetLang): ChatSummary
  /** Archived chats of this language, newest first. */
  archives(lang: TargetLang): ChatSummary[]
  /** Archive the current chat and open an archived one. */
  openArchive(id: string): boolean
  /** Delete an archived chat, or clear the current chat when id='current'. */
  deleteChat(id: string, lang: TargetLang): boolean
  deleteArchive(id: string): boolean
}

export interface VocabularyRepository {
  list(lang: TargetLang): VocabItem[]
  all(): VocabItem[]
  find(lang: TargetLang, word: string): VocabItem | null
  add(input: {
    lang: TargetLang
    word: string
    translation: string
    partOfSpeech: string
    example: string
    exampleTranslation: string
  }): { item: VocabItem; existed: boolean }
  setKnown(lang: TargetLang, id: number, known: boolean): boolean
  remove(lang: TargetLang, id: number): boolean
  replace(lang: TargetLang, items: VocabItem[]): void
}

export interface DiaryRepository {
  append(input: { lang: TargetLang; text: string; translation: string; corrected?: string }): DiaryEntry
  list(lang?: TargetLang): DiaryEntry[]
  remove(uid: string): boolean
  replaceAll(entries: DiaryEntry[]): void
  state(lang: TargetLang): { qIdx: number }
  setState(lang: TargetLang, state: { qIdx: number }): void
  page(lang: TargetLang, date: string): DiaryPage | null
  savePage(page: DiaryPage): void
  prunePages(lang: TargetLang, dates: Set<string>): void
}

export interface SessionRepository {
  get(lang: TargetLang): import('../domain/policies/scenarios').TutorSession | null
  set(lang: TargetLang, session: import('../domain/policies/scenarios').TutorSession): void
  reset(lang: TargetLang): void
}

export interface ActivityRepository {
  bump(n?: number): void
  list(): Record<string, number>
  replaceAll(days: Record<string, number>): void
}

export interface AchievementsRepository {
  /** achievement id → YYYY-MM-DD of the first unlock */
  list(): Record<string, string>
  unlock(id: string, dateKey: string): void
  replaceAll(dates: Record<string, string>): void
}

export interface OnboardingRepository {
  done(): boolean
  complete(): void
}

export interface DictionaryPort {
  lookup(word: string): Promise<{ translations: string[]; pos: string }>
}

// ---------- Sync ----------

export interface SyncStatus {
  signedIn: boolean
  email: string
  lastSyncMs: number | null
  syncing: boolean
  error: string
}

export interface DrivePort {
  signedIn(): boolean
  requestToken(interactive: boolean): Promise<void>
  signOut(): void
  email(): Promise<string>
  loadText(name: string): Promise<string | null>
  saveText(name: string, text: string, mimeType: string): Promise<void>
}

export interface SyncPort {
  status(): SyncStatus
  subscribe(listener: (status: SyncStatus) => void): () => void
  configure(opts: { autoSync: boolean }): void
  signIn(): Promise<void>
  signOut(): void
  syncNow(): Promise<void>
}

// ---------- Model lifecycle ----------

export interface ModelManagerPort {
  status(): HealthInfo
  subscribe(listener: (health: HealthInfo) => void): () => void
  /** (re)load whatever the given settings require */
  apply(settings: Settings): void
  /** true when llm+asr are ready for a turn */
  ready(): boolean
}

// ---------- Diagnostics ----------

export interface TelemetryPort {
  recordTurn(turn: import('./telemetry').TurnMetricInput): void
  recordLoad(load: import('./telemetry').LoadMetricInput): void
  recordProbe(probe: Omit<import('./telemetry').ContextProbe, 'ts'>): void
  turns(): import('./telemetry').TurnMetrics[]
  loads(): import('./telemetry').LoadMetric[]
  probes(): import('./telemetry').ContextProbe[]
  clear(): void
}

export type { LlmMessage, Settings }
