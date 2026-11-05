// Telemetry contract: the benchmark feature (Bench tab, Markdown export).
// Pure types live here so the UI and the application can talk about metrics
// without importing the WebLLM/bench harness.

export type TurnStage =
  | 'tutor'
  | 'corrections'
  | 'suggestions'
  | 'translation'
  | 'vocab'
  | 'turn'
  | 'roundtrip'

export type ParseOutcome =
  | 'json'
  | 'repaired'
  | 'rescued'
  | 'regex'
  | 'plain'
  | 'fallback'
  | 'lines'
  | 'fail'
  | 'micro'
  | 'template'
  | 'scaffold'
  | 'farewell'

export type PromptSchema = 'full' | 'tiny'

export interface TurnMetrics {
  ts: number
  stage: TurnStage
  llmKey: string
  modelId: string
  device: string
  temperature: number
  promptTokens: number | null
  completionTokens: number | null
  ttftMs: number | null
  prefillTokS: number | null
  decodeTokS: number | null
  e2eMs: number | null
  wallMs: number | null
  parse: ParseOutcome | null
  correctionsRaw: number | null
  correctionsKept: number | null
  turnNo: number | null
  schema?: PromptSchema
}

export type TurnMetricInput = Omit<TurnMetrics, 'ts'> & { ts?: number }

export interface LoadMetric {
  ts: number
  kind: 'llm' | 'asr' | 'tts'
  model: string
  ms: number
  source: 'cache' | 'network' | 'mixed' | 'unknown'
}

export type LoadMetricInput = Omit<LoadMetric, 'ts'> & { ts?: number }

export interface EnvSnapshot {
  ts: number
  userAgent: string
  gpuVendor: string
  gpuArchitecture: string
  gpuDevice: string
  gpuDescription: string
  deviceMemoryGb: number | null
  webllmVersion: string
  phononTtsVersion: string
  transformersVersion: string
}

export interface ContextProbe {
  ts: number
  llmKey: string
  modelId: string
  contextWindow: number
  promptBudget: number
  rows: Array<{
    turn: number
    promptTokens: number | null
    ttftMs: number | null
    decodeTokS: number | null
    wallMs: number | null
    error?: string
  }>
}

export interface ModelAggregate {
  llmKey: string
  modelId: string
  schema: PromptSchema
  turns: number
  decodeTokS: number | null
  ttftMs: number | null
  e2eMs: number | null
  wallMs: number | null
  jsonOkRate: number | null
  correctionsKept: number
}

export interface BenchRunProgress {
  phase: 'load' | 'turn' | 'vocab' | 'done' | 'restore'
  modelKey: string
  modelIndex: number
  modelCount: number
  turnIndex: number
  turnCount: number
  text: string
}

/** Everything the Bench tab needs from the diagnostics infrastructure. */
export interface DiagnosticsPort {
  turns(): TurnMetrics[]
  loads(): LoadMetric[]
  probes(): ContextProbe[]
  clear(): void
  env(): EnvSnapshot | null
  snapshotEnv(): Promise<EnvSnapshot>
  aggregate(): ModelAggregate[]
  toMarkdown(): string
  toJSON(): string
  runBenchmark(opts: {
    modelKeys: string[]
    targetLang: import('../domain/models').TargetLang
    uiLang: import('../domain/models').UiLang
    onProgress: (p: BenchRunProgress) => void
  }): Promise<void>
  runContextProbe(opts: {
    modelKey: string
    targetLang: import('../domain/models').TargetLang
    uiLang: import('../domain/models').UiLang
    maxTurns?: number
    onProgress: (p: BenchRunProgress) => void
  }): Promise<ContextProbe | null>
  script: Array<{ text: string; level: import('../domain/models').Level }>
  vocab: string[]
}
