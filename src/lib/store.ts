// Storage: port of backend/services/conversation.py (dialog history) and
// backend/services/vocab.py (vocabulary) + backend/services/dictionary.py
// (offline deu-rus dictionary) onto localStorage. Semantics match the SQLite version:
// sort order, fuzzy word dedup, follow_up concat in the LLM history.
// History and vocabulary are kept per target language (with migration of
// the old German-only keys).

import type { Correction, DiaryEntry, HistoryMessage, VocabItem } from '../types'
import { TARGET_LANG_LIST, type TargetLang } from './langs'
import type { TutorSession } from './scenarios'

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

// ---------- Change events (Drive sync schedules its pushes off these) ----------

export type DirtyKind = 'vocab' | 'history' | 'diary' | 'activity'
let dirtyHandler: ((kind: DirtyKind, lang: TargetLang) => void) | null = null

export function setStoreDirtyHandler(fn: ((kind: DirtyKind, lang: TargetLang) => void) | null): void {
  dirtyHandler = fn
}

function fireDirty(kind: DirtyKind, lang: TargetLang): void {
  try {
    dirtyHandler?.(kind, lang)
  } catch {
    /* a sync error must never break the pipeline */
  }
}

// ---------- Dialog history (ConversationStore port, per language) ----------

export interface StoredMessage {
  id: number
  role: 'user' | 'tutor'
  text: string
  user_translation: string
  corrections: Correction[]
  translation: string
  follow_up: string
  created_at: string
}

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
    activity.bump()
    fireDirty('history', lang)
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
    fireDirty('history', lang)
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
    fireDirty('history', lang)
    return messages.length
  },

  /** Raw messages for the Drive sync (exact stored shape) */
  loadRaw(lang: TargetLang): StoredMessage[] {
    migrateLegacyKey('gt-web-messages', messagesKey(lang))
    return readJson<StoredMessage[]>(messagesKey(lang), [])
  },

  /** Replace the whole conversation (Drive sync merge) */
  replaceRaw(lang: TargetLang, messages: StoredMessage[]): void {
    writeJson(messagesKey(lang), messages)
    fireDirty('history', lang)
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

/** Stable sync id for legacy items (created before uid existed) */
function legacyUid(id: number, createdAt: string): string {
  return `v${id}-${createdAt}`
}

/** Backfill uid/updated_at on read; items written before the Drive sync lack them */
function withSyncFields(item: VocabItem, lang: TargetLang): VocabItem {
  return {
    ...item,
    uid: item.uid ?? legacyUid(item.id, item.created_at),
    updated_at: item.updated_at ?? item.created_at,
    lang,
  }
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
      .map(i => withSyncFields(i, lang))
      .sort((a, b) => Number(a.known) - Number(b.known) || b.id - a.id)
  },

  /** All flashcards across languages (for Drive export) */
  allLangs(): VocabItem[] {
    const out: VocabItem[] = []
    for (const lang of TARGET_LANG_LIST) {
      migrateLegacyKey('gt-web-vocab', vocabKey(lang))
      for (const item of readJson<VocabItem[]>(vocabKey(lang), [])) {
        out.push(withSyncFields(item, lang))
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
    if (existing) return withSyncFields(existing, lang)
    const now = new Date().toISOString()
    const item: VocabItem = {
      id: nextId(),
      uid: (globalThis.crypto?.randomUUID?.() ?? `v${nextId()}-${now}`),
      word,
      translation,
      part_of_speech: partOfSpeech,
      example,
      example_translation: exampleTranslation,
      known: false,
      created_at: now,
      updated_at: now,
      lang,
    }
    items.push(item)
    writeJson(vocabKey(lang), items)
    fireDirty('vocab', lang)
    return item
  },

  /** Overwrite a language's vocabulary (used by Drive sync) */
  replaceAll(lang: TargetLang, items: VocabItem[]): void {
    const stripped = items
      .filter(i => (i.lang ?? lang) === lang)
      .map(({ lang: _lang, ...rest }) => rest)
    writeJson(vocabKey(lang), stripped)
    fireDirty('vocab', lang)
  },

  setKnown(lang: TargetLang, id: number, known: boolean): boolean {
    migrateLegacyKey('gt-web-vocab', vocabKey(lang))
    const items = readJson<VocabItem[]>(vocabKey(lang), [])
    const item = items.find(i => i.id === id)
    if (!item) return false
    item.known = known
    item.updated_at = new Date().toISOString()
    writeJson(vocabKey(lang), items)
    fireDirty('vocab', lang)
    return true
  },

  delete(lang: TargetLang, id: number): boolean {
    migrateLegacyKey('gt-web-vocab', vocabKey(lang))
    const items = readJson<VocabItem[]>(vocabKey(lang), [])
    const next = items.filter(i => i.id !== id)
    if (next.length === items.length) return false
    writeJson(vocabKey(lang), next)
    fireDirty('vocab', lang)
    return true
  },
}

// ---------- Offline deu-rus dictionary (German only) ----------

type DictEntry = { t: string[]; pos?: string }
let dictionaryCache: Record<string, DictEntry> | null = null
let dictionaryLoading: Promise<Record<string, DictEntry>> | null = null

/** The dictionary is a 2.2 MB JSON. It loads as a lazy chunk on the first
 *  German lookup — learners of other languages never download it. */
function dictionary(): Promise<Record<string, DictEntry>> {
  if (dictionaryCache) return Promise.resolve(dictionaryCache)
  dictionaryLoading ??= import('../data/deu-rus.json').then(m => {
    dictionaryCache = m as unknown as Record<string, DictEntry>
    return dictionaryCache
  })
  return dictionaryLoading
}

async function lookupDictEntry(word: string): Promise<DictEntry | null> {
  const dict = await dictionary()
  const normalized = word.trim().toLowerCase()
  if (!normalized) return null
  const direct = dict[normalized]
  if (direct) return direct
  const stripped = normalizeWord(normalized, 'de')
  if (stripped && stripped !== normalized) {
    const alt = dict[stripped]
    if (alt) return alt
  }
  return null
}

/** Port of OfflineDictionary.lookup: first 3 translations + part of speech (de only) */
export async function lookupDictionary(word: string): Promise<{ translations: string[]; pos: string }> {
  const entry = await lookupDictEntry(word)
  if (!entry) return { translations: [], pos: '' }
  return { translations: (entry.t ?? []).slice(0, 3), pos: entry.pos ?? '' }
}

// ---------- Tutor session (scenario progress, per language) ----------

const SESSION_KEY_PREFIX = 'gt-web-session-'

export const tutorSession = {
  get(lang: TargetLang): TutorSession | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY_PREFIX + lang)
      if (raw) return JSON.parse(raw) as TutorSession
    } catch {
      /* corrupt — start fresh */
    }
    return null
  },
  set(lang: TargetLang, session: TutorSession): void {
    try {
      localStorage.setItem(SESSION_KEY_PREFIX + lang, JSON.stringify(session))
    } catch {
      /* private mode */
    }
  },
  reset(lang: TargetLang): void {
    try {
      localStorage.removeItem(SESSION_KEY_PREFIX + lang)
    } catch {
      /* private mode */
    }
  },
}

