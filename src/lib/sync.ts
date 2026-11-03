// Drive sync orchestration: login state (React-friendly pub/sub), the
// pull→merge→push cycle on login, and debounced auto-push of dirty data
// kinds (vocab / history / diary). The store fires change events; this
// module turns them into Drive uploads when the user is signed in and
// auto-sync is on.

import {
  DIARY_FILE,
  GDriveError,
  VOCAB_FILE,
  hasValidToken,
  historyFileName,
  loadJson,
  requestToken,
  saveJson,
  signOut,
  userEmail,
} from './gdrive'
import {
  conversation,
  diary,
  setStoreDirtyHandler,
  vocab,
  type DirtyKind,
  type StoredMessage,
} from './store'
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

/** Called by the App on mount and when the settings change */
export function configureSync(opts: { clientId: string; autoSync: boolean }): void {
  clientId = opts.clientId.trim()
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

async function pullAll(): Promise<void> {
  // vocab
  const remoteVocab = await loadJson<{ items: VocabItem[] }>(VOCAB_FILE)
  if (remoteVocab?.items?.length) {
    const merged = mergeVocab(vocab.allLangs(), remoteVocab.items)
    for (const lang of TARGET_LANG_LIST) {
      vocab.replaceAll(lang, merged.filter(i => (i.lang ?? 'de') === lang))
    }
  }
  // history (per language)
  for (const lang of TARGET_LANG_LIST) {
    const remoteHistory = await loadJson<{ messages: StoredMessage[] }>(historyFileName(lang))
    if (remoteHistory?.messages?.length) {
      const merged = mergeHistory(conversation.loadRaw(lang), remoteHistory.messages)
      conversation.replaceRaw(lang, merged)
    }
  }
  // diary
  const remoteDiary = await loadJson<{ entries: DiaryEntry[] }>(DIARY_FILE)
  if (remoteDiary?.entries?.length) {
    diary.replaceAll(mergeDiary(diary.list(), remoteDiary.entries))
  }
}

/** Push one data kind; used by the debounced auto-push and after a pull */
async function pushKind(kind: DirtyKind, lang: TargetLang): Promise<void> {
  if (kind === 'vocab') {
    await saveJson(VOCAB_FILE, { kind: 'vocab', items: vocab.allLangs() })
  } else if (kind === 'history') {
    await saveJson(historyFileName(lang), {
      kind: 'history',
      lang,
      messages: conversation.loadRaw(lang),
    })
  } else {
    await saveJson(DIARY_FILE, { kind: 'diary', entries: diary.list() })
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
