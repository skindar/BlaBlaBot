// Translation/suggestion quality gates: pure language policy extracted from
// the old monolithic engine so it can be unit-tested without a browser.
//
// Small local models routinely answer instead of translating, drop "?" of a
// yes/no question, echo the source, or drift into English. These checks are
// the difference between an honest gray line and a plausible lie in the UI.

import type { Suggestion, TargetLang, UiLang } from '../models'
import { langInfo } from './languages'
import { hasCyrillic, stripQuoteWrappers, stripThink } from './parse'

/** Is the translation in the UI language? ru — Cyrillic without foreign-script
 *  junk or Latin chatter; en — Latin without Cyrillic or CJK. */
export function translationOk(text: string, uiLang: UiLang): boolean {
  if (!text) return false
  const junk = /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Arabic}/u
  if (junk.test(text)) return false
  if (uiLang === 'ru') {
    if (!hasCyrillic(text)) return false
    // one Latin token is a name ("Anna"); two or more is chatter ("choose a name")
    const latinWords = text.match(/[a-z]{2,}/gi) ?? []
    if (latinWords.length > 1) return false
    return true
  }
  return /[a-zà-ÿ]/i.test(text) && !hasCyrillic(text)
}

/** Case/quote/space-insensitive phrase comparison */
export function samePhrase(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[«»"'’"]/g, '').replace(/\s+/g, ' ').trim()
  return norm(a) === norm(b)
}

/** English function words absent from de/fr/es/pt ("was"/"an"/"will"/"her"/
 *  "no"/"a"/"me" are real words in those languages — excluded on purpose) */
const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'and', 'is', 'are', 'was', 'were', 'be', 'been', 'you', 'your', 'i', 'we', 'our',
  'they', 'them', 'their', 'he', 'she', 'his', 'it', 'its', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'not', 'with', 'of', 'to', 'from',
  'for', 'about', 'have', 'has', 'had', 'do', 'does', 'did', 'would', 'could', 'should',
  'can', 'very', 'really', 'just', 'most', 'more', 'some', 'any', 'here', 'there', 'yes',
])

/** Does the text look like English? Tiny tutors occasionally drift into
 *  English mid-lesson; de/fr/es/pt text carries ~none of these words. */
