// Tiny-tier grammar corrections, rebuilt around what 1B models can do.
// Measured (gemma3-1b, temperature 0): asked for {"corrections": [...]}
// fragment pairs the model copies the whole sentence and breaks the contract;
// asked to return the corrected sentence it fixes "meine → meiner" and
// "Monate → Monaten" reliably. So: fix the sentence, diff the words locally.
//
// The user's message is split into sentences and each is checked with its
// own short call — single-sentence context is where small models are exact.

import { buildSentenceFixMessages } from './prompts'
import type { TargetLang } from './languages'
import type { ChatFunction, Correction } from '../models'

export interface SentenceFixCall {
  sentence: string
  fixed: string | null
  raw: string
  wallMs: number
  perf: {
    promptTokens: number | null
    completionTokens: number | null
    ttftMs: number | null
    decodeTokS: number | null
  } | null
}

export interface TinyCorrectionsResult {
  corrections: Correction[]
  /** how many sentences were checked; calls carry the per-sentence detail */
  sentenceCount: number
  calls: SentenceFixCall[]
}

/** Split a user utterance into sentences; short beginner lines are 1–2, cap 3 */
export function splitSentences(text: string, max = 3): string[] {
  const parts = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
  if (parts.length <= max) return parts
  // keep the first sentences (the opening carries the errors learners make)
  return parts.slice(0, max)
}

const WORD_RE = /[\p{L}\p{N}]+/gu

function tokenize(s: string): string[] {
  return s.toLowerCase().match(WORD_RE) ?? []
}

/** True when the change looks like a grammar fix, not a rewrite:
 *  the two words share a stem (meine→meiner, hilfe→helfe, Monate→Monaten).
 *  Rejects person swaps (me→you), name respellings (Walandin→Valentin)
 *  and any other meaning change the "fix" model invented. */
function sameStem(from: string, to: string): boolean {
  const a = from.toLowerCase()
  const b = to.toLowerCase()
  if (!a || !b) return false
  if (a === b) return false
  const min = Math.min(a.length, b.length)
  let common = 0
  while (common < min && a[common] === b[common]) common++
  return common >= 2 || a.startsWith(b) || b.startsWith(a)
}

/** Max share of words that may change before "fix" becomes "rewrite" */
const MAX_CHANGE_RATIO = 0.5

/** Word-level diff → per-change Correction with a ±1-word context window */
export function diffToCorrections(original: string, fixed: string, max = 3): Correction[] {
  const aTokens = original.match(WORD_RE) ?? []
  const bTokens = fixed.match(WORD_RE) ?? []
  const aLow = tokenize(original)
  const bLow = tokenize(fixed)
  const changes: Array<{ i: number; from: string; to: string }> = []
  const n = Math.max(aLow.length, bLow.length)
  for (let i = 0; i < n; i++) {
    if (aLow[i] !== bLow[i]) {
      changes.push({ i, from: aTokens[i] ?? '', to: bTokens[i] ?? '' })
    }
  }
  if (changes.length === 0) return []
  if (changes.length / Math.max(1, aLow.length) > MAX_CHANGE_RATIO) return []
  const out: Correction[] = []
  for (const { i, from, to } of changes) {
    // names and person/meaning swaps are not grammar: drop the invented fix
    if (!sameStem(from, to)) continue
    const lo = Math.max(0, i - 1)
    const hi = Math.min(aTokens.length, i + 2)
    const origWindow = aTokens.slice(lo, hi).join(' ')
    const fixedWindow = bTokens.slice(lo, hi).join(' ')
    out.push({
      original: origWindow || from,
      corrected: fixedWindow || to,
      explanation: '',
    })
    if (out.length >= max) break
  }
  return out
}

function extractFixed(raw: string): string | null {
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const data = JSON.parse(m[0]) as { fixed?: unknown }
    if (typeof data.fixed === 'string' && data.fixed.trim()) return data.fixed.trim()
  } catch {
    /* fall through */
  }
  return null
}

/** Check each sentence of the user's message; returns diff-derived corrections */
export async function tinyCorrections(args: {
  chat: ChatFunction
  userText: string
  targetLang: TargetLang
  maxSentences?: number
}): Promise<TinyCorrectionsResult> {
  const sentences = splitSentences(args.userText, args.maxSentences ?? 3)
  const calls: SentenceFixCall[] = []
  const corrections: Correction[] = []
  for (const sentence of sentences) {
    const t0 = performance.now()
    let fixed: string | null = null
    let raw = ''
    let perf: SentenceFixCall['perf'] = null
    try {
      const call = await args.chat(buildSentenceFixMessages(args.targetLang, sentence), {
        temperature: 0,
        maxTokens: 120,
        stop: ['\n'],
      })
      raw = call.text
      fixed = extractFixed(raw)
      perf = {
        promptTokens: call.perf?.promptTokens ?? null,
        completionTokens: call.perf?.completionTokens ?? null,
        ttftMs: call.perf?.ttftMs ?? null,
        decodeTokS: call.perf?.decodeTokS ?? null,
      }
    } catch {
      // one failed sentence check must not break the turn
    }
    const wallMs = Math.round(performance.now() - t0)
    calls.push({ sentence, fixed, raw, wallMs, perf })
    if (fixed !== null) {
      for (const c of diffToCorrections(sentence, fixed)) corrections.push(c)
    }
  }
  return { corrections, sentenceCount: sentences.length, calls }
}
