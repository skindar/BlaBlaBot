// Google Drive adapter for a static app: Google Identity Services (implicit
// token flow — no backend, no refresh tokens) + the Drive v3 REST API with
// the narrow drive.file scope. Files live in a "BlaBlaBot" folder and are
// human-readable (cards.csv, diary.md, chat-<lang>.md, activity.csv).

import type { DrivePort } from '../../application/ports'
import { DriveError } from '../../application/errors'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER_NAME = 'BlaBlaBot'
const TOKEN_KEY = 'blablabot2:gdrive-token'

/** The app owner's OAuth client id, baked in at build time
 *  (VITE_GOOGLE_CLIENT_ID in .env) — any visitor can sign in with their
 *  own Google account; drive.file scopes everything to THEIR Drive. */
export const BUILT_IN_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

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

interface TokenRecord {
  token: string
  expiresAt: number
}

interface DriveFile {
  id: string
  name: string
  modifiedTime?: string
}

export class GoogleDriveClient implements DrivePort {
  private cachedToken: TokenRecord | null = null
  private gisPromise: Promise<GoogleGlobal> | null = null
  private folderId: string | null = null
  private fileIds: Map<string, string> | null = null

  constructor(
    private readonly clientId: string = BUILT_IN_CLIENT_ID,
    private readonly folderName: string = FOLDER_NAME,
  ) {}

  // ---------- token store (sessionStorage — short-lived by design) ----------

  private readStoredToken(): TokenRecord | null {
    if (this.cachedToken) return this.cachedToken
    try {
      const raw = sessionStorage.getItem(TOKEN_KEY)
      if (raw) this.cachedToken = JSON.parse(raw) as TokenRecord
    } catch {
      /* corrupt — start fresh */
    }
    return this.cachedToken
  }

  private clearToken(): void {
    this.cachedToken = null
    try {
      sessionStorage.removeItem(TOKEN_KEY)
    } catch {
      /* private mode */
    }
  }

  private authHeaders(): Record<string, string> {
    const rec = this.readStoredToken()
    if (!rec || rec.expiresAt <= Date.now() + 30_000) throw new DriveError('not-authenticated')
    return { Authorization: `Bearer ${rec.token}` }
  }

  signedIn(): boolean {
    const rec = this.readStoredToken()
    return Boolean(rec && rec.expiresAt > Date.now() + 30_000)
  }

  // ---------- Google Identity Services ----------

  /** Load the GIS client once, only when a sync is actually requested. */
  private loadGis(): Promise<GoogleGlobal> {
    if (window.google?.accounts?.oauth2) return Promise.resolve(window.google)
    this.gisPromise ??= new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GIS_SRC
      script.async = true
      script.onload = () => {
        if (window.google?.accounts?.oauth2) resolve(window.google)
        else reject(new DriveError('Google Identity Services failed to initialize'))
      }
      script.onerror = () => {
        this.gisPromise = null
        reject(new DriveError('Could not load the Google sign-in script — check the network'))
      }
      document.head.appendChild(script)
    })
    return this.gisPromise
  }

  /** Ask Google for an access token (popup; silent renewal when a Google
   *  session is already active). */
  async requestToken(interactive: boolean): Promise<void> {
    if (!this.clientId) throw new DriveError('google-client-id-missing')
    const google = await this.loadGis()
    return new Promise<void>((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: resp => {
          if (resp.error || !resp.access_token) {
            this.clearToken()
            reject(new DriveError(resp.error_description || resp.error || 'sign-in failed'))
            return
          }
          const rec: TokenRecord = {
            token: resp.access_token,
            expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
          }
          this.cachedToken = rec
          try {
            sessionStorage.setItem(TOKEN_KEY, JSON.stringify(rec))
          } catch {
            /* private mode — keep in memory */
          }
          resolve()
        },
        error_callback: err => {
          this.clearToken()
          reject(
            new DriveError(
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

  signOut(): void {
    this.folderId = null
    this.fileIds = null
    const rec = this.readStoredToken()
    if (rec) {
      try {
        window.google?.accounts.oauth2.revoke(rec.token, () => undefined)
      } catch {
        /* token already gone */
      }
    }
    this.clearToken()
  }

  // ---------- Drive v3 REST (drive.file scope) ----------

  private async driveFetch(url: string, init?: RequestInit): Promise<Response> {
    let res: Response
    try {
      res = await fetch(url, { ...init, headers: { ...this.authHeaders(), ...(init?.headers ?? {}) } })
    } catch (err) {
      throw new DriveError(err instanceof Error ? err.message : String(err))
    }
    if (res.status === 401) {
      this.clearToken()
      throw new DriveError('not-authenticated')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new DriveError(`Drive error ${res.status}: ${text.slice(0, 160)}`)
    }
    return res
  }

  private async ensureFolder(): Promise<string> {
    if (this.folderId) return this.folderId
    const q = encodeURIComponent(
      `mimeType = 'application/vnd.google-apps.folder' and name = '${this.folderName}' and trashed = false`,
    )
    const list = await this.driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`,
    )
    const found = (await list.json()) as { files?: DriveFile[] }
    if (found.files && found.files.length > 0) {
      this.folderId = found.files[0].id
      return this.folderId
    }
    const created = await this.driveFetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: this.folderName, mimeType: 'application/vnd.google-apps.folder' }),
    })
    const file = (await created.json()) as DriveFile
    this.folderId = file.id
    return this.folderId
  }

  /** name -> file id for everything in the app folder, fetched in ONE list
   *  call and cached. */
  private async folderFileIds(): Promise<Map<string, string>> {
    if (this.fileIds) return this.fileIds
    const parent = await this.ensureFolder()
    const q = encodeURIComponent(`'${parent}' in parents and trashed = false`)
    const res = await this.driveFetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=200`,
    )
    const data = (await res.json()) as { files?: DriveFile[] }
    this.fileIds = new Map((data.files ?? []).map(f => [f.name, f.id]))
    return this.fileIds
  }

  private async findFile(name: string): Promise<DriveFile | null> {
    const map = await this.folderFileIds()
    const id = map.get(name)
    return id ? { id, name } : null
  }

  async loadText(name: string): Promise<string | null> {
    const file = await this.findFile(name)
    if (!file) return null
    const res = await this.driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`)
    return await res.text()
  }

  async saveText(name: string, text: string, mimeType: string): Promise<void> {
    const parent = await this.ensureFolder()
    const existing = await this.findFile(name)
    if (existing) {
      await this.driveFetch(
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
    const created = await this.driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      body: form,
    })
    const file = (await created.json()) as DriveFile
    this.fileIds?.set(name, file.id)
  }

  async email(): Promise<string> {
    const res = await this.driveFetch('https://www.googleapis.com/drive/v3/about?fields=user')
    const data = (await res.json()) as { user?: { emailAddress?: string } }
    return data.user?.emailAddress ?? ''
  }
}
