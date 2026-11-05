// Diagnostics: per-call LLM performance, model load times, environment
// snapshot and scripted benchmark runs. Backed by the key-value store so the
// Bench tab survives reloads.
//
// This is a developer tool; it talks to the local WebLLM engine directly and
// is intentionally independent from the tutor pipeline.

import pkg from '../../../package.json'
import type { ClockPort, KeyValueStore, LoadProgress, TelemetryPort } from '../../application/ports'
import type {
  BenchRunProgress,
  ContextProbe,
  DiagnosticsPort,
  EnvSnapshot,
  LoadMetric,
  LoadMetricInput,
  ModelAggregate,
  ParseOutcome,
  TurnMetricInput,
  TurnMetrics,
} from '../../application/telemetry'
import type { ChatFunction, Level, LlmMessage, TargetLang, UiLang } from '../../domain/models'
import { tinyCorrections } from '../../domain/policies/corrections'
import { filterCorrections, parseTranslationJson, parseTutorReply } from '../../domain/policies/parse'
import {
  buildTranslateMessages,
  buildTutorMessages,
  buildTutorMessagesSimple,
  buildVocabMessages,
} from '../../domain/policies/prompts'

const STORAGE_KEY = 'blablabot2:bench'
const MAX_TURNS = 300

const pkgVersions = {
  webllm: (pkg.dependencies?.['@mlc-ai/web-llm'] ?? '?').replace(/^[^0-9]*/, ''),
  phonon: (pkg.dependencies?.['phonon-tts'] ?? '?').replace(/^[^0-9]*/, ''),
  transformers: (pkg.dependencies?.['@huggingface/transformers'] ?? '?').replace(/^[^0-9]*/, ''),
}

interface BenchStore {
  env: EnvSnapshot | null
  turns: TurnMetrics[]
  loads: LoadMetric[]
  probes: ContextProbe[]
}

export interface BenchRecorderDeps {
  store: KeyValueStore
  clock: ClockPort
  localChat: ChatFunction
  ensureModel: (key: string, onProgress: (p: LoadProgress) => void) => Promise<void>
  loadedModelKey: () => string | null
  deviceLabel: () => string
  catalog: {
    byKey: (key: string) => { key: string; modelId: string; label: string; tiny?: boolean }
    contextWindowFor: (key: string) => { window: number; promptBudget: number }
  }
}

export const BENCH_SCRIPT: Array<{ text: string; level: Level }> = [
  { text: 'Guten Tag! Wie geht es dir?', level: 'A1' },
  { text: 'Ich gehe heute in die Schule und danach kaufe ich ein Brot.', level: 'A1' },
  { text: 'Gestern habe ich einen Film gesehen und danach viel Kaffee getrunken.', level: 'A2' },
  { text: 'Ich möchte wissen, ob das Restaurant am Sonntag geöffnet ist.', level: 'A2' },
  { text: 'Letztes Wochenende bin ich nach Berlin gefahren und habe drei Museen besucht.', level: 'B1' },
  { text: 'Der Zug, den ich nehmen wollte, war leider zwanzig Minuten zu spät.', level: 'B1' },
  { text: 'Könntest du mir bitte erklären, wie man zum Bahnhof kommt?', level: 'A2' },
  { text: 'Ich habe gehört, dass du nächsten Monat nach Wien umziehst — stimmt das?', level: 'B1' },
]

export const BENCH_VOCAB = ['das Brötchen', 'umsteigen']

export class BenchRecorder implements TelemetryPort, DiagnosticsPort {
  readonly script = BENCH_SCRIPT
  readonly vocab = BENCH_VOCAB

  constructor(private readonly deps: BenchRecorderDeps) {}

  // ---------- storage ----------

  private read(): BenchStore {
    try {
      const raw = this.deps.store.get(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BenchStore>
        return {
          env: parsed.env ?? null,
          turns: parsed.turns ?? [],
          loads: parsed.loads ?? [],
          probes: parsed.probes ?? [],
        }
      }
    } catch {
      /* corrupted storage — start fresh */
    }
    return { env: null, turns: [], loads: [], probes: [] }
  }

  private write(store: BenchStore): void {
    this.deps.store.set(STORAGE_KEY, JSON.stringify(store))
  }

