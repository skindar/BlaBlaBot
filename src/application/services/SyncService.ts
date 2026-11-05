// Drive sync orchestration: sign-in state (observable), the pull→merge→push
// cycle, and debounced auto-push of dirty data kinds. Repositories publish
// change events; this service turns them into Drive uploads when the user is
// signed in and auto-sync is on.

import type {
  ActivityRepository,
  ConversationRepository,
  DiaryRepository,
  DrivePort,
  EventBusPort,
  SyncPort,
  SyncStatus,
  VocabularyRepository,
} from '../ports'
import type { ConversationEntry, DiaryEntry, TargetLang, VocabItem } from '../../domain/models'
import { TARGET_LANG_LIST } from '../../domain/policies/languages'
import {
  activityFromCsv,
  activityToCsv,
  diaryFromMd,
  diaryToMd,
  historyFromMd,
  historyToMd,
  vocabFromCsv,
  vocabToCsv,
} from '../../domain/policies/driveFormats'
import { ACTIVITY_FILE, DIARY_FILE, VOCAB_FILE, historyFileName } from './syncFiles'

type Listener = (s: SyncStatus) => void

/** Union by uid; per-item last-write-wins on updatedAt. */
export function mergeVocab(local: VocabItem[], remote: VocabItem[]): VocabItem[] {
  const byUid = new Map<string, VocabItem>()
  for (const item of remote) byUid.set(item.uid, item)
  for (const item of local) {
    const r = byUid.get(item.uid)
    if (!r || (item.updatedAt ?? '') > (r.updatedAt ?? '')) byUid.set(item.uid, item)
  }
  return [...byUid.values()]
}

