// Domain model: framework-free entities and value types shared by every layer.
//
// Rules of this file:
//  * no imports from React, browser APIs or infrastructure;
//  * persisted records use camelCase and are owned by the repositories;
//  * wire formats (LLM JSON, CSV, Markdown) live at the adapter boundary and
//    are mapped to these types, never leaked into the UI.

export type UiLang = 'ru' | 'en'
export type TargetLang = 'de' | 'en' | 'fr' | 'es' | 'pt' | 'ru'
export type Level = 'A1' | 'A2' | 'B1' | 'B2'
export type ThemeMode = 'system' | 'light' | 'dark'
export type TtsEngineKind = 'phonon' | 'system'
export type TalkMode = 'scenario' | 'free'
export type Stage = 'idle' | 'recording' | 'processing' | 'playing'
export type BrainKind = 'local' | 'cloud'

export interface Suggestion {
  text: string
  translation: string
}

export interface Correction {
  original: string
  corrected: string
  explanation: string
}

/** One rendered conversation bubble. `id` is stable within a session. */
export interface ChatMessage {
  id: string
  role: 'user' | 'tutor'
  /** epoch millis, used by the timestamp line under the bubble */
  createdAt?: number
  text: string
  userTranslation?: string
  corrections?: Correction[]
  translation?: string
  followUp?: string
  followUpTranslation?: string
  suggestions?: Suggestion[]
  /** the browser version has no wav files: this is a "line can be spoken" marker */
  canSpeak?: boolean
}

/** A stored conversation turn (repository record). */
export interface ChatSummary {
  id: string
  lang: TargetLang
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  /** the currently open chat */
  active: boolean
}

export interface ConversationEntry {
  id: number
  role: 'user' | 'tutor'
  text: string
  userTranslation: string
  corrections: Correction[]
  translation: string
  followUp: string
  createdAt: string
}

/** A saved flashcard. */
export interface VocabItem {
  id: number
  /** stable id for Drive sync */
  uid: string
  word: string
  translation: string
  partOfSpeech: string
  example: string
  exampleTranslation: string
  known: boolean
  createdAt: string
  /** last change timestamp — sync merge is last-write-wins per uid */
  updatedAt: string
  lang: TargetLang
}

/** One diary line: the student's own words about their day. */
export interface DiaryEntry {
  uid: string
  lang: TargetLang
  /** YYYY-MM-DD (local) */
  date: string
  text: string
  /** text with the tutor's corrections applied, when there were any */
  corrected?: string
  /** polished phrase for the refined view (optional) */
  refined?: string
  translation: string
  createdAt: string
}

/** A polished diary page per (language, date). */
export interface DiaryPage {
  lang: TargetLang
  /** YYYY-MM-DD */
  date: string
  text: string
  facts: string[]
  translation: string
  updatedAt: string
}

export interface ActivityDay {
  /** YYYY-MM-DD */
  date: string
  count: number
}

export interface Settings {
  uiLang: UiLang
  targetLang: TargetLang
  theme: ThemeMode
  level: Level
  llmModel: string
  asrModel: string
  /** local Whisper or the browser's system recognizer (Web Speech API) */
  asrEngine: 'whisper' | 'system'
  ttsEngine: TtsEngineKind
  /** voice per target language (Phonon name or system voiceURI) */
  ttsVoices: Partial<Record<TargetLang, string>>
  /** Phonon model files base URL per target language */
  phononBases: Partial<Record<TargetLang, string>>
  /** chosen scenario id per target language (sidebar topic picker) */
  topics: Partial<Record<TargetLang, string>>
  ttsSpeed: number
  showTranslation: boolean
  /** free-form topic/instructions for the tutor */
  extraPrompt: string
  /** auto-sync flashcards/history/diary with Google Drive */
  driveAutoSync: boolean
  /** scenario lesson vs free conversational actor (no scripted questions) */
  talkMode: TalkMode
  /** free-talk sampling temperature (0.2–1.2, default 0.8) */
  freeTalkTemperature: number
  /** diary mode: the tutor is a supportive listener, messages go to the diary */
  diaryMode: boolean
  /** hands-free mic: tap to start, auto-submit after a short silence pause */
  handsFree: boolean
  /** hands-free auto-submit pause length, ms (1000–30000, default 3000) */
  handsFreePauseMs: number
  /** show the Bench tab (developer/article tool) */
  showBench: boolean
  /** which brain writes the tutor lines: in-tab WebLLM or a cloud API */
  brain: BrainKind
  /** selected built-in cloud provider profile id (url/model only, no token) */
  cloudProfile: string
  /** OpenAI-compatible endpoint for the cloud brain */
  cloudBaseUrl: string
  /** API token for the cloud brain — stays in this browser */
  cloudApiKey: string
  /** model id at the endpoint, e.g. glm-4-flash */
  cloudModel: string
}

// ---------- LLM boundary (framework-free) ----------

export type ChatRole = 'system' | 'user' | 'assistant'

export interface LlmMessage {
  role: ChatRole
  content: string
}

export interface LlmCallOptions {
  temperature?: number
  /** nucleus sampling; model-specific default when omitted */
  topP?: number
  /** OpenAI-compatible repetition penalty; model-specific default when omitted */
  repetitionPenalty?: number
  maxTokens?: number
  stop?: string[]
}

/** Provider-reported performance numbers (WebLLM usage/usage.extra). */
export interface LlmPerf {
  promptTokens: number | null
  completionTokens: number | null
  ttftMs: number | null
  prefillTokS: number | null
  decodeTokS: number | null
  e2eMs: number | null
}

export interface LlmReply {
  text: string
  perf: LlmPerf | null
}

/** The one function every prompt-level policy needs — keeps policies testable. */
export type ChatFunction = (messages: LlmMessage[], opts?: LlmCallOptions) => Promise<LlmReply>

// ---------- Model health ----------

export type ModelState = 'idle' | 'loading' | 'ready' | 'error'
export type ModelKind = 'asr' | 'llm' | 'tts'

export interface ModelHealth {
  state: ModelState
  error: string
  loadMs: number
  /** 0..1 when known */
  progress?: number
  progressText?: string
}

export interface HealthInfo {
  status: 'loading' | 'ready' | 'error'
  ready: boolean
  models: Record<ModelKind, ModelHealth>
  llmCurrent?: string
  uptimeS: number
}

// ---------- Turn result (application → presentation) ----------

export interface TurnInput {
  blob?: Blob
  text?: string
}

export interface TurnResult {
  userText: string
  userTranslation: string
  reply: string
  corrections: Correction[]
  translation: string
  followUp: string
  followUpTranslation: string
  suggestions: Suggestion[]
  /** true when the reply can be spoken by the current speech engine */
  canSpeak: boolean
  warning: string | null
  timings: Record<string, number>
}

export interface VocabLookupResult {
  item: VocabItem
  existed: boolean
}

export interface DiaryRefineResult {
  text: string
  facts: string[]
  translation: string
}
