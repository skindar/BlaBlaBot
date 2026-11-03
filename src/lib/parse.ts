// Port of the robust parser from backend/models/llm.py: <think> stripping, code fences,
// brace balancing, regex fallback, correction filtering and script checks.
// Behavior matches the native version 1:1 so that small browser models
// fail just as predictably.

import { TUTOR_FALLBACK, type TargetLang } from './langs'
import type { Correction, Suggestion } from '../types'

/** How a tutor reply was extracted — the benchmark's JSON-reliability metric */
export type ParseMethod = 'json' | 'repaired' | 'rescued' | 'regex' | 'plain'

export interface TutorReply {
  reply: string
  corrections: Correction[]
  translation: string
  follow_up: string
  follow_up_translation: string
  suggestions: Suggestion[]
  method: ParseMethod
}

const THINK_RE = /<think>[\s\S]*?<\/think>/g
const THINK_UNCLOSED_RE = /<think>[\s\S]*/g
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)\s*```/g

const WORD_RE = /[\p{L}\p{N}]+/gu
const CYRILLIC_RE = /[а-яёА-ЯЁ]/
const LATIN_RE = /[a-zà-ÿ]/i

function cleanRaw(raw: string): string {
  let cleaned = stripThink(raw)
  cleaned = cleaned.replace(FENCE_RE, (_m, g1: string) => g1).trim()
  return cleaned
}

/** Strip <think> blocks (closed or not) — Qwen3 does not always honor
 *  thinking switches, so the parser must tolerate them */
export function stripThink(raw: string): string {
  let cleaned = raw.replace(THINK_RE, '')
  if (cleaned.includes('<think>')) cleaned = cleaned.replace(THINK_UNCLOSED_RE, '')
  return cleaned
}

/** Drop trailing commas and smart quotes around keys (like _repair_json) */
function repairJson(text: string): string {
  let t = text
  for (const bad of ['«', '»', '“', '”', '„']) t = t.split(bad).join('"')
  return t.replace(/,\s*([}\]])/g, '$1')
}

/** Port of _balance_json: close unbalanced braces/strings */
function balanceJson(fragment: string): string | null {
  const stack: string[] = []
  let inString = false
  let escape = false
  let lastComplete = -1
  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      if (stack.length === 0) break
      stack.pop()
      if (stack.length === 0) lastComplete = i
    }
  }
  if (lastComplete >= 0) return fragment.slice(0, lastComplete + 1)
  if (stack.length === 0) return null
  let candidate = fragment.trimEnd()
  if (inString) candidate += '"'
  candidate = candidate.trimEnd()
  if (candidate.endsWith(',')) candidate = candidate.slice(0, -1)
  const closers: Record<string, string> = { '{': '}', '[': ']' }
  return candidate + [...stack].reverse().map(c => closers[c]).join('')
}

/** Port of _json_candidates */
function jsonCandidates(text: string): string[] {
  const start = text.indexOf('{')
  if (start === -1) return []
  const out: string[] = []
  const end = text.lastIndexOf('}')
  if (end > start) out.push(text.slice(start, end + 1))
  const balanced = balanceJson(text.slice(start))
  if (balanced && !out.includes(balanced)) out.push(balanced)
  return out
}

function unescapeQuoted(s: string): string | null {
  try {
    return JSON.parse(`"${s}"`) as string
  } catch {
    return null
  }
}

function replyFromDict(data: Record<string, unknown>): Omit<TutorReply, 'method'> | null {
  const replyRaw = data.reply ?? data.response ?? ''
  if (typeof replyRaw !== 'string' || !replyRaw.trim()) return null
  const corrections: Correction[] = []
  const correctionsRaw = data.corrections
  if (Array.isArray(correctionsRaw)) {
    for (const item of correctionsRaw.slice(0, 10)) {
      if (typeof item !== 'object' || item === null) continue
      const { original, corrected } = item as Record<string, unknown>
      if (
        typeof original === 'string' &&
        typeof corrected === 'string' &&
        original.trim() &&
        corrected.trim()
      ) {
        const explanation = (item as Record<string, unknown>).explanation
        corrections.push({
          original: original.trim(),
          corrected: corrected.trim(),
          explanation: typeof explanation === 'string' ? explanation.trim() : '',
        })
      }
    }
  }
  const followUp = strOrEmpty(data.follow_up ?? data.follow_up_question)
  const followUpTr = strOrEmpty(data.follow_up_translation)
  const translation = strOrEmpty(data.translation)
  const suggestions: Suggestion[] = []
  const suggestionsRaw = data.suggestions
  if (Array.isArray(suggestionsRaw)) {
    for (const item of suggestionsRaw.slice(0, 3)) {
      if (typeof item === 'object' && item !== null) {
        const text = (item as Record<string, unknown>).text
        if (typeof text === 'string' && text.trim()) {
          const tr = (item as Record<string, unknown>).translation
          suggestions.push({ text: text.trim(), translation: typeof tr === 'string' ? tr.trim() : '' })
        }
      } else if (typeof item === 'string' && item.trim()) {
        suggestions.push({ text: item.trim(), translation: '' })
      }
    }
  }
  return {
    reply: replyRaw.trim(),
    corrections,
    translation,
    follow_up: followUp,
    follow_up_translation: followUpTr,
    suggestions,
  }
}

function strOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

const CORRECTION_RE =
  /\{\s*"original"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"corrected"\s*:\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"explanation"\s*:\s*"((?:[^"\\]|\\.)*)")?\s*\}/g
const SUGGESTION_RE = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"translation"\s*:\s*"((?:[^"\\]|\\.)*)"/g

/** Port of _regex_fallback: extract fields with regexes when JSON did not parse */
function regexFallback(cleaned: string): Omit<TutorReply, 'method'> | null {
  const replyM = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(cleaned)
  if (!replyM) return null
  const reply = unescapeQuoted(replyM[1])
  if (reply === null || !reply.trim()) return null
  const corrections: Correction[] = []
  for (const m of cleaned.matchAll(CORRECTION_RE)) {
    const orig = unescapeQuoted(m[1])
    const corr = unescapeQuoted(m[2])
    const expl = m[3] ? unescapeQuoted(m[3]) : ''
    if (orig === null || corr === null) continue
    if (orig.trim() && corr.trim() && orig !== corr) {
      corrections.push({ original: orig, corrected: corr, explanation: expl ?? '' })
    }
    if (corrections.length >= 10) break
  }
  const suggestions: Suggestion[] = []
  for (const m of cleaned.matchAll(SUGGESTION_RE)) {
    const text = unescapeQuoted(m[1])
    const tr = unescapeQuoted(m[2])
    if (text !== null && tr !== null) suggestions.push({ text, translation: tr })
    if (suggestions.length >= 3) break
  }
  const translationM = /"translation"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(cleaned)
  let translation = ''
  if (translationM) translation = unescapeQuoted(translationM[1]) ?? ''
  return {
    reply: reply.trim(),
    corrections,
    translation: translation.trim(),
    follow_up: '',
    follow_up_translation: '',
    suggestions,
  }
}

/** Last-ditch rescue for tiny models that put the JSON inside <think> and
 *  truncate it: pull a fenced ```json block (possibly unterminated) or the
 *  first {...} from the RAW text — think blocks included — and balance-close
 *  whatever was cut off. */
