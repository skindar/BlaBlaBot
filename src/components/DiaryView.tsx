// Diary tab: everything the student said about their day in diary mode,
// grouped by date — verbatim, with translation and the corrected version.
// Syncs to Google Drive when the user is signed in.

import { useEffect, useState } from 'react'
import type { DiaryEntry } from '../types'
import type { TargetLang } from '../lib/langs'
import { useI18n } from '../i18n'
import { diary } from '../lib/store'
import { getSyncStatus, subscribeSync, syncNow } from '../lib/sync'

interface Props {
  active: boolean
  targetLang: TargetLang
  uiLang: 'ru' | 'en'
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function todayLabel(date: string, uiLang: 'ru' | 'en'): string {
  const today = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  if (date === todayStr) return uiLang === 'ru' ? 'Сегодня' : 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const yStr = `${yesterday.getFullYear()}-${p(yesterday.getMonth() + 1)}-${p(yesterday.getDate())}`
  if (date === yStr) return uiLang === 'ru' ? 'Вчера' : 'Yesterday'
  return date
}

export function DiaryView({ active, targetLang, uiLang }: Props) {
  const t = useI18n()
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [sync, setSync] = useState(getSyncStatus())

  useEffect(() => subscribeSync(setSync), [])

  useEffect(() => {
    if (active) setEntries(diary.list(targetLang))
  }, [active, targetLang])

  const remove = (uid: string) => {
    diary.delete(uid)
    setEntries(diary.list(targetLang))
  }

  const byDate = new Map<string, DiaryEntry[]>()
  for (const e of entries) {
    const list = byDate.get(e.date) ?? []
    list.push(e)
    byDate.set(e.date, list)
  }

  const syncLine = sync.signedIn
    ? sync.syncing
      ? t('syncSyncing')
      : sync.lastSyncAt
        ? t('syncLastAt', { time: new Date(sync.lastSyncAt).toLocaleTimeString(uiLang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) })
        : t('syncSignedInAs', { email: sync.email ?? '' })
    : t('syncOffHint')

  return (
    <section className="cards-view diary-view">
      <div className="diary-head">
        <h2>{t('tabDiary')}</h2>
        <span className={`diary-sync${sync.error ? ' error' : ''}`} title={sync.error ? t('syncError', { error: sync.error }) : syncLine}>
          {sync.error ? t('syncError', { error: sync.error.slice(0, 60) }) : syncLine}
        </span>
        {sync.signedIn && !sync.syncing && (
          <button type="button" className="card-btn" onClick={() => void syncNow()}>
            {t('syncNow')}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="cards-empty">{t('diaryEmpty')}</p>
      ) : (
        [...byDate.entries()].map(([date, list]) => (
          <div key={date} className="diary-day">
            <h3 className="diary-date">{todayLabel(date, uiLang)}</h3>
            {list.map(e => (
              <div key={e.uid} className="diary-entry" lang={targetLang}>
                <div className="diary-time">{timeOf(e.created_at)}</div>
                <div className="diary-body">
                  <div className="diary-text">{e.text}</div>
                  {e.corrected && e.corrected !== e.text && (
                    <div className="diary-corrected">
                      <span className="diary-tag">{t('diaryCorrected')}:</span> {e.corrected}
                    </div>
                  )}
                  {e.translation && <div className="diary-translation" lang={uiLang}>{e.translation}</div>}
                </div>
                <button
                  type="button"
                  className="vocab-del"
                  title={t('diaryDelete')}
                  aria-label={t('diaryDelete')}
                  onClick={() => remove(e.uid)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  )
}
