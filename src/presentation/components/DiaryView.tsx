// Diary tab in the design's look: everything the student said about their
// day in diary mode, grouped by date, with the raw / refined page views
// and Google Drive sync. The refine view rebuilds the day's story from
// the raw lines (in the background even per phrase).

import { useEffect, useState } from 'react'
import type { DiaryEntry, DiaryPage, Level } from '../../domain/models'
import type { TargetLang } from '../../domain/policies/languages'
import { useI18n } from '../i18n'
import { useServices, useSyncStatus } from '../context'

interface Props {
  active: boolean
  targetLang: TargetLang
  uiLang: 'ru' | 'en'
  level: Level
  llmModel: string
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
  yesterday.setDate(yesterday.getDate() - 1)
  const yStr = `${yesterday.getFullYear()}-${p(yesterday.getMonth() + 1)}-${p(yesterday.getDate())}`
  if (date === yStr) return uiLang === 'ru' ? 'Вчера' : 'Yesterday'
  return date
}

export function DiaryView({ active, targetLang, uiLang, level, llmModel }: Props) {
  const t = useI18n()
  const services = useServices()
  const sync = useSyncStatus()
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [view, setView] = useState<'raw' | 'refined'>('raw')
  const [refined, setRefined] = useState<Record<string, DiaryPage | null>>({})
  const [busyDate, setBusyDate] = useState<string | null>(null)
  const [refineError, setRefineError] = useState<string | null>(null)

  useEffect(() => {
    if (active) setEntries(services.diary.entries(targetLang))
  }, [active, targetLang, services.diary])

  // load refined pages for the dates that have raw entries
  useEffect(() => {
    if (!active) return
    const dates = new Set(services.diary.entries(targetLang).map(e => e.date))
    const map: Record<string, DiaryPage | null> = {}
    for (const date of dates) map[date] = services.diary.page(targetLang, date)
    setRefined(map)
    services.diary.prunePages(targetLang, dates)
  }, [active, targetLang, entries.length, services.diary])

  const remove = (uid: string) => {
    services.diary.remove(uid)
    setEntries(services.diary.entries(targetLang))
  }

  const refine = async (date: string) => {
    if (busyDate) return
    setBusyDate(date)
    setRefineError(null)
    try {
      const page = await services.diary.refine({ lang: targetLang, date, level, uiLang, llmKey: llmModel })
      setRefined(prev => ({ ...prev, [date]: page }))
    } catch (err) {
      setRefineError(err instanceof Error ? err.message : t('diaryRefineFailed'))
    } finally {
      setBusyDate(null)
    }
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
      : sync.lastSyncMs
        ? t('syncLastAt', { time: new Date(sync.lastSyncMs).toLocaleTimeString(uiLang === 'ru' ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' }) })
        : t('syncSignedInAs', { email: sync.email })
    : t('syncOffHint')

  return (
    <section className="mx-auto w-full max-w-[760px] px-5 pb-10 pt-8 sm:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-[-0.5px]">{t('tabDiary')}</h2>
        <div
          aria-label={t('tabDiary')}
          className="flex rounded-full border border-[#e5e6de] bg-white p-1 text-xs"
          role="radiogroup"
        >
          {(['raw', 'refined'] as const).map(v => (
            <button
              aria-checked={view === v}
              className={`rounded-full px-4 py-1.5 transition-colors ${
                view === v ? 'bg-[#e5ece4] font-semibold text-[#526f60]' : 'text-[#737970]'
              }`}
              key={v}
              onClick={() => setView(v)}
              role="radio"
              type="button"
            >
              {v === 'raw' ? t('diaryViewRaw') : t('diaryViewRefined')}
            </button>
          ))}
        </div>
        <span className={`min-w-0 flex-1 truncate text-xs ${sync.error ? 'text-[#9c625c]' : 'text-[#94988f]'}`}>
          {sync.error ? t('syncError', { error: sync.error.slice(0, 60) }) : syncLine}
        </span>
        {sync.signedIn && !sync.syncing && (
          <button
            className="rounded-full border border-[#e5e6de] px-4 py-1.5 text-xs transition-colors hover:border-[#526f60] hover:text-[#526f60]"
            onClick={() => void services.sync.syncNow()}
            type="button"
          >
            {t('syncNow')}
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="mt-10 text-center text-sm leading-6 text-[#737970]">{t('diaryEmpty')}</p>
      ) : (
        [...byDate.entries()].map(([date, list]) => (
          <div className="mt-6" key={date}>
            <h3 className="text-[11px] font-semibold tracking-[1px] text-[#94988f]">
              {todayLabel(date, uiLang).toUpperCase()}
            </h3>

            {view === 'refined' ? (
              <div className="mt-4 space-y-3">
                {refined[date] && refined[date]!.facts?.length > 0 && (
                  <div className="rounded-[20px] border border-[#e5e6de] bg-white p-5">
                    <h4 className="text-[10px] font-semibold tracking-[1.1px] text-[#94988f]">
                      {t('diaryFacts').toUpperCase()}
                    </h4>
                    <ul className="mt-3 space-y-1.5">
                      {refined[date]!.facts.map((fact, i) => (
                        <li className="flex gap-2 text-[14px] leading-snug" key={i} lang={targetLang}>
                          <span className="text-[#526f60]">·</span>
                          {fact}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {refined[date] && (
                  <div className="rounded-[20px] bg-[#f0f2e9] p-6">
                    <h4 className="mb-3 text-[10px] font-semibold tracking-[1.1px] text-[#737970]">
                      {t('diaryLiterary').toUpperCase()}
                    </h4>
                    <p className="text-[16px] leading-[1.65]" lang={targetLang}>
                      {refined[date]!.text}
                    </p>
                    {refined[date]!.translation && (
                      <p className="mt-3 rounded-lg bg-[#f1f0eb] px-3 py-2 text-sm leading-relaxed text-[#737970]" lang={uiLang}>
                        {refined[date]!.translation}
                      </p>
                    )}
                  </div>
                )}
                <div className="rounded-[20px] border border-[#e5e6de] bg-white px-5 py-4">
                  <div className="space-y-3.5">
                    {list.map(e => {
                      const line = e.refined || e.corrected || e.text
                      return (
                        <div key={e.uid}>
                          <p className="text-[15px] leading-[1.6]" lang={targetLang}>
                            {line}
                          </p>
                          {e.translation && (
                            <p className="mt-1 text-xs leading-relaxed text-[#737970]" lang={uiLang}>
                              {e.translation}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    className="flex items-center gap-2 rounded-full bg-[#526f60] px-5 py-2.5 text-xs text-white transition-colors hover:bg-[#466052] disabled:opacity-40"
                    disabled={busyDate === date}
                    onClick={() => void refine(date)}
                    type="button"
                  >
                    {busyDate === date
                      ? t('diaryRefineBusy')
                      : refined[date]
                        ? t('diaryRefineRebuild')
                        : t('diaryRefineBuild')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {list.map(e => (
                  <div
                    className="flex items-start gap-4 rounded-[20px] border border-[#e5e6de] bg-white px-5 py-4"
                    key={e.uid}
                    lang={targetLang}
                  >
                    <span className="pt-1 text-[11px] tabular-nums text-[#94988f]">
                      {timeOf(e.createdAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] leading-[1.6]">{e.text}</p>
                      {e.corrected && e.corrected !== e.text && (
                        <p className="mt-1.5 text-[13px] leading-relaxed text-[#737970]">
                          <span className="mr-1 text-[10px] tracking-[0.8px] text-[#94988f]">
                            {t('diaryCorrected').toUpperCase()}
                          </span>
                          {e.corrected}
                        </p>
                      )}
                      {e.translation && (
                        <p className="mt-1.5 text-xs leading-relaxed text-[#94988f]" lang={uiLang}>
                          {e.translation}
                        </p>
                      )}
                    </div>
                    <button
                      aria-label={t('diaryDelete')}
                      className="shrink-0 text-base text-[#94988f] transition-colors hover:text-[#9c625c]"
                      onClick={() => remove(e.uid)}
                      title={t('diaryDelete')}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
      {refineError && (
        <p className="mt-4 rounded-xl border border-[#e8d5d2] bg-[#faf3f2] px-4 py-2.5 text-xs text-[#9c625c]">
          {refineError}
        </p>
      )}
    </section>
  )
}
