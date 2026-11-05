// Model lifecycle: load TTS → ASR → LLM whenever settings make that
// necessary, expose HealthInfo (ready/error/progress) as an observable.
// Replaces the old useEngine hook — the hook now only subscribes.

import type { AsrPort, ClockPort, LlmLoaderPort, ModelManagerPort, SpeechPort, TelemetryPort } from '../ports'
import type { BrainKind, HealthInfo, ModelHealth, ModelKind, Settings } from '../../domain/models'
import { Observable } from '../support/EventBus'
import { libT } from '../../shared/i18nStrings'
import { speechSelectionFor } from './speechSelection'

const IDLE: ModelHealth = { state: 'idle', error: '', loadMs: 0 }

function initialHealth(): HealthInfo {
  return {
    status: 'loading',
    ready: false,
    models: { asr: { ...IDLE }, llm: { ...IDLE }, tts: { ...IDLE } },
    uptimeS: 0,
  }
}

export interface ModelManagerDeps {
  llm: LlmLoaderPort
  asr: AsrPort
  speech: SpeechPort
  telemetry: TelemetryPort
  clock: ClockPort
  configureBrain: (settings: Settings) => void
  brainKind: (settings: Settings) => BrainKind
  llmLabel: (key: string) => string
  asrDevice: () => string
}

export class ModelManager implements ModelManagerPort {
  private readonly state = new Observable<HealthInfo>(initialHealth())
  private run = 0
  private applied: Settings | null = null

  constructor(private readonly deps: ModelManagerDeps) {}

  status(): HealthInfo {
    return this.state.get()
  }

  subscribe(listener: (health: HealthInfo) => void): () => void {
    return this.state.subscribe(listener)
  }

  ready(): boolean {
    return this.state.get().ready
  }

  apply(settings: Settings): void {
    const previous = this.applied
    this.applied = settings
    // Nothing relevant changed: keep the loaded models and the progress UI.
    if (previous && !modelInputsChanged(previous, settings)) {
      this.deps.configureBrain(settings)
      return
    }
    this.deps.configureBrain(settings)
    const run = ++this.run
    this.state.set({
      status: 'loading',
      ready: false,
      models: { asr: { ...IDLE }, llm: { ...IDLE }, tts: { ...IDLE } },
      llmCurrent: settings.brain === 'cloud' ? 'cloud' : undefined,
      uptimeS: 0,
    })
    void this.load(settings, run)
  }

  private alive(run: number): boolean {
    return run === this.run
  }

  private patch(key: ModelKind, patch: Partial<ModelHealth>): void {
    const current = this.state.get()
    this.state.set({
      ...current,
      models: { ...current.models, [key]: { ...current.models[key], ...patch } },
    })
  }

  private finish(): void {
    const current = this.state.get()
    const llm = current.models.llm.state
    const asr = current.models.asr.state
    const ready = llm === 'ready' && asr === 'ready'
    const status: HealthInfo['status'] = ready ? 'ready' : llm === 'error' || asr === 'error' ? 'error' : 'loading'
    this.state.set({ ...current, ready, status })
  }

  private recordLoad(
    kind: 'llm' | 'asr' | 'tts',
    model: string,
    ms: number,
    source: 'network' | 'cache' | 'unknown',
  ): void {
    this.deps.telemetry.recordLoad({ kind, model, ms, source })
  }

  private async load(settings: Settings, run: number): Promise<void> {
    await this.loadTts(settings, run)
    if (!this.alive(run)) return
    await this.loadAsr(settings, run)
    if (!this.alive(run)) return
    await this.loadLlm(settings, run)
    this.finish()
  }

