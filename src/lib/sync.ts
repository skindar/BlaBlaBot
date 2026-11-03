// Drive sync orchestration: login state (React-friendly pub/sub), the
// pull→merge→push cycle on login, and debounced auto-push of dirty data
// kinds (vocab / history / diary). The store fires change events; this
// module turns them into Drive uploads when the user is signed in and
// auto-sync is on.

import {
  ACTIVITY_FILE,
  DIARY_FILE,
  BUILT_IN_CLIENT_ID,
  GDriveError,
  LEGACY_DIARY_FILE,
  LEGACY_VOCAB_FILE,
  VOCAB_FILE,
  hasValidToken,
  historyFileName,
  legacyHistoryFileName,
  loadJson,
  loadText,
  requestToken,
  saveText,
  signOut,
  userEmail,
} from './gdrive'
import {
  activity,
  conversation,
  diary,
  setStoreDirtyHandler,
  vocab,
  type DirtyKind,
  type StoredMessage,
} from './store'
import {
  activityFromCsv,
  activityToCsv,
  diaryFromMd,
  diaryToMd,
  historyFromMd,
  historyToMd,
  vocabFromCsv,
  vocabToCsv,
} from './driveFormats'
import { TARGET_LANG_LIST, type TargetLang } from './langs'
import type { DiaryEntry, VocabItem } from '../types'

export interface SyncStatus {
  signedIn: boolean
  email: string | null
  /** wall clock of the last successful push/pull */
  lastSyncAt: number | null
  syncing: boolean
  error: string | null
}

type Listener = (s: SyncStatus) => void

const listeners = new Set<Listener>()
let status: SyncStatus = { signedIn: false, email: null, lastSyncAt: null, syncing: false, error: null }
let clientId = ''
let autoSync = true

function update(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch }
  for (const fn of listeners) {
    try {
      fn(status)
    } catch {
      /* a UI listener error must not break the sync */
    }
  }
}

export function subscribeSync(fn: Listener): () => void {
  listeners.add(fn)
  fn(status)
  return () => {
    listeners.delete(fn)
  }
}

export function getSyncStatus(): SyncStatus {
  return status
}

/** Called by the App on mount and when the settings change.
 *  The client id comes exclusively from the build (VITE_GOOGLE_CLIENT_ID). */
export function configureSync(opts: { autoSync: boolean }): void {
  clientId = BUILT_IN_CLIENT_ID.trim()
  autoSync = opts.autoSync
  if (hasValidToken() && !status.signedIn) {
    void resumeSession()
  }
  if (!clientId && status.signedIn) {
    doSignOut()
  }
}

// ---------- Sign in / out ----------