// ---------- Diary (diary mode: the student's own words about their day) ----------

const DIARY_KEY = 'gt-web-diary'
const DIARY_STATE_KEY_PREFIX = 'gt-web-diary-state-'

function newUid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `d${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Local calendar date (YYYY-MM-DD) — diary days are where the student lives */
export function localDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const diary = {
  append(lang: TargetLang, text: string, translation: string, corrected?: string): DiaryEntry {
    const entries = readJson<DiaryEntry[]>(DIARY_KEY, [])
    const now = new Date().toISOString()
    const entry: DiaryEntry = {
      uid: newUid(),
      lang,
      date: localDate(now),
      text,
      corrected,
      translation,
      created_at: now,
    }
    entries.push(entry)
    writeJson(DIARY_KEY, entries)
    activity.bump()
    fireDirty('diary', lang)
    return entry
  },

  list(lang?: TargetLang): DiaryEntry[] {
    const entries = readJson<DiaryEntry[]>(DIARY_KEY, [])
    return entries
      .filter(e => !lang || e.lang === lang)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  },

  delete(uid: string): boolean {
    const entries = readJson<DiaryEntry[]>(DIARY_KEY, [])
    const next = entries.filter(e => e.uid !== uid)
    if (next.length === entries.length) return false
    writeJson(DIARY_KEY, next)
    const removed = entries.find(e => e.uid === uid)
    if (removed) fireDirty('diary', removed.lang)
    return true
  },

  /** Background auto-refine landed for one entry */
  patchRefined(uid: string, refined: string): void {
    const entries = readJson<DiaryEntry[]>(DIARY_KEY, [])
    const entry = entries.find(e => e.uid === uid)
    if (!entry || !refined) return
    entry.refined = refined
    writeJson(DIARY_KEY, entries)
    fireDirty('diary', entry.lang)
  },

  /** Replace all entries (Drive sync merge) */
  replaceAll(entries: DiaryEntry[]): void {
    writeJson(DIARY_KEY, entries)
    for (const lang of TARGET_LANG_LIST) {
      if (entries.some(e => e.lang === lang)) fireDirty('diary', lang)
    }
  },

  /** Listening-question rotation state (diary mode, per language) */
  state(lang: TargetLang): { qIdx: number } {
    return readJson(DIARY_STATE_KEY_PREFIX + lang, { qIdx: 0 })
  },
  setState(lang: TargetLang, state: { qIdx: number }): void {
    writeJson(DIARY_STATE_KEY_PREFIX + lang, state)
  },
}

// ---------- Diary refined pages (LLM-polished day summaries) ----------

const DIARY_REFINED_KEY = 'gt-web-diary-refined'

/** One polished diary page per (language, date) — the "refined" view */
export interface DiaryRefined {
  lang: TargetLang
  /** YYYY-MM-DD */
  date: string
  /** coherent diary text in the target language */
  text: string
  /** UI-language translation ('' when it could not be produced) */
  translation: string
  updated_at: string
}

export const diaryRefined = {
  get(lang: TargetLang, date: string): DiaryRefined | null {
    const all = readJson<DiaryRefined[]>(DIARY_REFINED_KEY, [])
    return all.find(r => r.lang === lang && r.date === date) ?? null
  },

  save(lang: TargetLang, date: string, text: string, translation: string): void {
    const all = readJson<DiaryRefined[]>(DIARY_REFINED_KEY, [])
    const next = all.filter(r => !(r.lang === lang && r.date === date))
    next.push({ lang, date, text, translation, updated_at: new Date().toISOString() })
    writeJson(DIARY_REFINED_KEY, next)
  },

  /** Drop pages that no longer have raw entries for their date */
  prune(lang: TargetLang, dates: Set<string>): void {
    const all = readJson<DiaryRefined[]>(DIARY_REFINED_KEY, [])
    const next = all.filter(r => r.lang !== lang || dates.has(r.date))
    if (next.length !== all.length) writeJson(DIARY_REFINED_KEY, next)
  },
}

// ---------- Activity calendar (the streak's data, synced as activity.csv) ----------

const ACTIVITY_KEY = 'gt-web-activity'

export const activity = {
  /** one more recorded action today (a chat line, a diary line) */
  bump(n = 1): void {
    const days = readJson<Record<string, number>>(ACTIVITY_KEY, {})
    const key = localDate(new Date().toISOString())
    days[key] = (days[key] ?? 0) + n
    writeJson(ACTIVITY_KEY, days)
    fireDirty('activity', 'de')
  },

  list(): Record<string, number> {
    return readJson<Record<string, number>>(ACTIVITY_KEY, {})
  },

  replaceAll(days: Record<string, number>): void {
    writeJson(ACTIVITY_KEY, days)
    fireDirty('activity', 'de')
  },
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