  private async loadTts(settings: Settings, run: number): Promise<void> {
    const lang = settings.targetLang
    this.patch('tts', { state: 'loading', error: '', progress: 0, progressText: libT('modelLoading') })
    const t = this.deps.clock.nowMs()
    try {
      const result = await this.deps.speech.ensure(lang, speechSelectionFor(settings), p => {
        if (this.alive(run)) this.patch('tts', { progress: p.progress, progressText: p.text })
      })
      if (!this.alive(run)) return
      const ms = this.deps.clock.nowMs() - t
      if (result.warning) {
        this.patch('tts', { state: 'error', loadMs: ms, error: result.warning, progressText: result.warning.slice(0, 80) })
      } else {
        this.recordLoad('tts', `tts-${lang}`, ms, 'unknown')
        this.patch('tts', { state: 'ready', loadMs: ms, progress: 1, progressText: result.label })
      }
    } catch (err) {
      if (!this.alive(run)) return
      this.patch('tts', {
        state: 'error',
        loadMs: this.deps.clock.nowMs() - t,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async loadAsr(settings: Settings, run: number): Promise<void> {
    this.patch('asr', { state: 'loading', error: '', progress: 0, progressText: libT('modelLoading') })
    const t = this.deps.clock.nowMs()
    let sawNetwork = false
    try {
      await this.deps.asr.ensure(settings.asrModel, p => {
        if (/%/.test(p.text)) sawNetwork = true
        if (this.alive(run)) this.patch('asr', { progress: p.progress, progressText: p.text })
      })
      if (!this.alive(run)) return
      this.patch('asr', { progress: 1, progressText: libT('asrWarming') })
      await this.deps.asr.warmUp(settings.targetLang)
      if (!this.alive(run)) return
      const ms = this.deps.clock.nowMs() - t
      this.recordLoad('asr', this.deps.asr.loadedKey ?? settings.asrModel, ms, sawNetwork ? 'network' : 'cache')
      this.patch('asr', {
        state: 'ready',
        loadMs: ms,
        progress: 1,
        progressText: this.deps.asrDevice(),
      })
    } catch (err) {
      if (!this.alive(run)) return
      this.patch('asr', {
        state: 'error',
        loadMs: this.deps.clock.nowMs() - t,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private async loadLlm(settings: Settings, run: number): Promise<void> {
    if (this.deps.brainKind(settings) === 'cloud') {
      this.state.update({ llmCurrent: 'cloud' })
      this.patch('llm', {
        state: 'ready',
        loadMs: 0,
        progress: 1,
        progressText: `Cloud · ${settings.cloudModel || 'custom'}`,
      })
      this.finish()
      return
    }
    this.patch('llm', { state: 'loading', error: '', progress: 0, progressText: libT('modelLoading') })
    this.state.update({ llmCurrent: settings.llmModel })
    const t = this.deps.clock.nowMs()
    let sawNetwork = false
    try {
      await this.deps.llm.ensure(settings.llmModel, p => {
        if (/fetch|%/.test(p.text) && !/cache/i.test(p.text)) sawNetwork = true
        if (this.alive(run)) this.patch('llm', { progress: p.progress, progressText: p.text })
      })
      if (!this.alive(run)) return
      const ms = this.deps.clock.nowMs() - t
      this.recordLoad('llm', this.deps.llmLabel(settings.llmModel), ms, sawNetwork ? 'network' : 'cache')
      this.patch('llm', {
        state: 'ready',
        loadMs: ms,
        progress: 1,
        progressText: this.deps.llmLabel(settings.llmModel),
      })
    } catch (err) {
      if (!this.alive(run)) return
      this.state.update({ llmCurrent: undefined })
      this.patch('llm', {
        state: 'error',
        loadMs: this.deps.clock.nowMs() - t,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

/** The model-loading inputs: changing the tutorial language reloads TTS/ASR;
 *  changing the brain reloads only what is needed. */
function modelInputsChanged(a: Settings, b: Settings): boolean {
  return (
    a.targetLang !== b.targetLang ||
    a.llmModel !== b.llmModel ||
    a.asrModel !== b.asrModel ||
    a.ttsEngine !== b.ttsEngine ||
    JSON.stringify(a.ttsVoices) !== JSON.stringify(b.ttsVoices) ||
    JSON.stringify(a.phononBases) !== JSON.stringify(b.phononBases) ||
    a.brain !== b.brain ||
    a.cloudBaseUrl !== b.cloudBaseUrl ||
    a.cloudApiKey !== b.cloudApiKey ||
    a.cloudModel !== b.cloudModel
  )
}
