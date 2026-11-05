// localStorage-backed repositories. This module is the only place that knows
// the persistence format; the rest of the app deals in domain entities.
//
// Storage schema (v2, deliberately not compatible with the old web/ app):
//   blablabot2:settings
//   blablabot2:seq
//   blablabot2:messages:<lang>
//   blablabot2:vocab:<lang>
//   blablabot2:diary
//   blablabot2:diary:state:<lang>
//   blablabot2:diary:pages
//   blablabot2:session:<lang>
//   blablabot2:activity
//   blablabot2:onboarded

import type {
  AchievementsRepository,
  ActivityRepository,
  ClockPort,
  ConversationRepository,
  DiaryRepository,
  EventBusPort,
  IdPort,
  KeyValueStore,
  OnboardingRepository,
  SessionRepository,
  SettingsRepository,
  VocabularyRepository,
} from '../../application/ports'
import type {
  ChatSummary,
  ConversationEntry,
  Correction,
  DiaryEntry,
  DiaryPage,
  LlmMessage,
  Settings,
  TargetLang,
  VocabItem,
} from '../../domain/models'
import type { TutorSession } from '../../domain/policies/scenarios'
import { wordsMatch } from '../../domain/policies/words'

export { normalizeWord, wordsMatch } from '../../domain/policies/words'

const PREFIX = 'blablabot2:'
export const STORAGE_KEYS = {
  settings: `${PREFIX}settings`,
  seq: `${PREFIX}seq`,
  messages: (lang: TargetLang) => `${PREFIX}messages:${lang}`,
  vocab: (lang: TargetLang) => `${PREFIX}vocab:${lang}`,
  diary: `${PREFIX}diary`,
  diaryState: (lang: TargetLang) => `${PREFIX}diary:state:${lang}`,
  diaryPages: `${PREFIX}diary:pages`,
  session: (lang: TargetLang) => `${PREFIX}session:${lang}`,
  archives: `${PREFIX}archives`,
  activity: `${PREFIX}activity`,
  achievements: `${PREFIX}achievements`,
  onboarded: `${PREFIX}onboarded`,
} as const

const HISTORY_MESSAGES_FOR_LLM = 10
const HISTORY_REPLY_LIMIT = 50

export class LocalStorageKeyValue implements KeyValueStore {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* private mode / quota: the app keeps working in memory-less mode */
    }
  }
  remove(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}

export class MemoryKeyValue implements KeyValueStore {
  private readonly map = new Map<string, string>()
  get(key: string): string | null {
    return this.map.get(key) ?? null
  }
  set(key: string, value: string): void {
    this.map.set(key, value)
  }
  remove(key: string): void {
    this.map.delete(key)
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.map)
  }
}

export class SystemClock implements ClockPort {
  nowIso(): string {
    return new Date().toISOString()
  }
  nowMs(): number {
    return Date.now()
  }
}

/** One monotonically increasing id namespace, persisted across reloads. */
export class SequentialIdSource implements IdPort {
  constructor(
    private readonly store: KeyValueStore,
    private readonly clock: ClockPort,
  ) {}

  nextId(): number {
    const current = Number(this.store.get(STORAGE_KEYS.seq) ?? '0')
    const next = (Number.isFinite(current) ? current : 0) + 1
    this.store.set(STORAGE_KEYS.seq, String(next))
    return next
  }

  uuid(): string {
    const cryptoApi = globalThis.crypto
    if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
    return `id-${this.clock.nowMs()}-${Math.random().toString(36).slice(2)}`
  }
}

function readJson<T>(store: KeyValueStore, key: string, fallback: T): T {
  try {
    const raw = store.get(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(store: KeyValueStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value))
}

// ---------- settings ----------

export class LocalSettingsRepository implements SettingsRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly defaults: () => Settings,
  ) {}

  load(): Settings {
    const raw = readJson<Partial<Settings> | null>(this.store, STORAGE_KEYS.settings, null)
    if (!raw) return this.defaults()
    return { ...this.defaults(), ...raw }
  }

  save(settings: Settings): void {
    writeJson(this.store, STORAGE_KEYS.settings, settings)
  }
}

// ---------- conversation ----------

/** Archived chat record; entries are the same shape as the active dialog. */
interface ArchivedChat {
  id: string
  lang: TargetLang
  title: string
  createdAt: string
  updatedAt: string
  entries: ConversationEntry[]
}

