// Flashcards in the design's look: the sage progress ring with stats, the
// flip card, keyboard shortcuts and the vocabulary list with search.

import { useCallback, useEffect, useState } from 'react'
import type { VocabItem } from '../types'
import type { UiLang } from '../i18n'
import type { TargetLang } from '../lib/langs'
import { useI18n } from '../i18n'
import { processVocab } from '../lib/engine'
import { vocab } from '../lib/store'

interface Props {
  active: boolean
  speakWord: (text: string) => void
  llmModel: string
  targetLang: TargetLang
  uiLang: UiLang
}

/** Circular progress: percent ring in the design's sage tone */
function ProgressRing({ pct }: { pct: number }) {
  const R = 26
  const C = 2 * Math.PI * R
  return (
    <svg aria-label={`${pct}%`} className="size-16" role="img" viewBox="0 0 64 64">
      <circle cx="32" cy="32" fill="none" r={R} stroke="#e5e6de" strokeWidth="5" />
      <circle
        cx="32"
        cy="32"
        fill="none"
        r={R}
        stroke="#526f60"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - pct / 100)}
        strokeWidth="5"
        transform="rotate(-90 32 32)"
      />
      <text className="fill-[#526f60] text-[15px] font-semibold" dominantBaseline="middle" textAnchor="middle" x="32" y="34">
        {pct}%
      </text>
    </svg>
  )
}