  // ---------- TelemetryPort ----------

  recordTurn(input: TurnMetricInput): void {
    const store = this.read()
    store.turns.push({ ...input, ts: this.deps.clock.nowMs() })
    if (store.turns.length > MAX_TURNS) store.turns = store.turns.slice(-MAX_TURNS)
    this.write(store)
  }

  recordLoad(input: LoadMetricInput): void {
    const store = this.read()
    store.loads.push({ ...input, ts: this.deps.clock.nowMs() })
    store.loads = store.loads.slice(-60)
    this.write(store)
  }

  recordProbe(probe: Omit<ContextProbe, 'ts'>): void {
    const store = this.read()
    store.probes.push({ ...probe, ts: this.deps.clock.nowMs() })
    store.probes = store.probes.slice(-10)
    this.write(store)
  }

  turns(): TurnMetrics[] {
    return this.read().turns
  }

  loads(): LoadMetric[] {
    return this.read().loads
  }

  probes(): ContextProbe[] {
    return this.read().probes
  }

  clear(): void {
    this.write({ env: this.env(), turns: [], loads: [], probes: [] })
  }

  env(): EnvSnapshot | null {
    return this.read().env
  }

  async snapshotEnv(): Promise<EnvSnapshot> {
    let gpuVendor = ''
    let gpuArchitecture = ''
    let gpuDevice = ''
    let gpuDescription = ''
    type GpuAdapterInfoLike = {
      vendor?: string
      architecture?: string
      device?: string
      description?: string
    }
    const gpu = (
      navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: GpuAdapterInfoLike } | null> } }
    ).gpu
    if (gpu) {
      try {
        const adapter = await gpu.requestAdapter()
        const info = adapter?.info
        if (info) {
          gpuVendor = info.vendor ?? ''
          gpuArchitecture = info.architecture ?? ''
          gpuDevice = info.device ?? ''
          gpuDescription = info.description ?? ''
        }
      } catch {
        /* adapter request failed — leave blank */
      }
    }
    const deviceMemoryGb =
      typeof navigator !== 'undefined' &&
      typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === 'number'
        ? (navigator as Navigator & { deviceMemory: number }).deviceMemory
        : null
    const env: EnvSnapshot = {
      ts: this.deps.clock.nowMs(),
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      gpuVendor,
      gpuArchitecture,
      gpuDevice,
      gpuDescription,
      deviceMemoryGb,
      webllmVersion: pkgVersions.webllm,
      phononTtsVersion: pkgVersions.phonon,
      transformersVersion: pkgVersions.transformers,
    }
    const store = this.read()
    store.env = env
    this.write(store)
    return env
  }

  // ---------- aggregation ----------

  aggregate(): ModelAggregate[] {
    const byKey = new Map<string, TurnMetrics[]>()
    for (const t of this.read().turns) {
      if (t.stage !== 'tutor') continue
      const key = `${t.llmKey}|${t.schema ?? 'full'}`
      const list = byKey.get(key) ?? []
      list.push(t)
      byKey.set(key, list)
    }
    const out: ModelAggregate[] = []
    const OK_PARSE: ParseOutcome[] = ['json', 'repaired', 'rescued', 'regex']
    for (const [key, turns] of byKey) {
      const ok = turns.filter(t => t.parse != null && OK_PARSE.includes(t.parse)).length
      out.push({
        llmKey: key,
        modelId: turns[0]?.modelId ?? key,
        schema: turns[0]?.schema ?? 'full',
        turns: turns.length,
        decodeTokS: mean(turns.map(t => t.decodeTokS).filter((x): x is number => x != null)),
        ttftMs: mean(turns.map(t => t.ttftMs).filter((x): x is number => x != null)),
        e2eMs: mean(turns.map(t => t.e2eMs).filter((x): x is number => x != null)),
        wallMs: mean(turns.map(t => t.wallMs).filter((x): x is number => x != null)),
        jsonOkRate: turns.length > 0 ? ok / turns.length : null,
        correctionsKept: turns.reduce((a, t) => a + (t.correctionsKept ?? 0), 0),
      })
    }
    return out.sort((a, b) => (b.decodeTokS ?? 0) - (a.decodeTokS ?? 0))
  }

  toMarkdown(): string {
    const store = this.read()
    const lines: string[] = []
    lines.push('## Environment', '')
    if (store.env) {
      const e = store.env
      lines.push(
        `- GPU: ${[e.gpuVendor, e.gpuArchitecture, e.gpuDevice].filter(Boolean).join(' / ') || 'n/a'} ${e.gpuDescription ? `(${e.gpuDescription})` : ''}`,
        `- Browser: ${e.userAgent}`,
        `- Device memory: ${e.deviceMemoryGb != null ? `${e.deviceMemoryGb} GB` : 'n/a'}`,
        `- web-llm ${e.webllmVersion} · phonon-tts ${e.phononTtsVersion} · transformers.js ${e.transformersVersion}`,
      )
    } else {
      lines.push('- (not captured)')
    }
    lines.push('', '## Per-model aggregate (tutor stage)', '')
    lines.push('| Model | Schema | Turns | Decode tok/s | TTFT ms | e2e ms | wall ms | Strict JSON ok | Corrections kept |')
    lines.push('|---|---|---|---|---|---|---|---|---|')
    for (const a of this.aggregate()) {
      lines.push(
        `| ${a.modelId} | ${a.schema} | ${a.turns} | ${fmt(a.decodeTokS)} | ${fmt(a.ttftMs, 0)} | ${fmt(a.e2eMs, 0)} | ${fmt(a.wallMs, 0)} | ${a.jsonOkRate == null ? '—' : `${Math.round(a.jsonOkRate * 100)}%`} | ${a.correctionsKept} |`,
      )
    }
    const probes = this.read().probes
    for (const p of [...probes].reverse().slice(0, 3)) {
      lines.push('', `## Context probe — ${p.modelId} (window ${p.contextWindow}, prompt budget ${p.promptBudget})`, '')
      lines.push('| Turn | Prompt tokens | TTFT ms | Decode tok/s | wall ms | Note |')
      lines.push('|---|---|---|---|---|---|')
      for (const r of p.rows) {
        lines.push(
          `| ${r.turn} | ${r.promptTokens ?? '—'} | ${fmt(r.ttftMs, 0)} | ${fmt(r.decodeTokS)} | ${r.wallMs ?? '—'} | ${r.error ? r.error.slice(0, 60) : ''} |`,
        )
      }
      const ok = p.rows.filter(r => !r.error)
      if (ok.length > 2) {
        const first = ok.slice(0, 3)
        const baseDecode = mean(first.map(r => r.decodeTokS).filter((x): x is number => x != null))
        const baseTtft = mean(first.map(r => r.ttftMs).filter((x): x is number => x != null))
        const knee = ok.find(
          r =>
            (baseDecode != null && r.decodeTokS != null && r.decodeTokS < baseDecode * 0.75) ||
            (baseTtft != null && r.ttftMs != null && r.ttftMs > baseTtft * 2),
        )
        const lastOk = ok[ok.length - 1]
        lines.push(
          '',
          knee
            ? `Stable through ~${knee.turn - 1} turns; degradation at turn ${knee.turn} (decode ${fmt(knee.decodeTokS)} vs ${fmt(baseDecode)} baseline, TTFT ${fmt(knee.ttftMs, 0)} vs ${fmt(baseTtft, 0)}).`
            : `No knee within ${ok.length} turns; last turn at ${lastOk.promptTokens ?? '?'} prompt tokens still stable (decode ${fmt(lastOk.decodeTokS)}, TTFT ${fmt(lastOk.ttftMs, 0)}).`,
        )
      }
    }
    lines.push('', '## Model loads', '')
    lines.push('| Kind | Model | ms | Files from |')
    lines.push('|---|---|---|---|')
    for (const l of store.loads) {
      lines.push(`| ${l.kind} | ${l.model} | ${l.ms} | ${l.source} |`)
    }
    lines.push('', '## Recent turns', '')
    lines.push('| Stage | Model | Decode tok/s | TTFT ms | Prompt tok | Compl tok | wall ms | Parse | Turn # |')
    lines.push('|---|---|---|---|---|---|---|---|---|')
    for (const t of [...store.turns].slice(-25).reverse()) {
      lines.push(
        `| ${t.stage} | ${t.modelId} | ${fmt(t.decodeTokS)} | ${fmt(t.ttftMs, 0)} | ${t.promptTokens ?? '—'} | ${t.completionTokens ?? '—'} | ${t.wallMs ?? '—'} | ${t.parse ?? '—'} | ${t.turnNo ?? '—'} |`,
      )
    }
    return lines.join('\n')
  }

  toJSON(): string {
    return JSON.stringify(this.read(), null, 2)
  }

  // ---------- scripted benchmark run ----------

  async runBenchmark(opts: {
    modelKeys: string[]
    targetLang: TargetLang
    uiLang: UiLang
    onProgress: (p: BenchRunProgress) => void
  }): Promise<void> {
    const { modelKeys, targetLang, uiLang, onProgress } = opts
    const originalKey = this.deps.loadedModelKey()
    try {
      for (let mi = 0; mi < modelKeys.length; mi++) {
        const key = modelKeys[mi]
        const option = this.deps.catalog.byKey(key)
        let sawNetwork = false
        onProgress({
          phase: 'load',
          modelKey: key,
          modelIndex: mi,
          modelCount: modelKeys.length,
          turnIndex: 0,
          turnCount: 0,
          text: `loading ${option.modelId}`,
        })
        const tLoad = this.deps.clock.nowMs()
        await this.deps.ensureModel(key, (p: LoadProgress) => {
          if (!sawNetwork && /fetch|download|\d+% of/i.test(p.text) && !/cache/i.test(p.text)) sawNetwork = true
          onProgress({
            phase: 'load',
            modelKey: key,
            modelIndex: mi,
            modelCount: modelKeys.length,
            turnIndex: 0,
            turnCount: 0,
            text: p.text.slice(0, 120),
          })
        })
        this.recordLoad({
          kind: 'llm',
          model: option.modelId,
          ms: this.deps.clock.nowMs() - tLoad,
          source: sawNetwork ? 'network' : 'cache',
        })

        const history: LlmMessage[] = []
        for (let ti = 0; ti < BENCH_SCRIPT.length; ti++) {
          const step = BENCH_SCRIPT[ti]
          onProgress({
            phase: 'turn',
            modelKey: key,
            modelIndex: mi,
            modelCount: modelKeys.length,
            turnIndex: ti,
            turnCount: BENCH_SCRIPT.length,
            text: step.text,
          })
          const messages = option.tiny
            ? buildTutorMessagesSimple(history, step.text, step.level, targetLang, uiLang, '')
            : buildTutorMessages(history, step.text, step.level, targetLang, uiLang, '')
          const t0 = this.deps.clock.nowMs()
          const tutor = await this.deps.localChat(messages, { temperature: 0 })
          const wallTutor = this.deps.clock.nowMs() - t0
          const parsed = parseTutorReply(tutor.text, targetLang)
          let corrections = parsed.corrections
          if (option.tiny) {
            const tCorr = this.deps.clock.nowMs()
            const corrResult = await tinyCorrections({
              chat: this.deps.localChat,
              userText: step.text,
              targetLang,
            })
            corrections = corrResult.corrections
            this.recordTurn({
              stage: 'corrections',
              llmKey: key,
              modelId: option.modelId,
              device: this.deps.deviceLabel(),
              temperature: 0,
              promptTokens: null,
              completionTokens: null,
              ttftMs: null,
              prefillTokS: null,
              decodeTokS: null,
              e2eMs: null,
              wallMs: this.deps.clock.nowMs() - tCorr,
              parse: 'json',
              correctionsRaw: corrResult.corrections.length,
              correctionsKept: null,
              turnNo: null,
              schema: 'tiny',
            })
          }
          const kept = filterCorrections(corrections, step.text, uiLang)
          this.recordTurn({
            stage: 'tutor',
            llmKey: key,
            modelId: option.modelId,
            device: this.deps.deviceLabel(),
            temperature: 0,
            promptTokens: tutor.perf?.promptTokens ?? null,
            completionTokens: tutor.perf?.completionTokens ?? null,
            ttftMs: tutor.perf?.ttftMs ?? null,
            prefillTokS: tutor.perf?.prefillTokS ?? null,
            decodeTokS: tutor.perf?.decodeTokS ?? null,
            e2eMs: tutor.perf?.e2eMs ?? null,
            wallMs: wallTutor,
            parse: parsed.method,
            correctionsRaw: corrections.length,
            correctionsKept: kept.length,
            turnNo: ti + 1,
            schema: option.tiny ? 'tiny' : 'full',
          })
          const trMessages = buildTranslateMessages(targetLang, uiLang, step.text, parsed.reply)
          const t1 = this.deps.clock.nowMs()
          const tr = await this.deps.localChat(trMessages, { temperature: 0.2 })
          const wallTr = this.deps.clock.nowMs() - t1
          const parsedTr = parseTranslationJson(tr.text)
          this.recordTurn({
            stage: 'translation',
            llmKey: key,
            modelId: option.modelId,
            device: this.deps.deviceLabel(),
            temperature: 0.2,
            promptTokens: tr.perf?.promptTokens ?? null,
            completionTokens: tr.perf?.completionTokens ?? null,
            ttftMs: tr.perf?.ttftMs ?? null,
            prefillTokS: tr.perf?.prefillTokS ?? null,
            decodeTokS: tr.perf?.decodeTokS ?? null,
            e2eMs: tr.perf?.e2eMs ?? null,
            wallMs: wallTr,
            parse: parsedTr !== null ? 'json' : 'fail',
            correctionsRaw: null,
            correctionsKept: null,
            turnNo: ti + 1,
          })
          history.push({ role: 'user', content: step.text })
          history.push({
            role: 'assistant',
            content: parsed.reply + (parsed.follow_up ? ` ${parsed.follow_up}` : ''),
          })
        }

        for (const word of BENCH_VOCAB) {
          onProgress({
            phase: 'vocab',
            modelKey: key,
            modelIndex: mi,
            modelCount: modelKeys.length,
            turnIndex: 0,
            turnCount: BENCH_VOCAB.length,
            text: word,
          })
          const messages = buildVocabMessages(targetLang, uiLang, word)
          const t2 = this.deps.clock.nowMs()
          const vocabCall = await this.deps.localChat(messages, { temperature: 0.3 })
          this.recordTurn({
            stage: 'vocab',
            llmKey: key,
            modelId: option.modelId,
            device: this.deps.deviceLabel(),
            temperature: 0.3,
            promptTokens: vocabCall.perf?.promptTokens ?? null,
            completionTokens: vocabCall.perf?.completionTokens ?? null,
            ttftMs: vocabCall.perf?.ttftMs ?? null,
            prefillTokS: vocabCall.perf?.prefillTokS ?? null,
            decodeTokS: vocabCall.perf?.decodeTokS ?? null,
            e2eMs: vocabCall.perf?.e2eMs ?? null,
            wallMs: this.deps.clock.nowMs() - t2,
            parse: vocabCall.text.trim().startsWith('{') ? 'json' : 'fail',
            correctionsRaw: null,
            correctionsKept: null,
            turnNo: null,
          })
        }
      }
    } finally {
      if (originalKey != null && modelKeys[modelKeys.length - 1] !== originalKey) {
        onProgress({
          phase: 'restore',
          modelKey: originalKey,
          modelIndex: modelKeys.length,
          modelCount: modelKeys.length,
          turnIndex: 0,
          turnCount: 0,
          text: 'restoring',
        })
        await this.deps.ensureModel(originalKey, () => undefined)
      }
      onProgress({
        phase: 'done',
        modelKey: '',
        modelIndex: modelKeys.length,
        modelCount: modelKeys.length,
        turnIndex: 0,
        turnCount: 0,
        text: 'done',
      })
    }
  }

  async runContextProbe(opts: {
    modelKey: string
    targetLang: TargetLang
    uiLang: UiLang
    maxTurns?: number
    onProgress: (p: BenchRunProgress) => void
  }): Promise<ContextProbe | null> {
    const { modelKey, targetLang, uiLang, onProgress } = opts
    const maxTurns = opts.maxTurns ?? 24
    const option = this.deps.catalog.byKey(modelKey)
    const { window: ctxWindow, promptBudget } = this.deps.catalog.contextWindowFor(modelKey)
    const originalKey = this.deps.loadedModelKey()
    let sawNetwork = false
    onProgress({
      phase: 'load',
      modelKey,
      modelIndex: 0,
      modelCount: 1,
      turnIndex: 0,
      turnCount: 0,
      text: `loading ${option.modelId}`,
    })
    const tLoad = this.deps.clock.nowMs()
    await this.deps.ensureModel(modelKey, (p: LoadProgress) => {
      if (!sawNetwork && /fetch|download|\d+% of/i.test(p.text) && !/cache/i.test(p.text)) sawNetwork = true
      onProgress({
        phase: 'load',
        modelKey,
        modelIndex: 0,
        modelCount: 1,
        turnIndex: 0,
        turnCount: 0,
        text: p.text.slice(0, 120),
      })
    })
    this.recordLoad({
      kind: 'llm',
      model: option.modelId,
      ms: this.deps.clock.nowMs() - tLoad,
      source: sawNetwork ? 'network' : 'cache',
    })

    const probe: Omit<ContextProbe, 'ts'> = {
      llmKey: modelKey,
      modelId: option.modelId,
      contextWindow: ctxWindow,
      promptBudget,
      rows: [],
    }
    const history: LlmMessage[] = []
    for (let turn = 1; turn <= maxTurns; turn++) {
      const line = PROBE_LINES[(turn - 1) % PROBE_LINES.length]
      onProgress({
        phase: 'turn',
        modelKey,
        modelIndex: 0,
        modelCount: 1,
        turnIndex: turn - 1,
        turnCount: maxTurns,
        text: `turn ${turn}`,
      })
      const messages = option.tiny
        ? buildTutorMessagesSimple(history, line, 'A2', targetLang, uiLang, '')
        : buildTutorMessages(history, line, 'A2', targetLang, uiLang, '')
      const t0 = this.deps.clock.nowMs()
      try {
        const call = await this.deps.localChat(messages, { temperature: 0, maxTokens: 250 })
        const row = {
          turn,
          promptTokens: call.perf?.promptTokens ?? null,
          ttftMs: call.perf?.ttftMs ?? null,
          decodeTokS: call.perf?.decodeTokS ?? null,
          wallMs: this.deps.clock.nowMs() - t0,
        }
        probe.rows.push(row)
        this.recordTurn({
          stage: 'tutor',
          llmKey: modelKey,
          modelId: option.modelId,
          device: this.deps.deviceLabel(),
          temperature: 0,
          promptTokens: row.promptTokens,
          completionTokens: null,
          ttftMs: row.ttftMs,
          prefillTokS: call.perf?.prefillTokS ?? null,
          decodeTokS: row.decodeTokS,
          e2eMs: call.perf?.e2eMs ?? null,
          wallMs: row.wallMs,
          parse: parseTutorReply(call.text, targetLang).method,
          correctionsRaw: null,
          correctionsKept: null,
          turnNo: turn,
          schema: option.tiny ? 'tiny' : 'full',
        })
        const assistantText = parseTutorReply(call.text, targetLang).reply
        history.push({ role: 'user', content: line }, { role: 'assistant', content: assistantText || line })
      } catch (err) {
        probe.rows.push({
          turn,
          promptTokens: null,
          ttftMs: null,
          decodeTokS: null,
          wallMs: this.deps.clock.nowMs() - t0,
          error: err instanceof Error ? err.message : String(err),
        })
        break
      }
    }
    this.recordProbe(probe)
    if (originalKey != null && originalKey !== modelKey) {
      onProgress({
        phase: 'restore',
        modelKey: originalKey,
        modelIndex: 1,
        modelCount: 1,
        turnIndex: 0,
        turnCount: 0,
        text: 'restoring',
      })
      await this.deps.ensureModel(originalKey, () => undefined)
    }
    onProgress({
      phase: 'done',
      modelKey,
      modelIndex: 1,
      modelCount: 1,
      turnIndex: 0,
      turnCount: 0,
      text: 'done',
    })
    return { ...probe, ts: this.deps.clock.nowMs() }
  }
}

const PROBE_LINES = [
  'Erzähl mir bitte mehr davon.',
  'Das klingt interessant, weiter bitte.',
  'Und was hast du dann gemacht?',
  'Wirklich? Erzähl weiter.',
  'Ich verstehe. Was kam danach?',
]

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function fmt(x: number | null, digits = 1): string {
  return x == null ? '—' : x.toFixed(digits)
}