export function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length === 0) return false
  const markers = words.filter(w => ENGLISH_FUNCTION_WORDS.has(w.replace(/'(s|ve|re|ll|d|m)$/, ''))).length
  return markers / words.length >= 0.25
}

/** Drop parenthetical/bracketed remarks in a foreign script, anywhere in the
 *  line: model chatter like "Меня зовут (choose a name – e.g., Иван)" is
 *  meta-instruction, never part of the translation. */
export function stripForeignParens(line: string, uiLang: UiLang): string {
  const foreign = uiLang === 'ru' ? /[a-z]/i : /[а-яё]/i
  return line
    .replace(/\(([^()]*)\)/g, (m, inner: string) => (foreign.test(inner) ? '' : m))
    .replace(/\[([^\[\]]*)\]/g, (m, inner: string) => (foreign.test(inner) ? '' : m))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Target-language wh-words (wie/was/quoi/cómo/…): a translation of such a
 *  question must carry a UI-language question word. Yes/no questions
 *  (verb-first: "Hast du…?") have none — there only the "?" remains. */
export const TARGET_WH_RE: Record<TargetLang, RegExp> = {
  de: /(^|\s)(wie|was|wo|wann|warum|weshalb|wieso|wozu|welche[rsmn]?|wer|wieviel[e]?)/i,
  en: /(^|\s)(what|which|who|when|where|why|how)/i,
  fr: /(^|\s)(comment|quoi|o[uù]|quand|pourquoi|quel(le|le|s)?|qui|combien)/i,
  es: /(^|\s)(c[oó]mo|qu[eé]|d[oó]nde|cu[aá]ndo|cu[aá]l|qui[eé]n|cu[aá]nto)/i,
  pt: /(^|\s)(como|que|onde|quando|qual|quem|quanto)/i,
  ru: /(^|\s)(как|что|где|когда|почему|зачем|какой|какая|какие|кто|сколько)/i,
}

/** UI-language question words: a translation of a question keeps one even
 *  when the model drops the "?" — an answer does not */
export const QUESTION_WORD_RE = {
  ru: /(^|[^а-яё])(какие|какого|каким|какую|какой|какая|какое|сколько|откуда|почему|когда|зачем|куда|кому|чего|чем|что|как|где|кто)(?![а-яё])/i,
  en: /(^|[^a-z])(which|whose|what|where|when|why|who|how)(?![a-z])/i,
} as const

/** Last-ditch rescue for a translation that dropped the "?" of a yes/no
 *  question ("Hast du… gelesen?" -> "Ты читала книгу"): no question word
 *  is expected there, so accept the line with the "?" restored — unless
 *  it looks like an answer (Да/Нет…) or loses numbers. Wh-questions still
 *  require a real question word in the translation. */
export function rescueYesNoQuestion(
  source: string,
  candidate: string,
  uiLang: UiLang,
  targetLang: TargetLang,
): string {
  const srcQ = (source.match(/\?/g) ?? []).length
  if (srcQ === 0) return ''
  const line = stripForeignParens(candidate.trim(), uiLang)
  if (!line || !translationOk(line, uiLang)) return ''
  if ((line.match(/\?/g) ?? []).length > 0) return ''
  const nums = source.match(/\d+/g) ?? []
  if (nums.some(n => !line.includes(n))) return ''
  if (TARGET_WH_RE[targetLang].test(source)) {
    // a wh-question must surface its question word — answers don't
    return QUESTION_WORD_RE[uiLang].test(line) ? line : ''
  }
  // yes/no question: answers start with yes/no, translations don't
  const ANSWER_PREFIX_RE = {
    ru: /^(да|нет|конечно)(?![а-яё])/i,
    en: /^(yes|no|of course|sure)(?![a-z])/i,
  } as const
  if (ANSWER_PREFIX_RE[uiLang].test(line)) return ''
  return line.replace(/[.!]?\s*$/, '?')
}

/** Pull one translated line out of a bare-text answer. Some models wrap
 *  their translation into a single-string JSON anyway — extract it;
 *  everything else (think blocks, wrapping quotes) is stripped. */
export function parseSingleTranslation(raw: string): string {
  const bare = stripQuoteWrappers(stripThink(raw.trim())).replace(/\s+/g, ' ').trim()
  if (bare.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(bare)
      if (typeof data === 'object' && data !== null) {
        const values = Object.values(data as Record<string, unknown>).filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0,
        )
        if (values.length > 0) return values[0].trim()
      }
    } catch {
      /* not JSON after all — keep the bare text */
    }
  }
  return bare.length > 0 && bare.length <= 400 ? bare : ''
}

/** Cheap cross-language sanity checks for a translation candidate.
 *  A real translation keeps the source's questions and numbers. Tiny
 *  models often ANSWER the text instead of translating it ("Wie ist das
 *  Wetter?" -> "Погода хорошая, но идёт дождь"), translate the other
 *  party's line, or drop half the content.
 *
 *  strict = true: every question must survive — a cut like "Mir geht es
 *  gut, und dir? Was möchtest du…?" -> "У вас как?" is rejected.
 *  strict = false (last-resort tier): at least the question-ness must
 *  survive — an answer instead of a translation still never passes.
 *  Invented questions and lost numbers are rejected on every tier. */
export function translationSane(
  source: string,
  candidate: string,
  uiLang: UiLang,
  strict = true,
): boolean {
  if (!candidate) return false
  const srcQ = (source.match(/\?/g) ?? []).length
  const trQ = (candidate.match(/\?/g) ?? []).length
  // strict: every question survives; loose: at least a question word does
  if (srcQ > 0 && (strict ? trQ < srcQ : trQ === 0 && !QUESTION_WORD_RE[uiLang].test(candidate)))
    return false
  if (srcQ === 0 && trQ > 0) return false
  // numbers survive translation
  const nums = source.match(/\d+/g) ?? []
  if (nums.some(n => !candidate.includes(n))) return false
  // A real translation keeps most of the content: "Danke fürs Erzählen! Sehr
  // gut gemacht! Neues Thema: Frühstück. Trinkst du…?" -> "Сегодняшний
  // завтрак?" silently dropped half the sentences. Russian runs ~0.7–1.0× of
  // the German word count, so 0.55 (strict) / 0.45 (loose) is a safe floor.
  const srcWords = (source.match(/[\p{L}\p{N}]+/gu) ?? []).length
  const trWords = (candidate.match(/[\p{L}\p{N}]+/gu) ?? []).length
  if (srcWords >= 6 && trWords < Math.ceil(srcWords * (strict ? 0.55 : 0.45))) return false
  return true
}

/** Clean raw model suggestions. Tiny models often echo the target-language
 *  phrase into "translation" (the chip then shows the same line twice),
 *  swap the text/translation fields, repeat the tutor's reply as a
 *  "suggestion", or emit one phrase three times. Keep the UI honest:
 *  a chip shows a short target-language phrase plus a translation that is
 *  really in the UI language — anything else loses the gray line or the
 *  whole chip. */
export function cleanSuggestions(
  raw: Suggestion[],
  uiLang: UiLang,
  targetLang: TargetLang,
): Suggestion[] {
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const s of raw) {
    let text = stripQuoteWrappers(s.text.trim())
    let translation = stripQuoteWrappers(s.translation.trim())
    if (!text) continue
    // a chip must be in the target language — an English chip is drift
    if (targetLang !== 'en' && looksEnglish(text)) continue
    // Swapped fields (ru UI): "text" holds the Russian translation
    if (uiLang === 'ru' && hasCyrillic(text) && translation && !hasCyrillic(translation)) {
      ;[text, translation] = [translation, text]
    }
    // A suggestion is a complete mini-sentence the student could say —
    // single words ("meine") and full tutor replies are both useless here
    const words = text.split(/\s+/).filter(Boolean).length
    if (words < 2 || words > 10 || text.length > 90) continue
    const key = text.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    // The gray line must be a real UI-language translation:
    // drop echoes of the text itself and wrong-language strings
    if (!translation || !translationOk(translation, uiLang) || samePhrase(text, translation)) {
      translation = ''
    }
    // After cleanup the phrase itself must be in the target language
    if (uiLang === 'ru' && hasCyrillic(text)) continue
    seen.add(key)
    out.push({ text, translation })
    if (out.length >= 3) break
  }
  return out
}

