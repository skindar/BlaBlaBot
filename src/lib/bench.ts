// Benchmark harness: captures per-call LLM performance (WebLLM usage.extra:
// TTFT, prefill/decode tok/s, token counts), model load times (cold vs cache),
// an environment snapshot (GPU adapter, browser, dependency versions) and
// parse outcomes — then aggregates them into Markdown tables ready to paste
// into an article. The scripted run uses the same prompts as production code,
// so numbers reflect the real workload, not a synthetic chat bench.

import pkg from '../../package.json'
import { llmEngine, llmModelByKey, type LoadProgress } from './llm'
import { parseTutorReply, parseTranslationJson, filterCorrections } from './parse'
import { buildTutorMessages, buildTranslateMessages, buildVocabMessages, type LlmMessage } from '../prompts'
import type { Level } from '../types'
import type { TargetLang } from './langs'
import type { UiLang } from '../i18n'

const pkgVersions = {
  webllm: (pkg.dependencies?.['@mlc-ai/web-llm'] ?? '?').replace(/^[^0-9]*/, ''),
  phonon: (pkg.dependencies?.['phonon-tts'] ?? '?').replace(/^[^0-9]*/, ''),
  transformers: (pkg.dependencies?.['@huggingface/transformers'] ?? '?').replace(/^[^0-9]*/, ''),
}

export type TurnStage = 'tutor' | 'translation' | 'vocab' | 'turn' | 'roundtrip'
export type ParseOutcome = 'json' | 'repaired' | 'regex' | 'plain' | 'fallback' | 'fail'

/** One LLM call (or one full turn) as recorded for the benchmark */
export interface TurnMetrics {
  ts: number
  stage: TurnStage
  llmKey: string
  modelId: string
  device: string
  temperature: number
  promptTokens: number | null
  completionTokens: number | null
  /** time to first token, ms */
  ttftMs: number | null
  prefillTokS: number | null
  decodeTokS: number | null
  e2eMs: number | null
  /** app-clock wall time of the stage, ms */
  wallMs: number | null
  parse: ParseOutcome | null
  correctionsRaw: number | null
  correctionsKept: number | null
  /** 1-based dialog turn number (prompt grows through a session) */
  turnNo: number | null
}

export interface LoadMetric {
  ts: number
  kind: 'llm' | 'asr' | 'tts'
  model: string
  ms: number
  /** where the files came from */
  source: 'cache' | 'network' | 'mixed' | 'unknown'
}

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

const STORAGE_KEY = 'gt-web-bench'
const MAX_TURNS = 300

interface BenchStore {
  env: EnvSnapshot | null
  turns: TurnMetrics[]
  loads: LoadMetric[]
}

function readStore(): BenchStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as BenchStore
      return { env: parsed.env ?? null, turns: parsed.turns ?? [], loads: parsed.loads ?? [] }
    }
  } catch {
    /* corrupted storage — start fresh */
  }
  return { env: null, turns: [], loads: [] }
}

function writeStore(store: BenchStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function recordTurn(m: Omit<TurnMetrics, 'ts'>): void {
  const store = readStore()
  store.turns.push({ ...m, ts: Date.now() })
  if (store.turns.length > MAX_TURNS) store.turns = store.turns.slice(-MAX_TURNS)
  writeStore(store)
}

export function recordLoad(m: Omit<LoadMetric, 'ts'>): void {
  const store = readStore()
  store.loads.push({ ...m, ts: Date.now() })
  store.loads = store.loads.slice(-60)
  writeStore(store)
}

export function allTurns(): TurnMetrics[] {
  return readStore().turns
}

export function allLoads(): LoadMetric[] {
  return readStore().loads
}

export function clearBench(): void {
  writeStore({ env: getEnv(), turns: [], loads: [] })
}

export function getEnv(): EnvSnapshot | null {
  return readStore().env
}

/** Capture the environment once (GPU adapter info needs an async request) */
export async function snapshotEnv(): Promise<EnvSnapshot> {
  let gpuVendor = ''
  let gpuArchitecture = ''
  let gpuDevice = ''
  let gpuDescription = ''
  // Minimal local shape: WebGPU types are not in the TS DOM lib yet
  type GpuAdapterInfoLike = {
    vendor?: string
    architecture?: string
    device?: string
    description?: string
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: GpuAdapterInfoLike } | null> } })
    .gpu
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
    ts: Date.now(),
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
  const store = readStore()
  store.env = env
  writeStore(store)
  return env
}

