// ASR post-processing policy: Whisper repetition loops and its classic
// silence hallucinations ("Субтитры Т.", "Thank you for watching!").
// Pure functions — heavily unit-tested, because they decide whether a turn
// happens at all.

/** Collapse ASR repetition loops ("I don't I don't I don I don…") that
 *  Whisper base produces on silence-heavy audio: consecutive identical
 *  1-3 word runs collapse to a single instance, in passes until stable. */
export function collapseAsrRepetition(text: string): string {
  // Whisper also loops with hyphens ("Ди-ди-ди-ди-…", "la-la-la"): the whole
  // run is one token to the word-level rule below, so collapse it separately.
  const hyphenLoop = /(?<![\p{L}'’])([\p{L}'’]+)(?:-+\1){2,}(?![\p{L}'’])/giu
  let out = text.replace(hyphenLoop, '$1')
  // word boundaries via lookaround (\b is ASCII-only and breaks on Cyrillic):
  // without them the backreference matches word prefixes ("Ich h|abe" -> "h h")
  const re = /(?<![\p{L}'’])([\p{L}'’]+(?:\s+[\p{L}'’]+){0,2})(?:\s+\1)+(?![\p{L}'’])/giu
  out = out.replace(re, '$1')
  let prev = text
  let guard = 0
  while (out !== prev && guard < 3) {
    prev = out
    out = out.replace(re, '$1').replace(hyphenLoop, '$1')
    guard++
  }
  return out
}

/** Whisper's degenerate-output detector: a transcript that is mostly one
 *  repeated syllable ("Ди-ди-ди-…", "la la la la") is a decoder loop on noise,
 *  not speech. Run on the RAW transcript — after the collapse the evidence is
 *  gone ("Ди-ди-ди-…" collapses to a single "Ди"), so the raw text is what has
 *  to be judged. */
export function isDegenerateTranscript(text: string): boolean {
  // split hyphen joins too ("Ди-ди-ди" is three units, same as "ди ди ди")
  const units = (text.toLowerCase().match(/[\p{L}'’]+/gu) ?? [])
    .flatMap(w => w.split(/[-\u2010-\u2015]+/))
    .filter(Boolean)
  if (units.length < 4) return false
  const counts = new Map<string, number>()
  for (const u of units) counts.set(u, (counts.get(u) ?? 0) + 1)
  const top = Math.max(...counts.values())
  return top / units.length >= 0.6
}

/** A transcript that is a single meaningless syllable ("Ди", "la") after the
 *  collapse is decoder noise, not an answer: real one-word replies at A1 are
 *  words ("Ja", "Nein", "Kaffee") — those still pass because they carry no
 *  repetition, and this guard only fires when the raw text WAS a loop. */
export function isCollapsedLoop(rawText: string, text: string): boolean {
  const rawUnits = (rawText.toLowerCase().match(/[\p{L}'’]+/gu) ?? [])
    .flatMap(w => w.split(/[-\u2010-\u2015]+/))
    .filter(Boolean)
  const kept = (text.toLowerCase().match(/[\p{L}'’]+/gu) ?? []).length
  return rawUnits.length >= 4 && kept <= 1
}

/** Whisper's classic silence hallucinations: on noise, breathing or a quiet
 *  room it emits subtitle credits and sign-offs from its training data —
 *  "Субтитры Т.", "Редактор субтитров А.Синецкая Корректор А.Егорова",
 *  "Thank you for watching!". None of it was said by the student, so such a
 *  line must never become a conversation turn.

 *  Strong markers are credit-only words no student says about their own day;
 *  weak ones ("субтитры", "subtitles") are ordinary vocabulary, so they only
 *  count when the line is *just* the credit line (it starts with them). */
const HALLUCINATION_STRONG_RES: RegExp[] = [
  /корректор/i,
  /редактор\s+субтитр/i,
  /перевод\s+(и\s+)?субтитр/i,
  /продолжение\s+след/i,
  /спасибо\s+за\s+просмотр/i,
  /подпис(ывай|ывайтесь)/i,
  /ставьте\s+лайк/i,
  /субтитры\s+(сделал|делал|подготовил|перев[её]л)/i,
  /amara\.org/i,
  /thank(s|\s+you)?\s+for\s+watching/i,
  /subtitles?\s+(by|made|provided)/i,
  /danke\s+f[üu]rs\s+zuschauen/i,
  /merci\s+d'avoir\s+(regard|écout)/i,
  /gracias\s+por\s+ver/i,
  /obrigad[oa]\s+por\s+assistir/i,
]

/** Credit lines that merely *open* with the subtitle word ("Субтитры Т.",
 *  "Subtitles: …", "Untertitel von …") — checked as a prefix so that a real
 *  sentence mentioning subtitles in the middle survives. */
const HALLUCINATION_PREFIX_RES: RegExp[] = [
  /^\s*субтитр/i,
  /^\s*subtitles?\b/i,
  /^\s*untertitel\b/i,
  /^\s*sous-titres?\b/i,
  /^\s*subt[íi]tulos\b/i,
  /^\s*legendas?\b/i,
]

/** Is this transcript Whisper's boilerplate instead of the student's speech?
 *  Only short lines are checked — a long real answer must pass untouched. */
export function isAsrHallucination(text: string): boolean {
  const line = text.trim()
  if (!line) return false
  const words = line.match(/[\p{L}\p{N}]+/gu) ?? []
  if (words.length > 12) return false
  if (HALLUCINATION_STRONG_RES.some(re => re.test(line))) return true
  // a prefix marker needs a credit-shaped line: no verb-like sentence follows
  return HALLUCINATION_PREFIX_RES.some(re => re.test(line))
}
