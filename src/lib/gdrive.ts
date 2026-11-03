// Google Drive sync for a static GitHub-Pages app: Google Identity Services
// (implicit token flow — no backend, no refresh tokens) + the Drive v3 REST
// API with the narrow drive.file scope: the app sees only the files it
// created itself. Data lives in a "BlaBlaBot" folder as plain JSON files:
// vocab.json, history-<lang>.json, diary.json.

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'BlaBlaBot'

/** The app owner's OAuth client id, baked in at build time
 *  (VITE_GOOGLE_CLIENT_ID in .env) — any visitor can sign in with their
 *  own Google account; drive.file scopes everything to THEIR Drive. */
export const BUILT_IN_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const TOKEN_KEY = 'gt-gdrive-token'

interface GisTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GisTokenClient {
  requestAccessToken: (opts: { prompt: string }) => void
}

interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        callback: (resp: GisTokenResponse) => void
        error_callback?: (err: { type: string; message?: string }) => void
      }) => GisTokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleGlobal
  }
}

export class GDriveError extends Error {}

/** Load the GIS client once, only when a sync is actually requested */
let gisPromise: Promise<GoogleGlobal> | null = null
function loadGis(): Promise<GoogleGlobal> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google)
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve(window.google)
      else reject(new GDriveError('Google Identity Services failed to initialize'))
    }
    script.onerror = () => {
      gisPromise = null
      reject(new GDriveError('Could not load the Google sign-in script — check the network'))
    }
    document.head.appendChild(script)
  })
  return gisPromise
}

// ---------- Token store (sessionStorage — short-lived by design) ----------

interface TokenRecord {
  token: string
  expiresAt: number
}

let cachedToken: TokenRecord | null = null

function readStoredToken(): TokenRecord | null {
  if (cachedToken) return cachedToken
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (raw) cachedToken = JSON.parse(raw) as TokenRecord
  } catch {
    /* corrupt — start fresh */
  }
  return cachedToken
}

function clearToken(): void {
  cachedToken = null
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private mode */
  }
}

function authHeaders(): Record<string, string> {
  const rec = readStoredToken()
  if (!rec || rec.expiresAt <= Date.now() + 30_000) throw new GDriveError('not-authenticated')
  return { Authorization: `Bearer ${rec.token}` }
}

export function hasValidToken(): boolean {
  const rec = readStoredToken()
  return Boolean(rec && rec.expiresAt > Date.now() + 30_000)
}

/** Ask Google for an access token (popup; silent renewal when a Google
 *  session is already active). Resolves with the token record. */
export async function requestToken(clientId: string, interactive: boolean): Promise<TokenRecord> {
  const google = await loadGis()
  return new Promise<TokenRecord>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: resp => {
        if (resp.error || !resp.access_token) {
          clearToken()
          reject(new GDriveError(resp.error_description || resp.error || 'sign-in failed'))
          return
        }
        const rec: TokenRecord = {
          token: resp.access_token,
          expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
        }
        cachedToken = rec
        try {
          sessionStorage.setItem(TOKEN_KEY, JSON.stringify(rec))
        } catch {
          /* private mode — keep in memory */
        }
        resolve(rec)
      },
      error_callback: err => {
        clearToken()
        reject(
          new GDriveError(
            err.type === 'popup_closed' || err.type === 'popup_failed_to_open'
              ? 'popup-closed'
              : err.message || err.type,
          ),
        )
      },
    })
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' })
  })
}

export function signOut(): void {
  folderId = null
  fileIds = null
  const rec = readStoredToken()
  if (rec) {
    try {
      window.google?.accounts.oauth2.revoke(rec.token, () => undefined)
    } catch {
      /* token already gone */
    }
  }
  clearToken()
}

// ---------- Drive v3 REST (drive.file scope) ----------

interface DriveFile {
  id: string
  name: string
  modifiedTime?: string
}

async function driveFetch(url: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } })
  } catch (err) {
    throw new GDriveError(err instanceof Error ? err.message : String(err))
  }
  if (res.status === 401) {
    clearToken()
    throw new GDriveError('not-authenticated')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GDriveError(`Drive error ${res.status}: ${text.slice(0, 160)}`)
  }
  return res
}

let folderId: string | null = null

async function ensureFolder(): Promise<string> {
  if (folderId) return folderId
  const q = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and name = '${FOLDER_NAME}' and trashed = false`,
  )
  const list = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`,
  )
  const found = (await list.json()) as { files?: DriveFile[] }
  if (found.files && found.files.length > 0) {
    folderId = found.files[0].id
    return folderId
  }
  const created = await driveFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })
  const file = (await created.json()) as DriveFile
  folderId = file.id
  return folderId
}

/** name -> file id for everything in the app folder, fetched in ONE list
 *  call and cached: every load/save then resolves locally (the map also
 *  makes legacy-file checks free — absent names cost zero requests) */
let fileIds: Map<string, string> | null = null

async function folderFileIds(): Promise<Map<string, string>> {
  if (fileIds) return fileIds
  const parent = await ensureFolder()
  const q = encodeURIComponent(`'${parent}' in parents and trashed = false`)
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=200`,
  )
  const data = (await res.json()) as { files?: DriveFile[] }
  fileIds = new Map((data.files ?? []).map(f => [f.name, f.id]))
  return fileIds
}

async function findDataFile(name: string): Promise<DriveFile | null> {
  const map = await folderFileIds()
  const id = map.get(name)
  return id ? { id, name } : null
}

/** Download a JSON file; null when it does not exist yet (legacy pulls) */
export async function loadJson<T>(name: string): Promise<T | null> {
  const file = await findDataFile(name)
  if (!file) return null
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)
  return (await res.json()) as T
}

/** Download a text file; null when it does not exist yet */
export async function loadText(name: string): Promise<string | null> {
  const file = await findDataFile(name)
  if (!file) return null
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)
  return await res.text()
}

/** Create or overwrite a text file (csv / markdown) in the app folder */
export async function saveText(name: string, text: string, mimeType: string): Promise<void> {
  const parent = await ensureFolder()
  const existing = await findDataFile(name)
  if (existing) {
    await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media`,
      { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: text },
    )
    return
  }
  const form = new FormData()
  form.append(
    'metadata',
    new Blob([JSON.stringify({ name, parents: [parent] })], { type: 'application/json' }),
  )
  form.append('file', new Blob([text], { type: mimeType }))
  const created = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    body: form,
  })
  const file = (await created.json()) as DriveFile
  fileIds?.set(name, file.id)
}

/** The signed-in user's email (Drive-scoped about endpoint) */
export async function userEmail(): Promise<string> {
  const res = await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user')
  const data = (await res.json()) as { user?: { emailAddress?: string } }
  return data.user?.emailAddress ?? ''
}

// ---------- File names ----------

/** chat-{lang}.md — one readable transcript per language */
export function historyFileName(lang: string): string {
  return `chat-${lang}.md`
}
export const VOCAB_FILE = 'cards.csv'
export const DIARY_FILE = 'diary.md'
export const ACTIVITY_FILE = 'activity.csv'
/** the pre-csv/md sync files, still read once during a pull */
export const LEGACY_VOCAB_FILE = 'vocab.json'
export const LEGACY_DIARY_FILE = 'diary.json'
export function legacyHistoryFileName(lang: string): string {
  return `history-${lang}.json`
}
