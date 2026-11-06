// Shared fakes for unit tests. No browser APIs, no network.

import type {
  AsrPort,
  BrainPort,
  ClockPort,
  LoadProgress,
  SpeakOptions,
  SpeechPort,
  SpeechSelection,
  SpeechLoadResult,
  SystemVoice,
  TelemetryPort,
} from '../application/ports'
import type { ChatFunction, LlmCallOptions, LlmMessage, LlmReply, TargetLang } from '../domain/models'
import type { LoadMetric, TurnMetricInput, TurnMetrics } from '../application/telemetry'

export class FakeClock implements ClockPort {
  constructor(private current = Date.parse('2026-01-01T10:00:00.000Z')) {}
  nowIso(): string {
    return new Date(this.current).toISOString()
  }
  nowMs(): number {
    return this.current
  }
  advance(ms: number): void {
    this.current += ms
  }
}

export class FakeBrain implements BrainPort {
  kind: 'local' | 'cloud' = 'local'
  modelKey = 'fake-model'
  modelId = 'fake-model-q4'
  tiny = false
  device = 'test'
  promptBudget = 4096
  ready = true
  calls: Array<{ messages: LlmMessage[]; opts?: LlmCallOptions }> = []

  constructor(private readonly reply: (messages: LlmMessage[], opts?: LlmCallOptions) => LlmReply) {}

  isReady(): boolean {
    return this.ready
  }

  chat: ChatFunction = async (messages, opts) => {
    this.calls.push({ messages, opts })
    return this.reply(messages, opts)
  }
}

/** A reply that routes on the system prompt: tutor JSON, translation JSON, etc. */
export function jsonBrain(overrides: Partial<Record<'tutor' | 'translation' | 'single' | 'correction' | 'vocab' | 'suggestions', string>> = {}) {
  return new FakeBrain(messages => {
    const system = messages[0]?.content ?? ''
    let text = overrides.tutor ?? '{"reply":"Hallo! Wie geht es dir?","corrections":[],"suggestions":[]}'
    if (/translate/i.test(system)) {
      text = overrides.translation ?? '{"user":"Привет!","reply":"Привет! Как дела?"}'
    } else if (/translation/i.test(system)) {
      text = overrides.single ?? 'Привет! Как дела?'
    }
    return { text, perf: null }
  })
}

export class FakeAsr implements AsrPort {
  loadedKey: string | null = 'fake-asr'
  device: 'webgpu' | 'wasm' | null = 'webgpu'
  transcript = 'Ich heiße Anna.'
  ensureCalls = 0
  ensure(_key: string, onProgress: (p: LoadProgress) => void): Promise<void> {
    this.ensureCalls++
    onProgress({ progress: 1, text: 'ready' })
    return Promise.resolve()
  }
  warmUp(_lang: TargetLang): Promise<void> {
    return Promise.resolve()
  }
  transcribe(_pcm: Float32Array, _lang: TargetLang): Promise<string> {
    return Promise.resolve(this.transcript)
  }
}

export class FakeSpeech implements SpeechPort {
  spoken: Array<{ text: string; opts: SpeakOptions }> = []
  cancelled = 0
  ensureCalls = 0
  ensure(_lang: TargetLang, _selection: SpeechSelection): Promise<SpeechLoadResult> {
    this.ensureCalls++
    return Promise.resolve({ warning: null, label: 'Fake voice' })
  }
  speak(text: string, opts: SpeakOptions): Promise<{ firstAudioMs: number | null }> {
    this.spoken.push({ text, opts })
    opts.onFirstAudio?.(5)
    return Promise.resolve({ firstAudioMs: 5 })
  }
  cancel(): void {
    this.cancelled++
  }
  async listSystemVoices(_lang: TargetLang): Promise<SystemVoice[]> {
    return [{ uri: 'voice-1', name: 'Fake', lang: 'de-DE', localService: true }]
  }
  loadedLabel(): string {
    return 'Fake voice'
  }
}

export class FakeTelemetry implements TelemetryPort {
  turnLog: TurnMetrics[] = []
  loadLog: LoadMetric[] = []
  recordTurn(turn: TurnMetricInput): void {
    this.turnLog.push({ ...turn, ts: turn.ts ?? Date.now() })
  }
  recordLoad(load: LoadMetric): void {
    this.loadLog.push(load)
  }
  recordProbe(): void {
    /* probes are covered by the bench adapter, not the pipeline */
  }
  turns(): TurnMetrics[] {
    return this.turnLog
  }
  loads(): LoadMetric[] {
    return this.loadLog
  }
  probes(): [] {
    return []
  }
  clear(): void {
    this.turnLog = []
    this.loadLog = []
  }
}
