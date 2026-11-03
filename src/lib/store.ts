// Storage: port of backend/services/conversation.py (dialog history) and
// backend/services/vocab.py (vocabulary) + backend/services/dictionary.py
// (offline deu-rus dictionary) onto localStorage. Semantics match the SQLite version:
// sort order, fuzzy word dedup, follow_up concat in the LLM history.
// History and vocabulary are kept per target language (with migration of
// the old German-only keys).

import type { Correction, HistoryMessage, VocabItem } from '../types'
import { TARGET_LANG_LIST, type TargetLang } from './langs'
import rawDictionary from '../data/deu-rus.json'

const SEQ_KEY = 'gt-web-seq'
const ONBOARD_KEY = 'blablabot-onboarded'

const HISTORY_MESSAGES_FOR_LLM = 10
const HISTORY_REPLY_LIMIT = 50

function messagesKey(lang: TargetLang): string {
  return `gt-web-messages-${lang}`
}

function vocabKey(lang: TargetLang): string {
  return `gt-web-vocab-${lang}`
}

/** Migrate the old German-only version: gt-web-messages → gt-web-messages-de */
function migrateLegacyKey(legacyKey: string, newKey: string): void {
  if (localStorage.getItem(newKey) !== null) return
  const legacy = localStorage.getItem(legacyKey)
  if (legacy === null) return
  localStorage.setItem(newKey, legacy)
  localStorage.removeItem(legacyKey)
}

interface StoredMessage {
  id: number
  role: 'user' | 'tutor'
  text: string
  user_translation: string
  corrections: Correction[]
  translation: string
  follow_up: string
  created_at: string
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    return fallback
  }
  return fallback
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function nextId(): number {
  const seq = Number(localStorage.getItem(SEQ_KEY) ?? '0') + 1
  localStorage.setItem(SEQ_KEY, String(seq))
  return seq
}

// ---------- Dialog history (ConversationStore port, per language) ----------

export const conversation = {
  addUser(lang: TargetLang, text: string, translation = ''): void {
    migrateLegacyKey('gt-web-messages', messagesKey(lang))
    const messages = readJson<StoredMessage[]>(messagesKey(lang), [])
    messages.push({
      id: nextId(),
      role: 'user',
      text,
      user_translation: translation,
      corrections: [],
      translation: '',
      follow_up: '',
      created_at: new Date().toISOString(),
    })
    writeJson(messagesKey(lang), messages)
  },

  addTutor(
    lang: TargetLang,
    text: string,
    corrections: Correction[],
    translation: string,
    followUp: string,
  ): void {
    const messages = readJson<StoredMessage[]>(messagesKey(lang), [])
    messages.push({
      id: nextId(),
      role: 'tutor',
      text,
      user_translation: '',
      corrections,
      translation,
      follow_up: followUp,
      created_at: new Date().toISOString(),
    })
    writeJson(messagesKey(lang), messages)
  },

  /** Port of history_for_llm: last N messages; tutor text is concatenated with follow_up */
  historyForLlm(
    lang: TargetLang,
    limit = HISTORY_MESSAGES_FOR_LLM,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    migrateLegacyKey('gt-web-messages', messagesKey(lang))
    const messages = readJson<StoredMessage[]>(messagesKey(lang), [])
    const slice = messages.slice(-limit)
    return slice.map(m => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.role === 'tutor' && m.follow_up ? `${m.text} ${m.follow_up}` : m.text,
    }))
  },

  recent(lang: TargetLang, limit = HISTORY_REPLY_LIMIT): HistoryMessage[] {
    migrateLegacyKey('gt-web-messages', messagesKey(lang))
    const messages = readJson<StoredMessage[]>(messagesKey(lang), [])
    return messages.slice(-limit).map(m => ({
      id: m.id,
      role: m.role,
      text: m.text,
      user_translation: m.user_translation || null,
      corrections: m.corrections ?? null,
      translation: m.translation || null,
      follow_up: m.follow_up || null,
      audio_url: null,
      created_at: m.created_at,
    }))
  },

  reset(lang: TargetLang): number {
    migrateLegacyKey('gt-web-messages', messagesKey(lang))
    const messages = readJson<StoredMessage[]>(messagesKey(lang), [])
    writeJson(messagesKey(lang), [])
    return messages.length
  },
}

// ---------- Vocabulary (VocabularyStore port, per language) ----------