/** Union by uid, newest first. */
export function mergeDiary(local: DiaryEntry[], remote: DiaryEntry[]): DiaryEntry[] {
  const byUid = new Map<string, DiaryEntry>()
  for (const e of [...local, ...remote]) byUid.set(e.uid, e)
  return [...byUid.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

/** The newer tail wins: chats are continued on one device at a time. */
export function mergeHistory(local: ConversationEntry[], remote: ConversationEntry[]): ConversationEntry[] {
  if (remote.length === 0) return local
  if (local.length === 0) return remote
  const lt = local[local.length - 1]?.createdAt ?? ''
  const rt = remote[remote.length - 1]?.createdAt ?? ''
  return rt > lt ? remote : local
}

/** Per date: the richer side wins — counts never double on merges. */
export function mergeActivity(
  local: Record<string, number>,
  remote: Record<string, number>,
): Record<string, number> {
  const out = { ...remote }
  for (const [date, n] of Object.entries(local)) {
    out[date] = Math.max(out[date] ?? 0, n)
  }
  return out
}

const PUSH_DEBOUNCE_MS = 2500

export class SyncService implements SyncPort {
  private readonly listeners = new Set<Listener>()
  private state: SyncStatus = {
    signedIn: false,
    email: '',
    lastSyncMs: null,
    syncing: false,
    error: '',
  }
  private autoSync = true
  private pulled = new Map<string, string | null>()
  private pending = new Map<string, { kind: 'vocab' | 'history' | 'diary' | 'activity'; lang: TargetLang }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private unsubscribeBus: (() => void) | null = null

  constructor(
    private readonly drive: DrivePort,
    private readonly conversation: ConversationRepository,
    private readonly vocab: VocabularyRepository,
    private readonly diary: DiaryRepository,
    private readonly activity: ActivityRepository,
    private readonly bus: EventBusPort,
  ) {}

  /** Wire repository change events to the debounced auto-push. */
  start(): void {
    this.unsubscribeBus?.()
    this.unsubscribeBus = this.bus.subscribe(change => this.schedulePush(change.kind, change.lang))
    // A token from the previous tab session: renew it silently and pull.
    if (this.drive.signedIn()) void this.resume()
  }

  dispose(): void {
    this.unsubscribeBus?.()
    this.unsubscribeBus = null
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  status(): SyncStatus {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private update(patch: Partial<SyncStatus>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) {
      try {
        fn(this.state)
      } catch {
        /* a UI listener error must not break the sync */
      }
    }
  }

  configure(opts: { autoSync: boolean }): void {
    this.autoSync = opts.autoSync
    if (!this.drive.signedIn() && this.state.signedIn) {
      this.doSignOut()
    }
    if (this.drive.signedIn() && !this.state.signedIn) {
      void this.resume()
    }
  }

  async signIn(): Promise<void> {
    this.update({ syncing: true, error: '' })
    try {
      await this.drive.requestToken(!this.drive.signedIn())
      const email = await this.drive.email().catch(() => '')
      this.update({ signedIn: true, email })
      await this.pullAll()
      this.update({ lastSyncMs: Date.now() })
    } catch (err) {
      this.update({ error: err instanceof Error ? err.message : String(err) })
      throw err
    } finally {
      this.update({ syncing: false })
    }
  }

  private async resume(): Promise<void> {
    this.update({ syncing: true, error: '' })
    try {
      await this.drive.requestToken(false)
      const email = await this.drive.email().catch(() => '')
      this.update({ signedIn: true, email })
      await this.pullAll()
      this.update({ lastSyncMs: Date.now() })
    } catch {
      // silent renew failed (Google session expired) — the user signs in again
      this.update({ signedIn: false, email: '' })
    } finally {
      this.update({ syncing: false })
    }
  }

  signOut(): void {
    this.doSignOut()
  }

  private doSignOut(): void {
    this.drive.signOut()
    this.pulled.clear()
    this.update({ signedIn: false, email: '', lastSyncMs: null, error: '' })
  }

  private async pullFile(name: string): Promise<string | null> {
    const text = await this.drive.loadText(name)
    this.pulled.set(name, text)
    return text
  }

  /** Upload only when the content actually differs from what Drive holds;
   *  a fresh install with no data creates no files at all. */
  private async pushIfChanged(name: string, mime: string, text: string, hasData: boolean): Promise<void> {
    const remote = this.pulled.get(name) ?? null
    if (!hasData && remote === null) return
    if (text === remote) return
    await this.drive.saveText(name, text, mime)
    this.pulled.set(name, text)
  }

  private async pullAll(): Promise<void> {
    const historyTasks = TARGET_LANG_LIST.map(async lang => {
      const remoteText = await this.pullFile(historyFileName(lang))
      if (remoteText !== null && remoteText.trim() !== '') {
        this.conversation.replace(lang, mergeHistory(this.conversation.load(lang), historyFromMd(remoteText)))
      }
    })
    const vocabTask = (async () => {
      const remote = await this.pullFile(VOCAB_FILE)
      const items = remote !== null && remote.trim() !== '' ? vocabFromCsv(remote) : []
      if (items.length === 0) return
      const merged = mergeVocab(this.vocab.all(), items)
      for (const lang of TARGET_LANG_LIST) {
        this.vocab.replace(
          lang,
          merged.filter(i => i.lang === lang),
        )
      }
    })()
    const diaryTask = (async () => {
      const remote = await this.pullFile(DIARY_FILE)
      const entries = remote !== null && remote.trim() !== '' ? diaryFromMd(remote) : []
      if (entries.length === 0) return
      this.diary.replaceAll(mergeDiary(this.diary.list(), entries))
    })()
    const activityTask = (async () => {
      const remote = await this.pullFile(ACTIVITY_FILE)
      if (remote !== null && remote.trim() !== '') {
        this.activity.replaceAll(mergeActivity(this.activity.list(), activityFromCsv(remote)))
      }
    })()

    await Promise.all([vocabTask, diaryTask, activityTask, ...historyTasks])

    // normalize Drive to the merged state — unchanged files stay untouched
    const lang = TARGET_LANG_LIST[0]
    await this.pushKind('vocab', lang)
    await this.pushKind('diary', lang)
    await this.pushKind('activity', lang)
    for (const l of TARGET_LANG_LIST) await this.pushKind('history', l)
  }

  private async pushKind(kind: 'vocab' | 'history' | 'diary' | 'activity', lang: TargetLang): Promise<void> {
    if (kind === 'vocab') {
      const items = this.vocab.all()
      await this.pushIfChanged(VOCAB_FILE, 'text/csv', vocabToCsv(items), items.length > 0)
    } else if (kind === 'history') {
      const messages = this.conversation.load(lang)
      await this.pushIfChanged(
        historyFileName(lang),
        'text/markdown',
        historyToMd(lang, messages),
        messages.length > 0,
      )
    } else if (kind === 'activity') {
      const days = this.activity.list()
      await this.pushIfChanged(ACTIVITY_FILE, 'text/csv', activityToCsv(days), Object.keys(days).length > 0)
    } else {
      const entries = this.diary.list()
      await this.pushIfChanged(DIARY_FILE, 'text/markdown', diaryToMd(entries), entries.length > 0)
    }
  }

  private schedulePush(kind: 'vocab' | 'history' | 'diary' | 'activity', lang: TargetLang): void {
    if (!this.state.signedIn || !this.autoSync) return
    this.pending.set(`${kind}:${kind === 'diary' ? '*' : lang}`, { kind, lang })
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, PUSH_DEBOUNCE_MS)
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending.values()]
    this.pending.clear()
    if (batch.length === 0) return
    this.update({ syncing: true })
    try {
      for (const { kind, lang } of batch) await this.pushKind(kind, lang)
      this.update({ lastSyncMs: Date.now(), error: '' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'not-authenticated') {
        this.update({ error: '', signedIn: false, email: '' })
      } else {
        this.update({ error: msg })
      }
    } finally {
      this.update({ syncing: false })
    }
  }

  async syncNow(): Promise<void> {
    if (!this.state.signedIn) return
    this.update({ syncing: true })
    try {
      await this.pullAll()
      this.update({ lastSyncMs: Date.now(), error: '' })
    } catch (err) {
      this.update({ error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.update({ syncing: false })
    }
  }
}
