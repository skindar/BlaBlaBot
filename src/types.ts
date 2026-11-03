import type { UiLang } from './i18n'
import type { TargetLang } from './lib/langs'

export type Stage = 'idle' | 'recording' | 'processing' | 'playing'
export type Level = 'A1' | 'A2' | 'B1' | 'B2'
export type ThemeMode = 'system' | 'light' | 'dark'
export type TtsEngineKind = 'phonon' | 'system'

export interface Suggestion {
  text: string
  translation: string
}

export interface Correction {
  original: string
  corrected: string
  explanation: string
}

export interface ChatResponse {
  user_text: string
  user_translation: string
  reply: string
  corrections: Correction[]
  translation: string
  follow_up: string
  follow_up_translation: string
  suggestions: Suggestion[]
  audio_url: string | null
  warning: string | null
  timings: Record<string, number>
}

export interface HistoryMessage {
  id: number
  role: 'user' | 'tutor'
  text: string
  user_translation: string | null
  corrections: Correction[] | null
  translation: string | null
  follow_up: string | null
  audio_url: string | null
  created_at: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'tutor'
  text: string
  userTranslation?: string
  corrections?: Correction[]
  translation?: string
  follow_up?: string
  follow_up_translation?: string
  suggestions?: Suggestion[]
  audio_url?: string | null
}

export interface Settings {
  /** UI language (RU/EN) */
  uiLang: UiLang
  /** target language being learned */
  targetLang: TargetLang
  /** UI theme */
  theme: ThemeMode
  level: Level
  llmModel: string
  asrModel: string
  ttsEngine: TtsEngineKind
  /** voice per target language (Phonon name or system voiceURI) */
  ttsVoices: Partial<Record<TargetLang, string>>
  /** Phonon model files base URL per target language */
  phononBases: Partial<Record<TargetLang, string>>
  ttsSpeed: number
  showTranslation: boolean
  extraPrompt: string
  /** Google OAuth Client ID (Drive flashcard sync) */
  googleClientId: string
  /** auto-sync flashcards with Google Drive */
  driveAutoSync: boolean
  /** show the Bench tab (hidden by default — a developer/article tool) */
  showBench?: boolean
}

export interface VocabItem {
  id: number
  word: string
  translation: string
  part_of_speech: string
  example: string
  example_translation: string
  known: boolean
  created_at: string
  /** target language (absent in old records — treated as de) */
  lang?: TargetLang
}

export interface ModelHealth {
  state: string
  error: string
  load_ms: number
}

export interface HealthInfo {
  status: string
  ready: boolean
  models: Record<string, ModelHealth>
  llm_current?: string
  llm_choices?: Record<string, string>
  uptime_s: number
}

// Browser addition: live model download progress
export interface WebModelHealth extends ModelHealth {
  progress?: number
  progressText?: string
}

export interface WebHealth extends Omit<HealthInfo, 'models'> {
  models: Record<string, WebModelHealth>
}