// ---------- Target-script guard (wrong-language drift) ----------

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/u
const CYRILLIC_CHAR_RE = /[\u0400-\u04ff]/u
const LATIN_WORD_RE = /\b[A-Za-zÀ-ÿ]{2,}\b/gu

/** Wrong-script text for the target language. Small models drift into random
 *  languages (a Russian lesson answered with "Поговорим о чему khác…").
 *  `looksEnglishDrift` only knows English function words; this catches the
 *  script-level mistakes instead.
 *
 *  For Russian, any lowercase Latin word ("khác", "pernah", "hello") is
 *  drift; capitalised Latin words are allowed as names/places ("Anna",
 *  "Berlin"). For the Latin-script target languages, any Cyrillic/CJK run is
 *  drift. */
export function hasWrongScript(text: string, targetLang: TargetLang): boolean {
  if (!text.trim()) return false
  if (CJK_RE.test(text)) return true
  if (targetLang === 'ru') {
    // Any lowercase Latin word in a Russian lesson is model/code drift; a
    // capitalised one is allowed as a name/place ("Anna", "Berlin").
    return (text.match(LATIN_WORD_RE) ?? []).some(w => w[0] === w[0].toLowerCase())
  }
  return CYRILLIC_CHAR_RE.test(text)
}

/** Convenience used by the turn service: is this line in a language other
 *  than the one being learned? (English is the only drift the models show.) */
export function isEnglishDrift(text: string, targetLang: TargetLang): boolean {
  return targetLang !== 'en' && looksEnglish(text)
}

/** Target languages whose offline dictionary exists today (deu-rus). */
export function hasOfflineDictionary(targetLang: TargetLang): boolean {
  return langInfo(targetLang).hasOfflineDict
}