function chatTitle(entries: ConversationEntry[]): string {
  const first = entries.find(e => e.role === 'user')?.text ?? ''
  return first.replace(/\s+/g, ' ').trim().slice(0, 70)
}

export class LocalConversationRepository implements ConversationRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly bus: EventBusPort,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  private read(lang: TargetLang): ConversationEntry[] {
    return readJson<ConversationEntry[]>(this.store, STORAGE_KEYS.messages(lang), [])
  }

  addUser(lang: TargetLang, text: string, translation: string): void {
    const entries = this.read(lang)
    entries.push({
      id: this.ids.nextId(),
      role: 'user',
      text,
      userTranslation: translation,
      corrections: [],
      translation: '',
      followUp: '',
      createdAt: this.clock.nowIso(),
    })
    writeJson(this.store, STORAGE_KEYS.messages(lang), entries)
    this.bus.publish({ kind: 'history', lang })
  }

  addTutor(
    lang: TargetLang,
    text: string,
    corrections: Correction[],
    translation: string,
    followUp: string,
  ): void {
    const entries = this.read(lang)
    entries.push({
      id: this.ids.nextId(),
      role: 'tutor',
      text,
      userTranslation: '',
      corrections,
      translation,
      followUp,
      createdAt: this.clock.nowIso(),
    })
    writeJson(this.store, STORAGE_KEYS.messages(lang), entries)
    this.bus.publish({ kind: 'history', lang })
  }

  historyForLlm(lang: TargetLang, limit = HISTORY_MESSAGES_FOR_LLM): LlmMessage[] {
    return this.read(lang)
      .slice(-limit)
      .map(m => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.role === 'tutor' && m.followUp ? `${m.text} ${m.followUp}` : m.text,
      }))
  }

  recent(lang: TargetLang, limit = HISTORY_REPLY_LIMIT): ConversationEntry[] {
    return this.read(lang).slice(-limit)
  }

  /** Start a new chat. The previous one is archived, never deleted. */
  reset(lang: TargetLang): void {
    this.archiveCurrent(lang)
    writeJson(this.store, STORAGE_KEYS.messages(lang), [])
    this.bus.publish({ kind: 'history', lang })
  }

  load(lang: TargetLang): ConversationEntry[] {
    return this.read(lang)
  }

  replace(lang: TargetLang, entries: ConversationEntry[]): void {
    writeJson(this.store, STORAGE_KEYS.messages(lang), entries)
    this.bus.publish({ kind: 'history', lang })
  }

  private readArchives(): ArchivedChat[] {
    return readJson<ArchivedChat[]>(this.store, STORAGE_KEYS.archives, [])
  }

  private writeArchives(archives: ArchivedChat[]): void {
    writeJson(this.store, STORAGE_KEYS.archives, archives)
  }

  /** Move the open dialog into the archive (no-op when it is empty). */
  private archiveCurrent(lang: TargetLang): boolean {
    const entries = this.read(lang)
    if (entries.length === 0) return false
    const archives = this.readArchives()
    archives.push({
      id: this.ids.uuid(),
      lang,
      title: chatTitle(entries),
      createdAt: entries[0].createdAt,
      updatedAt: entries[entries.length - 1].createdAt,
      entries,
    })
    this.writeArchives(archives)
    return true
  }

  currentChat(lang: TargetLang): ChatSummary {
    const entries = this.read(lang)
    return {
      id: 'current',
      lang,
      title: chatTitle(entries),
      createdAt: entries[0]?.createdAt ?? this.clock.nowIso(),
      updatedAt: entries[entries.length - 1]?.createdAt ?? this.clock.nowIso(),
      messageCount: entries.length,
      active: true,
    }
  }

  archives(lang: TargetLang): ChatSummary[] {
    return this.readArchives()
      .filter(a => a.lang === lang)
      .map(a => ({
        id: a.id,
        lang: a.lang,
        title: a.title,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        messageCount: a.entries.length,
        active: false,
      }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  openArchive(id: string): boolean {
    const archives = this.readArchives()
    const target = archives.find(a => a.id === id)
    if (!target) return false
    // Preserve the dialog that is currently open before switching.
    this.archiveCurrent(target.lang)
    const remaining = this.readArchives().filter(a => a.id !== id)
    this.writeArchives(remaining)
    writeJson(this.store, STORAGE_KEYS.messages(target.lang), target.entries)
    this.bus.publish({ kind: 'history', lang: target.lang })
    return true
  }

  deleteChat(id: string, lang: TargetLang): boolean {
    if (id === 'current') {
      writeJson(this.store, STORAGE_KEYS.messages(lang), [])
      this.bus.publish({ kind: 'history', lang })
      return true
    }
    return this.deleteArchive(id)
  }

  deleteArchive(id: string): boolean {
    const archives = this.readArchives()
    const target = archives.find(a => a.id === id)
    if (!target) return false
    this.writeArchives(archives.filter(a => a.id !== id))
    this.bus.publish({ kind: 'history', lang: target.lang })
    return true
  }
}

// ---------- vocabulary ----------

export class LocalVocabularyRepository implements VocabularyRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly bus: EventBusPort,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  private read(lang: TargetLang): VocabItem[] {
    return readJson<VocabItem[]>(this.store, STORAGE_KEYS.vocab(lang), [])
  }

  private write(lang: TargetLang, items: VocabItem[]): void {
    writeJson(this.store, STORAGE_KEYS.vocab(lang), items)
    this.bus.publish({ kind: 'vocab', lang })
  }

  list(lang: TargetLang): VocabItem[] {
    // unknown first, newest on top within a group
    return [...this.read(lang)].sort((a, b) => Number(a.known) - Number(b.known) || b.id - a.id)
  }

  all(): VocabItem[] {
    const langs: TargetLang[] = ['de', 'en', 'fr', 'es', 'pt', 'ru']
    const out: VocabItem[] = []
    for (const lang of langs) out.push(...this.read(lang))
    return out
  }

  find(lang: TargetLang, word: string): VocabItem | null {
    return this.read(lang).find(i => wordsMatch(i.word, word, lang)) ?? null
  }

  add(input: {
    lang: TargetLang
    word: string
    translation: string
    partOfSpeech: string
    example: string
    exampleTranslation: string
  }): { item: VocabItem; existed: boolean } {
    const items = this.read(input.lang)
    const existing = items.find(i => wordsMatch(i.word, input.word, input.lang))
    if (existing) return { item: existing, existed: true }
    const now = this.clock.nowIso()
    const item: VocabItem = {
      id: this.ids.nextId(),
      uid: this.ids.uuid(),
      word: input.word,
      translation: input.translation,
      partOfSpeech: input.partOfSpeech,
      example: input.example,
      exampleTranslation: input.exampleTranslation,
      known: false,
      createdAt: now,
      updatedAt: now,
      lang: input.lang,
    }
    items.push(item)
    this.write(input.lang, items)
    return { item, existed: false }
  }

  setKnown(lang: TargetLang, id: number, known: boolean): boolean {
    const items = this.read(lang)
    const item = items.find(i => i.id === id)
    if (!item) return false
    item.known = known
    item.updatedAt = this.clock.nowIso()
    this.write(lang, items)
    return true
  }

  remove(lang: TargetLang, id: number): boolean {
    const items = this.read(lang)
    const next = items.filter(i => i.id !== id)
    if (next.length === items.length) return false
    this.write(lang, next)
    return true
  }

  replace(lang: TargetLang, items: VocabItem[]): void {
    this.write(
      lang,
      items.filter(i => i.lang === lang).map(({ ...rest }) => rest),
    )
  }
}

// ---------- diary ----------

/** Local calendar date (YYYY-MM-DD) — diary days are where the student lives */
export function localDate(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export class LocalDiaryRepository implements DiaryRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly bus: EventBusPort,
    private readonly clock: ClockPort,
    private readonly ids: IdPort,
  ) {}

  private read(): DiaryEntry[] {
    return readJson<DiaryEntry[]>(this.store, STORAGE_KEYS.diary, [])
  }

  private write(entries: DiaryEntry[]): void {
    writeJson(this.store, STORAGE_KEYS.diary, entries)
  }

  append(input: { lang: TargetLang; text: string; translation: string; corrected?: string }): DiaryEntry {
    const entries = this.read()
    const now = this.clock.nowIso()
    const entry: DiaryEntry = {
      uid: this.ids.uuid(),
      lang: input.lang,
      date: localDate(now),
      text: input.text,
      corrected: input.corrected,
      translation: input.translation,
      createdAt: now,
    }
    entries.push(entry)
    this.write(entries)
    this.bus.publish({ kind: 'diary', lang: input.lang })
    return entry
  }

  list(lang?: TargetLang): DiaryEntry[] {
    return this.read()
      .filter(e => !lang || e.lang === lang)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  remove(uid: string): boolean {
    const entries = this.read()
    const next = entries.filter(e => e.uid !== uid)
    if (next.length === entries.length) return false
    const removed = entries.find(e => e.uid === uid)
    this.write(next)
    if (removed) this.bus.publish({ kind: 'diary', lang: removed.lang })
    return true
  }

  replaceAll(entries: DiaryEntry[]): void {
    this.write(entries)
    const langs = new Set(entries.map(e => e.lang))
    for (const lang of langs) this.bus.publish({ kind: 'diary', lang })
  }

  state(lang: TargetLang): { qIdx: number } {
    return readJson(this.store, STORAGE_KEYS.diaryState(lang), { qIdx: 0 })
  }

  setState(lang: TargetLang, state: { qIdx: number }): void {
    writeJson(this.store, STORAGE_KEYS.diaryState(lang), state)
  }

  page(lang: TargetLang, date: string): DiaryPage | null {
    const all = readJson<DiaryPage[]>(this.store, STORAGE_KEYS.diaryPages, [])
    return all.find(r => r.lang === lang && r.date === date) ?? null
  }

  savePage(page: DiaryPage): void {
    const all = readJson<DiaryPage[]>(this.store, STORAGE_KEYS.diaryPages, [])
    const next = all.filter(r => !(r.lang === page.lang && r.date === page.date))
    next.push(page)
    writeJson(this.store, STORAGE_KEYS.diaryPages, next)
    this.bus.publish({ kind: 'diary', lang: page.lang })
  }

  prunePages(lang: TargetLang, dates: Set<string>): void {
    const all = readJson<DiaryPage[]>(this.store, STORAGE_KEYS.diaryPages, [])
    const next = all.filter(r => r.lang !== lang || dates.has(r.date))
    if (next.length !== all.length) writeJson(this.store, STORAGE_KEYS.diaryPages, next)
  }
}

// ---------- tutor session ----------

export class LocalSessionRepository implements SessionRepository {
  constructor(private readonly store: KeyValueStore) {}

  get(lang: TargetLang): TutorSession | null {
    try {
      const raw = this.store.get(STORAGE_KEYS.session(lang))
      return raw ? (JSON.parse(raw) as TutorSession) : null
    } catch {
      return null
    }
  }

  set(lang: TargetLang, session: TutorSession): void {
    writeJson(this.store, STORAGE_KEYS.session(lang), session)
  }

  reset(lang: TargetLang): void {
    this.store.remove(STORAGE_KEYS.session(lang))
  }
}

// ---------- activity ----------

export class LocalAchievementsRepository implements AchievementsRepository {
  constructor(private readonly store: KeyValueStore) {}

  list(): Record<string, string> {
    return readJson<Record<string, string>>(this.store, STORAGE_KEYS.achievements, {})
  }

  unlock(id: string, dateKey: string): void {
    const days = this.list()
    if (days[id]) return
    days[id] = dateKey
    writeJson(this.store, STORAGE_KEYS.achievements, days)
  }

  replaceAll(dates: Record<string, string>): void {
    writeJson(this.store, STORAGE_KEYS.achievements, dates)
  }
}

export class LocalActivityRepository implements ActivityRepository {
  constructor(
    private readonly store: KeyValueStore,
    private readonly bus: EventBusPort,
    private readonly clock: ClockPort,
  ) {}

  private read(): Record<string, number> {
    return readJson<Record<string, number>>(this.store, STORAGE_KEYS.activity, {})
  }

  private write(days: Record<string, number>): void {
    writeJson(this.store, STORAGE_KEYS.activity, days)
    this.bus.publish({ kind: 'activity', lang: 'de' })
  }

  bump(n = 1): void {
    const days = this.read()
    const key = localDate(this.clock.nowIso())
    days[key] = (days[key] ?? 0) + n
    this.write(days)
  }

  list(): Record<string, number> {
    return this.read()
  }

  replaceAll(days: Record<string, number>): void {
    this.write(days)
  }
}

// ---------- onboarding ----------

export class LocalOnboardingRepository implements OnboardingRepository {
  constructor(private readonly store: KeyValueStore) {}
  done(): boolean {
    return this.store.get(STORAGE_KEYS.onboarded) === '1'
  }
  complete(): void {
    this.store.set(STORAGE_KEYS.onboarded, '1')
  }
}
