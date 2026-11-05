// Word identity policy: flashcards dedupe fuzzily ("Brot" ~ "das Brot"),
// and dictionary lookups try the same article-stripped form.

import type { TargetLang } from '../models'

const ARTICLE_RES: Array<{ lang: TargetLang; re: RegExp }> = [
  { lang: 'de', re: /^(der|die|das|ein|eine|einen|einem|einer|eines|den|dem)\s+/i },
  { lang: 'fr', re: /^(le|la|les|l'|un|une|des|du|au|aux)\s+/i },
  { lang: 'es', re: /^(el|la|los|las|un|una|unos|unas)\s+/i },
  { lang: 'pt', re: /^(o|a|os|as|um|uma|uns|umas)\s+/i },
]
const TRAILING_PUNCT_RE = /[.,!?;:]+$/

/** lowercase, collapse spaces, strip article and trailing punctuation */
export function normalizeWord(word: string, lang: TargetLang): string {
  let w = word.trim().toLowerCase().replace(/\s+/g, ' ').replace(TRAILING_PUNCT_RE, '')
  const rule = ARTICLE_RES.find(r => r.lang === lang)
  if (rule) w = w.replace(rule.re, '')
  return w
}

/** Match when one normalized form contains the other ("Brot" ~ "das Brot"). */
export function wordsMatch(a: string, b: string, lang: TargetLang): boolean {
  const na = normalizeWord(a, lang)
  const nb = normalizeWord(b, lang)
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))
}