function thinkJsonRescue(raw: string): Omit<TutorReply, 'method'> | null {
  const candidates: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)(?:```|$)/.exec(raw)
  if (fence?.[1]?.includes('{')) candidates.push(fence[1])
  const brace = raw.indexOf('{')
  if (brace >= 0) candidates.push(raw.slice(brace))
  for (const candidate of candidates) {
    for (const attempt of [balanceJson(candidate), repairJson(balanceJson(candidate) ?? candidate)]) {
      if (!attempt) continue
      let data: unknown
      try {
        data = JSON.parse(attempt)
      } catch {
        continue
      }
      if (typeof data === 'object' && data !== null) {
        const reply = replyFromDict(data as Record<string, unknown>)
        if (reply !== null) return reply
      }
    }
  }
  return null
}

/** Port of parse_tutor_reply. `method` records how the reply was extracted —
 *  the benchmark's JSON-reliability metric for small models. `targetLang`
 *  picks the apology used when nothing could be parsed at all. */
export function parseTutorReply(raw: string, targetLang: TargetLang = 'de'): TutorReply {
  const cleaned = cleanRaw(raw)
  for (const candidate of jsonCandidates(cleaned)) {
    const attempts: Array<{ text: string; method: 'json' | 'repaired' }> = [
      { text: candidate, method: 'json' },
      { text: repairJson(candidate), method: 'repaired' },
    ]
    for (const attempt of attempts) {
      let data: unknown
      try {
        data = JSON.parse(attempt.text)
      } catch {
        continue
      }
      if (typeof data === 'object' && data !== null) {
        const reply = replyFromDict(data as Record<string, unknown>)
        if (reply !== null) return { ...reply, method: attempt.method }
      }
    }
  }
  const rescued = regexFallback(cleaned)
  if (rescued !== null) return { ...rescued, method: 'regex' }
  const fromThink = thinkJsonRescue(raw)
  if (fromThink !== null) return { ...fromThink, method: 'rescued' }
  const text = cleaned.trim() || TUTOR_FALLBACK[targetLang]
  return {
    reply: text,
    corrections: [],
    translation: '',
    follow_up: '',
    follow_up_translation: '',
    suggestions: [],
    method: 'plain',
  }
}

export interface CorrectionsReply {
  corrections: Correction[]
  method: 'json' | 'repaired' | 'regex' | 'fail'
}

/** Parse the tiny-tier corrections call: {"corrections": [...]} on the user's
 *  last message only. Regex fallback extracts {...original/corrected...}
 *  pairs wherever they appear. */
export function parseCorrectionsJson(raw: string): CorrectionsReply {
  const cleaned = cleanRaw(raw)
  for (const candidate of jsonCandidates(cleaned)) {
    for (const attempt of [candidate, repairJson(candidate)]) {
      let data: unknown
      try {
        data = JSON.parse(attempt)
      } catch {
        continue
      }
      if (typeof data === 'object' && data !== null) {
        const list = (data as Record<string, unknown>).corrections
        if (Array.isArray(list)) {
          const corrections: Correction[] = []
          for (const item of list.slice(0, 10)) {
            if (typeof item !== 'object' || item === null) continue
            const { original, corrected } = item as Record<string, unknown>
            if (typeof original === 'string' && typeof corrected === 'string' && original.trim() && corrected.trim()) {
              const explanation = (item as Record<string, unknown>).explanation
              corrections.push({
                original: original.trim(),
                corrected: corrected.trim(),
                explanation: typeof explanation === 'string' ? explanation.trim() : '',
              })
            }
          }
          return { corrections, method: 'json' }
        }
      }
    }
  }
  // regex fallback over the raw text
  const corrections: Correction[] = []
  for (const m of raw.matchAll(CORRECTION_RE)) {
    const orig = unescapeQuoted(m[1])
    const corr = unescapeQuoted(m[2])
    const expl = m[3] ? unescapeQuoted(m[3]) : ''
    if (orig !== null && corr !== null && orig.trim() && corr.trim() && orig !== corr) {
      corrections.push({ original: orig, corrected: corr, explanation: expl ?? '' })
    }
    if (corrections.length >= 10) break
  }
  if (corrections.length > 0) return { corrections, method: 'regex' }
  return { corrections: [], method: 'fail' }
}

export interface SuggestionsReply {
  suggestions: Suggestion[]
  method: 'json' | 'repaired' | 'lines' | 'fail'
}

/** Parse the dedicated suggestions call: a JSON array of short phrases
 *  ({"suggestions": [...]} objects also accepted). Tiny models often
 *  answer with a numbered list instead — accept that too. */
export function parseSuggestionsJson(raw: string): SuggestionsReply {
  const cleaned = cleanRaw(raw)
  // The contract is a bare JSON array — jsonCandidates only looks for
  // objects, so collect [...] candidates first, then {...} as a bonus
  const candidates: string[] = []
  const arrStart = cleaned.indexOf('[')
  if (arrStart >= 0) {
    const arrEnd = cleaned.lastIndexOf(']')
    if (arrEnd > arrStart) candidates.push(cleaned.slice(arrStart, arrEnd + 1))
    const balanced = balanceJson(cleaned.slice(arrStart))
    if (balanced !== null && !candidates.includes(balanced)) candidates.push(balanced)
  }
  for (const c of jsonCandidates(cleaned)) {
    if (!candidates.includes(c)) candidates.push(c)
  }
  for (const candidate of candidates) {
    const attempts: Array<{ text: string; method: 'json' | 'repaired' }> = [
      { text: candidate, method: 'json' },
      { text: repairJson(candidate), method: 'repaired' },
    ]
    for (const attempt of attempts) {
      let data: unknown
      try {
        data = JSON.parse(attempt.text)
      } catch {
        continue
      }
      let list: unknown = null
      if (Array.isArray(data)) list = data
      else if (typeof data === 'object' && data !== null) {
        const maybe = (data as Record<string, unknown>).suggestions
        if (Array.isArray(maybe)) list = maybe
      }
      if (!Array.isArray(list)) continue
      const out: Suggestion[] = []
      for (const item of list.slice(0, 3)) {
        if (typeof item === 'string' && item.trim()) {
          out.push({ text: item.trim(), translation: '' })
        } else if (typeof item === 'object' && item !== null) {
          const { text, translation } = item as Record<string, unknown>
          if (typeof text === 'string' && text.trim()) {
            out.push({ text: text.trim(), translation: typeof translation === 'string' ? translation.trim() : '' })
          }
        }
      }
      if (out.length > 0) return { suggestions: out, method: attempt.method }
    }
  }
  // numbered/bulleted list fallback: "1. Ich mag Krimis" per line.
  // Intro lines end with ':' — drop them; a lone surviving line is
  // usually chatter, not a suggestion list
  const phrases = cleaned
    .split('\n')
    .map(l => l.trim().replace(/^\d+[.)]\s*/, '').replace(/^[-\u2022*]\s*/, '').trim())
    .filter(p => p.length > 1 && p.length <= 90 && !/[:;]$/.test(p))
  if (phrases.length >= 2) {
    return { suggestions: phrases.slice(0, 3).map(p => ({ text: p, translation: '' })), method: 'lines' }
  }
  return { suggestions: [], method: 'fail' }
}

export interface TranslationPair {
  user: string
  reply: string
}

/** Port of parse_translation_json */
export function parseTranslationJson(raw: string): TranslationPair | null {
  const cleaned = cleanRaw(raw)
  for (const candidate of jsonCandidates(cleaned)) {
    let data: unknown
    try {
      data = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof data !== 'object' || data === null) continue
    const dict = data as Record<string, unknown>
    const replyTr = dict.reply
    if (typeof replyTr !== 'string' || !replyTr.trim()) continue
    const userTr = dict.user
    return {
      user: typeof userTr === 'string' ? userTr.trim() : '',
      reply: replyTr.trim(),
    }
  }
  return null
}

export interface VocabLookup {
  exists: boolean
  word: string
  translation: string
  part_of_speech: string
  example: string
  example_translation: string
  comment: string
}

/** Port of parse_vocab_json */
export function parseVocabJson(raw: string): VocabLookup | null {
  const cleaned = cleanRaw(raw)
  for (const candidate of jsonCandidates(cleaned)) {
    let data: unknown
    try {
      data = JSON.parse(candidate)
    } catch {
      continue
    }
    if (typeof data !== 'object' || data === null) continue
    const dict = data as Record<string, unknown>
    if (dict.exists === false) {
      return {
        exists: false,
        word: strOrEmpty(dict.word),
        translation: '',
        part_of_speech: '',
        example: '',
        example_translation: '',
        comment: strOrEmpty(dict.comment),
      }
    }
    const translation = dict.translation
    if (typeof translation !== 'string' || !translation.trim()) continue
    return {
      exists: true,
      word: strOrEmpty(dict.word),
      translation: translation.trim(),
      part_of_speech: strOrEmpty(dict.part_of_speech),
      example: strOrEmpty(dict.example),
      example_translation: strOrEmpty(dict.example_translation),
      comment: '',
    }
  }
  return null
}

function normalize(text: string): string {
  return (text.toLowerCase().match(WORD_RE) ?? []).join(' ')
}

/** Content stems for overlap checks (tutor relevance gates): 4-char prefixes
 *  make inflection families match (kommst/komme, heiße/heißt, kein/keine). */
export function contentStems(text: string): Set<string> {
  const STOP = new Set([
    'auch', 'aber', 'und', 'oder', 'nicht', 'kein', 'keine', 'sehr', 'gut', 'ja', 'nein',
    'danke', 'bitte', 'schön', 'toll', 'super', 'wunderbar', 'gern', 'gerne', 'noch', 'nur',
    'mein', 'meine', 'dein', 'deine', 'habe', 'hast', 'hat', 'war', 'ist', 'bin', 'bist', 'sind',
    'this', 'that', 'very', 'really', 'nice', 'great', 'good', 'thanks', 'yes', 'okay', 'fine',
  ])
  const out = new Set<string>()
  for (const t of text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
    if (STOP.has(t)) continue
    out.add(t.length >= 5 ? t.slice(0, 4) : t)
  }
  return out
}

/** Port of filter_corrections: drop empty, degenerate, not-from-the-message
 *  and rewriting corrections; hide explanations not in the UI language. */
export function filterCorrections(
  corrections: Correction[],
  userText: string,
  uiLang: 'ru' | 'en' = 'ru',
): Correction[] {
  const userNorm = normalize(userText)
  const userTokens = new Set(userNorm.split(' ').filter(Boolean))
  // Telegraphic fragments ("Mit Milch.", "Ja.") are normal spoken answers at
  // A1 — the checker invents "fixes" for them; below three words we do not
  // correct at all.
  if (userTokens.size < 3) return []
  const kept: Correction[] = []
  for (const c of corrections) {
    const origNorm = normalize(c.original)
    const corrNorm = normalize(c.corrected)
    if (!origNorm || !corrNorm) continue
    if (origNorm === corrNorm) continue
    const tokens = origNorm.split(' ').filter(Boolean)
    const hits = tokens.filter(t => userTokens.has(t)).length
    if (!userNorm.includes(origNorm) && (tokens.length === 0 || hits / tokens.length < 0.6)) continue
    const corrTokenSet = new Set(corrNorm.split(' ').filter(Boolean))
    const preserved = tokens.length ? tokens.filter(t => corrTokenSet.has(t)).length / tokens.length : 0
    if (preserved < 0.5) continue

    // ---- 1B-model hallucination guards (bench 2026-11-03 e2e): the tiny
    //  checker invents fixes for correct sentences ----
    const origWords = origNorm.split(' ').filter(Boolean)
    const corrWords = corrNorm.split(' ').filter(Boolean)
    // 1. Fragment completion: "Und du?" -> a full question — not a fix
    if (corrWords.length > Math.max(4, origWords.length + 3)) continue
    // 2. Pure reordering of a pronoun-first sentence is stylistic inversion,
    //    not a fix: "Ich heiße Sascha." -> "Sascha heiße ich." A real V2 fix
    //    ("Am Wochenende ich habe..." -> "Am Wochenende habe ich...") starts
    //    with a non-pronoun and survives.
    const sameWords =
      origWords.length === corrWords.length && origWords.every(w => corrWords.includes(w))
    const SUBJECT_PRONOUNS = new Set([
      'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr',
      'i', 'you', 'we', 'they',
      'je', 'tu', 'il', 'elle', 'nous', 'vous', 'on',
      'yo', 'él', 'ella', 'nosotros', 'vosotros', 'ustedes',
      'eu', 'você', 'ele', 'ela', 'nós',
    ])
    if (sameWords && SUBJECT_PRONOUNS.has(origWords[0]) && origWords[0] !== corrWords[0]) continue
    // 3. Single content-word substitution with a different 4-char stem is a
    //    word-CHOICE change, not grammar: "Was machst du..." -> "Was hast du..."
    //    Inflection fixes share the stem (kein/keine, mein/meinem) and survive.
    if (origWords.length === corrWords.length && origWords.length >= 2) {
      const diffIdx = origWords.map((w, i) => (w !== corrWords[i] ? i : -1)).filter(i => i >= 0)
      if (diffIdx.length === 1) {
        const a = origWords[diffIdx[0]]
        const b = corrWords[diffIdx[0]]
        if (a.length >= 4 && b.length >= 4 && a.slice(0, 4) !== b.slice(0, 4)) continue
      }
    }
    // 4. The "fix" must not itself violate verb-second: "Gestern ich spielte
    //    Fußball" offered as the CORRECTED form teaches broken German —
    //    a fronted time phrase directly followed by "ich" is still wrong.
    if (/\b(gestern|morgen|heute|danach|jetzt|nächst\w*|letzt\w*)\s+ich\b/i.test(corrNorm)) continue
    if (/\bam\s+\S+\s+ich\b/i.test(corrNorm)) continue

    let explanation = c.explanation
    if (explanation) {
      // ru — Cyrillic; en — Latin without Cyrillic (same test as translationOk)
      const inUiLang =
        uiLang === 'ru' ? CYRILLIC_RE.test(explanation) : LATIN_RE.test(explanation) && !CYRILLIC_RE.test(explanation)
      if (!inUiLang) explanation = ''
    }
    kept.push({ original: c.original, corrected: c.corrected, explanation })
  }
  return kept
}

/** Contains Cyrillic (port of the cyrillic_re checks in pipeline.py) */
export function hasCyrillic(text: string): boolean {
  return CYRILLIC_RE.test(text)
}

/** Strip wrapping quotes when the model returned a bare string instead of JSON */
export function stripQuoteWrappers(text: string): string {
  return text.trim().replace(/^["«»„“]+|["«»„“]+$/g, '')
}