const ARTICLE_RES: Array<{ lang: TargetLang; re: RegExp }> = [
  { lang: 'de', re: /^(der|die|das|ein|eine|einen|einem|einer|eines|den|dem)\s+/i },
  { lang: 'fr', re: /^(le|la|les|l'|un|une|des|du|au|aux)\s+/i },
  { lang: 'es', re: /^(el|la|los|las|un|una|unos|unas)\s+/i },
  { lang: 'pt', re: /^(o|a|os|as|um|uma|uns|umas)\s+/i },
]
const TRAILING_PUNCT_RE = /[.,!?;:]+$/

/** Port of normalize_word: lowercase, collapse spaces, strip article and trailing punctuation */
function normalizeWord(word: string, lang: TargetLang): string {
  let w = word.trim().toLowerCase().replace(/\s+/g, ' ').replace(TRAILING_PUNCT_RE, '')
  const rule = ARTICLE_RES.find(r => r.lang === lang)
  if (rule) w = w.replace(rule.re, '')
  return w
}

/** Port of words_match: match when one normalized form contains the other */
function wordsMatch(a: string, b: string, lang: TargetLang): boolean {
  const na = normalizeWord(a, lang)
  const nb = normalizeWord(b, lang)
  return na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))
}

export const vocab = {
  listAll(lang: TargetLang): VocabItem[] {
    migrateLegacyKey('gt-web-vocab', vocabKey(lang))
    const items = readJson<VocabItem[]>(vocabKey(lang), [])
    // unknown first, newest on top within a group (like list_all in vocab.py)
    return [...items]
      .map(i => ({ ...i, lang }))
      .sort((a, b) => Number(a.known) - Number(b.known) || b.id - a.id)
  },

  /** All flashcards across languages (for Drive export) */
  allLangs(): VocabItem[] {
    const out: VocabItem[] = []
    for (const lang of TARGET_LANG_LIST) {
      migrateLegacyKey('gt-web-vocab', vocabKey(lang))
      for (const item of readJson<VocabItem[]>(vocabKey(lang), [])) {
        out.push({ ...item, lang })
      }
    }
    return out
  },

  exists(lang: TargetLang, word: string): VocabItem | null {
    migrateLegacyKey('gt-web-vocab', vocabKey(lang))
    const items = readJson<VocabItem[]>(vocabKey(lang), [])
    return items.find(i => wordsMatch(i.word, word, lang)) ?? null
  },

  /** Port of add(): insert and return the entry (including a pre-existing fuzzy match) */
  add(
    lang: TargetLang,
    word: string,
    translation: string,
    partOfSpeech: string,
    example: string,
    exampleTranslation: string,
  ): VocabItem {
    migrateLegacyKey('gt-web-vocab', vocabKey(lang))
    const items = readJson<VocabItem[]>(vocabKey(lang), [])
    const existing = items.find(i => wordsMatch(i.word, word, lang))
    if (existing) return { ...existing, lang }
    const item: VocabItem = {
      id: nextId(),
      word,
      translation,
      part_of_speech: partOfSpeech,
      example,
      example_translation: exampleTranslation,
      known: false,
      created_at: new Date().toISOString(),
      lang,
    }
    items.push(item)
    writeJson(vocabKey(lang), items)
    return item
  },

  /** Overwrite a language's vocabulary (used by Drive sync) */
  replaceAll(lang: TargetLang, items: VocabItem[]): void {
    writeJson(vocabKey(lang), items.map(({ lang: _lang, ...rest }) => rest))
  },

  setKnown(lang: TargetLang, id: number, known: boolean): boolean {
    migrateLegacyKey('gt-web-vocab', vocabKey(lang))
    const items = readJson<VocabItem[]>(vocabKey(lang), [])
    const item = items.find(i => i.id === id)
    if (!item) return false
    item.known = known
    writeJson(vocabKey(lang), items)
    return true
  },

  delete(lang: TargetLang, id: number): boolean {
    migrateLegacyKey('gt-web-vocab', vocabKey(lang))
    const items = readJson<VocabItem[]>(vocabKey(lang), [])
    const next = items.filter(i => i.id !== id)
    if (next.length === items.length) return false
    writeJson(vocabKey(lang), next)
    return true
  },
}

// ---------- Offline deu-rus dictionary (German only) ----------

type DictEntry = { t: string[]; pos?: string }
const dictionary = rawDictionary as Record<string, DictEntry>

function lookupDictEntry(word: string): DictEntry | null {
  const normalized = word.trim().toLowerCase()
  if (!normalized) return null
  const direct = dictionary[normalized]
  if (direct) return direct
  const stripped = normalizeWord(normalized, 'de')
  if (stripped && stripped !== normalized) {
    const alt = dictionary[stripped]
    if (alt) return alt
  }
  return null
}

/** Port of OfflineDictionary.lookup: first 3 translations + part of speech (de only) */
export function lookupDictionary(word: string): { translations: string[]; pos: string } {
  const entry = lookupDictEntry(word)
  if (!entry) return { translations: [], pos: '' }
  return { translations: (entry.t ?? []).slice(0, 3), pos: entry.pos ?? '' }
}

// ---------- Onboarding ----------

export const onboarding = {
  done(): boolean {
    return localStorage.getItem(ONBOARD_KEY) === '1'
  },
  complete(): void {
    localStorage.setItem(ONBOARD_KEY, '1')
  },
}