// ---------- aggregation ----------

export interface ModelAggregate {
  llmKey: string
  modelId: string
  turns: number
  decodeTokS: number | null
  ttftMs: number | null
  e2eMs: number | null
  wallMs: number | null
  jsonOkRate: number | null
  correctionsKept: number
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Aggregate tutor-stage turns per model — the article's core table */
export function aggregateByModel(): ModelAggregate[] {
  const byKey = new Map<string, TurnMetrics[]>()
  for (const t of readStore().turns) {
    if (t.stage !== 'tutor') continue
    const list = byKey.get(t.llmKey) ?? []
    list.push(t)
    byKey.set(t.llmKey, list)
  }
  const out: ModelAggregate[] = []
  for (const [llmKey, turns] of byKey) {
    const ok = turns.filter(t => t.parse === 'json' || t.parse === 'repaired' || t.parse === 'regex').length
    out.push({
      llmKey,
      modelId: turns[0]?.modelId ?? llmKey,
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

function fmt(x: number | null, digits = 1): string {
  return x == null ? '—' : x.toFixed(digits)
}

/** Markdown export: aggregate + loads — ready to paste into an article */
export function toMarkdown(): string {
  const store = readStore()
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
  lines.push('', '## Per-model aggregate (tutor stage, temperature as recorded)', '')
  lines.push('| Model | Turns | Decode tok/s | TTFT ms | e2e ms | wall ms | Strict JSON ok | Corrections kept |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const a of aggregateByModel()) {
    lines.push(
      `| ${a.modelId} | ${a.turns} | ${fmt(a.decodeTokS)} | ${fmt(a.ttftMs, 0)} | ${fmt(a.e2eMs, 0)} | ${fmt(a.wallMs, 0)} | ${a.jsonOkRate == null ? '—' : `${Math.round(a.jsonOkRate * 100)}%`} | ${a.correctionsKept} |`,
    )
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

export function toJSON(): string {
  return JSON.stringify(readStore(), null, 2)
}

// ---------- scripted benchmark run ----------

/** Fixed dialog script: A1→B1, natural grammar traps; deterministic at temperature 0 */
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

export interface BenchRunProgress {
  phase: 'load' | 'turn' | 'vocab' | 'done' | 'restore'
  modelKey: string
  modelIndex: number
  modelCount: number
  turnIndex: number
  turnCount: number
  text: string
}

export interface RunBenchOptions {
  modelKeys: string[]
  targetLang: TargetLang
  uiLang: UiLang
  onProgress: (p: BenchRunProgress) => void
}

/**
 * Sequentially load each selected model and run the fixed script through the
 * production prompts (tutor JSON + translation per turn, then vocab lookups).
 * Does not touch the user's dialog history or vocabulary. Restores the
 * previously loaded model at the end.
 */
export async function runBenchmark(opts: RunBenchOptions): Promise<void> {
  const { modelKeys, targetLang, uiLang, onProgress } = opts
  const originalKey = llmEngine.loadedKey
  for (let mi = 0; mi < modelKeys.length; mi++) {
    const key = modelKeys[mi]
    const option = llmModelByKey(key)
    let sawNetwork = false
    onProgress({ phase: 'load', modelKey: key, modelIndex: mi, modelCount: modelKeys.length, turnIndex: 0, turnCount: 0, text: `loading ${option.modelId}` })
    const tLoad = performance.now()
    await llmEngine.ensure(key, (p: LoadProgress) => {
      if (!sawNetwork && /fetch|download|\d+% of/i.test(p.text) && !/cache/i.test(p.text)) sawNetwork = true
      onProgress({ phase: 'load', modelKey: key, modelIndex: mi, modelCount: modelKeys.length, turnIndex: 0, turnCount: 0, text: p.text.slice(0, 120) })
    })
    recordLoad({
      kind: 'llm',
      model: option.modelId,
      ms: Math.round(performance.now() - tLoad),
      source: sawNetwork ? 'network' : 'cache',
    })

    // In-memory history so prompt tokens grow turn by turn, as in a real session
    const history: LlmMessage[] = []
    for (let ti = 0; ti < BENCH_SCRIPT.length; ti++) {
      const step = BENCH_SCRIPT[ti]
      onProgress({ phase: 'turn', modelKey: key, modelIndex: mi, modelCount: modelKeys.length, turnIndex: ti, turnCount: BENCH_SCRIPT.length, text: step.text })
      // ---- tutor call (same builders as production) ----
      const messages = buildTutorMessages(history, step.text, step.level, targetLang, uiLang, '')
      const t0 = performance.now()
      const tutor = await llmEngine.chat(messages, { temperature: 0 })
      const wallTutor = Math.round(performance.now() - t0)
      const parsed = parseTutorReply(tutor.text)
      const kept = filterCorrections(parsed.corrections, step.text)
      recordTurn({
        stage: 'tutor',
        llmKey: key,
        modelId: option.modelId,
        device: llmEngine.deviceLabel,
        temperature: 0,
        promptTokens: tutor.perf?.promptTokens ?? null,
        completionTokens: tutor.perf?.completionTokens ?? null,
        ttftMs: tutor.perf?.ttftMs ?? null,
        prefillTokS: tutor.perf?.prefillTokS ?? null,
        decodeTokS: tutor.perf?.decodeTokS ?? null,
        e2eMs: tutor.perf?.e2eMs ?? null,
        wallMs: wallTutor,
        parse: parsed.method,
        correctionsRaw: parsed.corrections.length,
        correctionsKept: kept.length,
        turnNo: ti + 1,
      })
      // ---- translation call (production pattern: second call, temp 0.2) ----
      const trMessages = buildTranslateMessages(targetLang, uiLang, step.text, parsed.reply)
      const t1 = performance.now()
      const tr = await llmEngine.chat(trMessages, { temperature: 0.2 })
      const wallTr = Math.round(performance.now() - t1)
      const parsedTr = parseTranslationJson(tr.text)
      recordTurn({
        stage: 'translation',
        llmKey: key,
        modelId: option.modelId,
        device: llmEngine.deviceLabel,
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
      // grow history exactly like the production store does
      history.push({ role: 'user', content: step.text })
      history.push({
        role: 'assistant',
        content: parsed.reply + (parsed.follow_up ? ` ${parsed.follow_up}` : ''),
      })
    }

    for (const word of BENCH_VOCAB) {
      onProgress({ phase: 'vocab', modelKey: key, modelIndex: mi, modelCount: modelKeys.length, turnIndex: 0, turnCount: BENCH_VOCAB.length, text: word })
      const messages = buildVocabMessages(targetLang, uiLang, word)
      const t2 = performance.now()
      const vocabCall = await llmEngine.chat(messages, { temperature: 0.3 })
      const wallVocab = Math.round(performance.now() - t2)
      recordTurn({
        stage: 'vocab',
        llmKey: key,
        modelId: option.modelId,
        device: llmEngine.deviceLabel,
        temperature: 0.3,
        promptTokens: vocabCall.perf?.promptTokens ?? null,
        completionTokens: vocabCall.perf?.completionTokens ?? null,
        ttftMs: vocabCall.perf?.ttftMs ?? null,
        prefillTokS: vocabCall.perf?.prefillTokS ?? null,
        decodeTokS: vocabCall.perf?.decodeTokS ?? null,
        e2eMs: vocabCall.perf?.e2eMs ?? null,
        wallMs: wallVocab,
        parse: vocabCall.text.trim().startsWith('{') ? 'json' : 'fail',
        correctionsRaw: null,
        correctionsKept: null,
        turnNo: null,
      })
    }
  }

  // restore the model the app had loaded before the run
  if (originalKey != null && modelKeys[modelKeys.length - 1] !== originalKey) {
    onProgress({ phase: 'restore', modelKey: originalKey, modelIndex: modelKeys.length, modelCount: modelKeys.length, turnIndex: 0, turnCount: 0, text: 'restoring' })
    await llmEngine.ensure(originalKey, () => undefined)
  }
  onProgress({ phase: 'done', modelKey: '', modelIndex: modelKeys.length, modelCount: modelKeys.length, turnIndex: 0, turnCount: 0, text: 'done' })
}