export function FlashcardsView({ active, speakWord, llmModel, targetLang, uiLang }: Props) {
  const t = useI18n()
  const [items, setItems] = useState<VocabItem[]>([])
  const [queue, setQueue] = useState<number[]>([])
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [newWord, setNewWord] = useState('')
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setItems(vocab.listAll(targetLang))
    } finally {
      setLoading(false)
    }
  }, [targetLang])

  useEffect(() => {
    if (active) {
      setQueue([])
      setRevealed(false)
      setSearch('')
      void refresh()
    }
  }, [active, refresh])

  useEffect(() => {
    setQueue(q => {
      if (q.length === 0) return items.filter(i => !i.known).map(i => i.id)
      const ids = new Set(items.map(i => i.id))
      return q.filter(id => ids.has(id))
    })
  }, [items])

  const current = queue.length > 0 ? items.find(i => i.id === queue[0]) : undefined
  const total = items.length
  const q = search.trim().toLowerCase()
  const shownItems =
    q.length > 0
      ? items.filter(
          i => i.word.toLowerCase().includes(q) || i.translation.toLowerCase().includes(q),
        )
      : items
  const learned = items.filter(i => i.known).length
  const pct = total > 0 ? Math.round((learned / total) * 100) : 0

  useEffect(() => {
    setRevealed(false)
  }, [queue[0]])

  const markKnown = useCallback(async () => {
    if (!current) return
    setQueue(q => q.slice(1))
    setRevealed(false)
    try {
      vocab.setKnown(targetLang, current.id, true)
    } finally {
      void refresh()
    }
  }, [current, refresh, targetLang])

  const repeatLater = useCallback(() => {
    if (!current) return
    setQueue(q => [...q.slice(1), current.id])
    setRevealed(false)
  }, [current])

  const removeWord = useCallback(
    async (id: number) => {
      setQueue(q => q.filter(x => x !== id))
      vocab.delete(targetLang, id)
      void refresh()
    },
    [refresh, targetLang],
  )

  const toggleKnown = useCallback(
    (item: VocabItem) => {
      vocab.setKnown(targetLang, item.id, !item.known)
      void refresh()
    },
    [refresh, targetLang],
  )

  const addWord = useCallback(async () => {
    const word = newWord.trim()
    if (!word || adding) return
    setAdding(true)
    try {
      await processVocab(word, llmModel, targetLang, uiLang)
      setNewWord('')
      await refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : t('vocabFailed'))
    } finally {
      setAdding(false)
    }
  }, [newWord, adding, refresh, llmModel, targetLang, uiLang, t])

  const trainAll = useCallback(() => {
    setQueue(items.map(i => i.id))
    setRevealed(false)
  }, [items])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (!current) return
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        setRevealed(r => !r)
      } else if (e.code === 'ArrowRight' && revealed) {
        e.preventDefault()
        void markKnown()
      } else if (e.code === 'ArrowLeft' && revealed) {
        e.preventDefault()
        repeatLater()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, current, revealed, markKnown, repeatLater])

  const sagePill = 'rounded-full px-5 py-2.5 text-xs transition-colors disabled:opacity-40'

  return (
    <section className="mx-auto w-full max-w-[760px] px-5 pb-10 pt-8 sm:px-8">
      {loading && <p className="text-center text-sm text-[#737970]">{t('cardsLoading')}</p>}

      {total > 0 && (
        <div className="flex items-center gap-6">
          <ProgressRing pct={pct} />
          <div className="flex flex-1 gap-2.5">
            {[
              [learned, t('cardsStatLearned')],
              [queue.length, t('cardsStatQueue')],
              [total, t('cardsStatTotal')],
            ].map(([value, label]) => (
              <div className="flex-1 rounded-2xl border border-[#e5e6de] bg-white px-4 py-3" key={label as string}>
                <p className="text-lg font-semibold tabular-nums">{value}</p>
                <p className="mt-0.5 text-[11px] text-[#737970]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        {current ? (
          <div
            aria-label={t('cardReveal')}
            className="rounded-[24px] border border-[#e5e6de] bg-white p-10 text-center shadow-sm"
            key={current.id}
            onClick={() => setRevealed(r => !r)}
            onKeyDown={e => {
              if (e.key === 'Enter') setRevealed(r => !r)
            }}
            role="button"
            tabIndex={0}
          >
            {!revealed ? (
              <>
                {current.part_of_speech && (
                  <span className="text-[11px] tracking-[0.8px] text-[#94988f]">
                    {current.part_of_speech.toUpperCase()}
                  </span>
                )}
                <p className="mt-4 text-[34px] leading-tight tracking-[-0.6px]" lang={targetLang}>
                  {current.word}
                </p>
                <p className="mt-4 text-xs text-[#737970]">{t('cardHint')}</p>
                <div className="mt-7 flex flex-wrap justify-center gap-3">
                  <button
                    className={`${sagePill} border border-[#e5e6de] text-[#526f60] hover:border-[#526f60]`}
                    onClick={e => {
                      e.stopPropagation()
                      speakWord(current.word)
                    }}
                    type="button"
                  >
                    {t('cardSpeak')}
                  </button>
                  <button
                    className={`${sagePill} bg-[#526f60] text-white hover:bg-[#466052]`}
                    onClick={e => {
                      e.stopPropagation()
                      setRevealed(true)
                    }}
                    type="button"
                  >
                    {t('cardReveal')}
                  </button>
                </div>
              </>
            ) : (
              <>
                {current.part_of_speech && (
                  <span className="text-[11px] tracking-[0.8px] text-[#94988f]">
                    {current.part_of_speech.toUpperCase()}
                  </span>
                )}
                <p className="mt-4 text-[28px] leading-tight tracking-[-0.6px]">{current.translation}</p>
                {current.example && (
                  <div className="mx-auto mt-5 max-w-md rounded-2xl bg-[#f1f0eb] px-5 py-4">
                    <p className="text-sm leading-relaxed" lang={targetLang}>
                      {current.example}
                    </p>
                    {current.example_translation && (
                      <p className="mt-1.5 text-xs text-[#737970]">{current.example_translation}</p>
                    )}
                  </div>
                )}
                <div className="mt-7 flex flex-wrap justify-center gap-3">
                  <button
                    className={`${sagePill} bg-[#9c625c] text-white hover:bg-[#8a534e]`}
                    onClick={e => {
                      e.stopPropagation()
                      repeatLater()
                    }}
                    type="button"
                  >
                    {t('cardRepeat')} ←
                  </button>
                  <button
                    className={`${sagePill} bg-[#526f60] text-white hover:bg-[#466052]`}
                    onClick={e => {
                      e.stopPropagation()
                      void markKnown()
                    }}
                    type="button"
                  >
                    {t('cardKnow')} →
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="rounded-[24px] border border-[#e5e6de] bg-white p-10 text-center shadow-sm">
            {items.length === 0 ? (
              <>
                <p className="text-[22px] font-semibold tracking-[-0.6px]">{t('yourVocab')}</p>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#737970]">
                  {t('emptyVocabHint')}
                </p>
              </>
            ) : (
              <>
                <p className="text-[22px] font-semibold tracking-[-0.6px]">{t('allLearned')}</p>
                <p className="mt-3 text-sm text-[#737970]">{t('allLearnedHint')}</p>
                <button
                  className="mt-6 rounded-full bg-[#526f60] px-6 py-3 text-sm text-white hover:bg-[#466052]"
                  onClick={trainAll}
                  type="button"
                >
                  {t('trainAll', { total })}
                </button>
              </>
            )}
          </div>
        )}
        {current && (
          <p className="mt-3 text-center text-[11px] text-[#94988f]">
            <kbd className="rounded border border-[#e5e6de] px-[7px] py-[3px] text-[10px]">Space</kbd>{' '}
            {t('keysFlip')} · <kbd className="rounded border border-[#e5e6de] px-[7px] py-[3px] text-[10px]">→</kbd>{' '}
            {t('keysKnow')} · <kbd className="rounded border border-[#e5e6de] px-[7px] py-[3px] text-[10px]">←</kbd>{' '}
            {t('keysRepeat')}
          </p>
        )}
      </div>

      <div className="mt-8">
        <div className="flex gap-2.5">
          <input
            className="min-w-0 flex-1 rounded-full border border-[#e5e6de] bg-white px-5 py-3 text-sm outline-none placeholder:text-[#94988f] focus:border-[#526f60]"
            onChange={e => setNewWord(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void addWord()
            }}
            placeholder={t('newWordPlaceholder')}
            type="text"
            value={newWord}
          />
          <button
            className="shrink-0 rounded-full bg-[#526f60] px-6 py-3 text-sm text-white hover:bg-[#466052] disabled:opacity-40"
            disabled={adding}
            onClick={() => void addWord()}
            type="button"
          >
            {t('cardAdd')}
          </button>
        </div>
        {items.length > 6 && (
          <input
            className="mt-3 w-full rounded-full border border-[#e5e6de] bg-white px-5 py-2.5 text-sm outline-none placeholder:text-[#94988f] focus:border-[#526f60]"
            onChange={e => setSearch(e.target.value)}
            placeholder={t('vocabSearchPlaceholder')}
            type="text"
            value={search}
          />
        )}
        {shownItems.length > 0 && (
          <ul className="mt-4 space-y-2">
            {shownItems.map(i => (
              <li
                className={`flex items-center gap-3 rounded-2xl border border-[#e5e6de] bg-white px-4 py-3 ${
                  i.known ? 'opacity-60' : ''
                }`}
                key={i.id}
              >
                {i.part_of_speech && (
                  <span className="shrink-0 text-[10px] tracking-[0.6px] text-[#94988f]">
                    {i.part_of_speech}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium" lang={targetLang}>
                  {i.word}
                </span>
                <span className="hidden min-w-0 max-w-[45%] truncate text-xs text-[#737970] sm:block">
                  {i.translation}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    className={`rounded-full px-3 py-1.5 text-[11px] transition-colors ${
                      i.known
                        ? 'text-[#737970] hover:bg-[#f1f0eb]'
                        : 'bg-[#e5ece4] font-medium text-[#526f60] hover:bg-[#dce7db]'
                    }`}
                    onClick={() => toggleKnown(i)}
                    title={i.known ? t('againInTraining') : t('markLearned')}
                    type="button"
                  >
                    {i.known ? t('btnRepeat') : t('btnLearned')}
                  </button>
                  <button
                    className="px-2 text-base text-[#94988f] transition-colors hover:text-[#9c625c]"
                    onClick={() => void removeWord(i.id)}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