export async function signIn(): Promise<void> {
  if (!clientId) throw new GDriveError('client-id-missing')
  update({ syncing: true, error: null })
  try {
    await requestToken(clientId, !hasValidToken())
    const email = await userEmail().catch(() => '')
    update({ signedIn: true, email: email || null })
    await pullAll()
    update({ lastSyncAt: Date.now() })
  } catch (err) {
    update({ error: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    update({ syncing: false })
  }
}

async function resumeSession(): Promise<void> {
  update({ syncing: true, error: null })
  try {
    await requestToken(clientId, false)
    const email = await userEmail().catch(() => '')
    update({ signedIn: true, email: email || null })
    await pullAll()
    update({ lastSyncAt: Date.now() })
  } catch {
    // silent renew failed (Google session expired) — the user signs in again
    update({ signedIn: false, email: null })
  } finally {
    update({ syncing: false })
  }
}

export function doSignOut(): void {
  signOut()
  update({ signedIn: false, email: null, lastSyncAt: null, error: null })
}

// ---------- Merge strategies ----------

/** Union by uid; per-item last-write-wins on updated_at */
export function mergeVocab(local: VocabItem[], remote: VocabItem[]): VocabItem[] {
  const byUid = new Map<string, VocabItem>()
  for (const item of remote) byUid.set(item.uid, item)
  for (const item of local) {
    const r = byUid.get(item.uid)
    if (!r || (item.updated_at ?? '') > (r.updated_at ?? '')) byUid.set(item.uid, item)
  }
  return [...byUid.values()]
}

/** Union by uid, newest first */
export function mergeDiary(local: DiaryEntry[], remote: DiaryEntry[]): DiaryEntry[] {
  const byUid = new Map<string, DiaryEntry>()
  for (const e of [...local, ...remote]) byUid.set(e.uid, e)
  return [...byUid.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
}

/** The newer tail wins: chats are continued on one device at a time */
export function mergeHistory(local: StoredMessage[], remote: StoredMessage[]): StoredMessage[] {
  if (remote.length === 0) return local
  if (local.length === 0) return remote
  const lt = local[local.length - 1]?.created_at ?? ''
  const rt = remote[remote.length - 1]?.created_at ?? ''
  return rt > lt ? remote : local
}

// ---------- Pull / push ----------

/** Per date: the richer side wins — counts never double on merges */
function mergeActivity(local: Record<string, number>, remote: Record<string, number>): Record<string, number> {
  const out = { ...remote }
  for (const [date, n] of Object.entries(local)) {
    out[date] = Math.max(out[date] ?? 0, n)
  }
  return out
}

async function pullAll(): Promise<void> {
  // vocab — cards.csv (legacy vocab.json still read once)
  let remoteVocab = await loadText(VOCAB_FILE)
  if (remoteVocab !== null && remoteVocab.trim() !== '') {
    const items = vocabFromCsv(remoteVocab)
    if (items.length > 0) {
      const merged = mergeVocab(vocab.allLangs(), items)
      for (const lang of TARGET_LANG_LIST) {
        vocab.replaceAll(lang, merged.filter(i => (i.lang ?? 'de') === lang))
      }
    }
  } else {
    const legacy = await loadJson<{ items: VocabItem[] }>(LEGACY_VOCAB_FILE)
    if (legacy?.items?.length) {
      const merged = mergeVocab(vocab.allLangs(), legacy.items)
      for (const lang of TARGET_LANG_LIST) {
        vocab.replaceAll(lang, merged.filter(i => (i.lang ?? 'de') === lang))
      }
    }
  }
  // history (per language) — chat-{lang}.md (legacy history-{lang}.json)
  for (const lang of TARGET_LANG_LIST) {
    const remoteText = await loadText(historyFileName(lang))
    if (remoteText !== null && remoteText.trim() !== '') {
      const merged = mergeHistory(conversation.loadRaw(lang), historyFromMd(remoteText))
      conversation.replaceRaw(lang, merged)
      continue
    }
    const legacy = await loadJson<{ messages: StoredMessage[] }>(legacyHistoryFileName(lang))
    if (legacy?.messages?.length) {
      conversation.replaceRaw(lang, mergeHistory(conversation.loadRaw(lang), legacy.messages))
    }
  }
  // diary — diary.md (legacy diary.json)
  const remoteDiaryText = await loadText(DIARY_FILE)
  if (remoteDiaryText !== null && remoteDiaryText.trim() !== '') {
    const entries = diaryFromMd(remoteDiaryText)
    if (entries.length > 0) diary.replaceAll(mergeDiary(diary.list(), entries))
  } else {
    const legacy = await loadJson<{ entries: DiaryEntry[] }>(LEGACY_DIARY_FILE)
    if (legacy?.entries?.length) diary.replaceAll(mergeDiary(diary.list(), legacy.entries))
  }
  // activity — activity.csv
  const remoteActivity = await loadText(ACTIVITY_FILE)
  if (remoteActivity !== null && remoteActivity.trim() !== '') {
    activity.replaceAll(mergeActivity(activity.list(), activityFromCsv(remoteActivity)))
  }
  // normalize Drive to the fresh merged state of every kind
  await pushKind('vocab', 'de')
  await pushKind('diary', 'de')
  await pushKind('activity', 'de')
  for (const lang of TARGET_LANG_LIST) await pushKind('history', lang)
}

/** Push one data kind; used by the debounced auto-push and after a pull */
async function pushKind(kind: DirtyKind, lang: TargetLang): Promise<void> {
  if (kind === 'vocab') {
    await saveText(VOCAB_FILE, vocabToCsv(vocab.allLangs()), 'text/csv')
  } else if (kind === 'history') {
    await saveText(
      historyFileName(lang),
      historyToMd(lang, conversation.loadRaw(lang)),
      'text/markdown',
    )
  } else if (kind === 'activity') {
    await saveText(ACTIVITY_FILE, activityToCsv(activity.list()), 'text/csv')
  } else {
    await saveText(DIARY_FILE, diaryToMd(diary.list()), 'text/markdown')
  }
}

// ---------- Auto-push (store events → debounced uploads) ----------

const PUSH_DEBOUNCE_MS = 2500
const pending = new Map<string, { kind: DirtyKind; lang: TargetLang }>()
let timer: number | null = null

export function schedulePush(kind: DirtyKind, lang: TargetLang): void {
  if (!status.signedIn || !autoSync) return
  pending.set(`${kind}:${kind === 'diary' ? '*' : lang}`, { kind, lang })
  if (timer !== null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    void flushPush()
  }, PUSH_DEBOUNCE_MS)
}

async function flushPush(): Promise<void> {
  const batch = [...pending.values()]
  pending.clear()
  if (batch.length === 0) return
  update({ syncing: true })
  try {
    for (const { kind, lang } of batch) {
      await pushKind(kind, lang)
    }
    update({ lastSyncAt: Date.now(), error: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === 'not-authenticated') {
      update({ error: null, signedIn: false, email: null })
    } else {
      update({ error: msg })
    }
  } finally {
    update({ syncing: false })
  }
}

/** Wire the store's change events to the debounced auto-push (App calls once) */
export function initSyncEvents(): void {
  setStoreDirtyHandler((kind, lang) => schedulePush(kind, lang))
}

/** Manual "sync now" button */
export async function syncNow(): Promise<void> {
  if (!status.signedIn) return
  update({ syncing: true })
  try {
    await pullAll()
    update({ lastSyncAt: Date.now(), error: null })
  } catch (err) {
    update({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    update({ syncing: false })
  }
}
