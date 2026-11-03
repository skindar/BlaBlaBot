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

export function FlashcardsView({ active, speakWord, llmModel, targetLang, uiLang }: Props) {
  const t = useI18n()
  const [items, setItems] = useState<VocabItem[]>([])
  const [queue, setQueue] = useState<number[]>([])
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [newWord, setNewWord] = useState('')
  const [adding, setAdding] = useState(false)

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

  return (
    <section className="cards-view">
      {loading && <p className="cards-empty">{t('cardsLoading')}</p>}

      {total > 0 && (
        <div className="cards-progress">
          <div className="cards-progress-bar">
            <div className="cards-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="cards-progress-text">
            {t('cardsProgress', { learned, total, queue: queue.length })}
          </span>
        </div>
      )}

      <div className="card-area">
        {current ? (
          <div key={current.id} className="flashcard-scene">
            <div className={`flashcard-flip${revealed ? ' flipped' : ''}`}>
              <div className="flashcard-face front">
                <div className="flashcard-deco" aria-hidden="true">
                  {targetLang}
                </div>
                {current.part_of_speech && (
                  <span className="flashcard-tag">{current.part_of_speech}</span>
                )}
                <div className="flashcard-word" lang={targetLang}>
                  {current.word}
                </div>
                <p className="flashcard-hint">{t('cardHint')}</p>
                <div className="flashcard-actions">
                  <button type="button" className="card-btn" onClick={() => speakWord(current.word)}>
                    {t('cardSpeak')}
                  </button>
                  <button type="button" className="card-btn primary" onClick={() => setRevealed(true)}>
                    {t('cardReveal')} <span className="kbd">Space</span>
                  </button>
                </div>
              </div>
              <div className="flashcard-face back">
                <div className="flashcard-deco" aria-hidden="true">
                  {uiLang}
                </div>
                {current.part_of_speech && (
                  <span className="flashcard-tag">{current.part_of_speech}</span>
                )}
                <div className="flashcard-translation">{current.translation}</div>
                {current.example && (
                  <div className="flashcard-example">
                    <i lang={targetLang}>{current.example}</i>
                    {current.example_translation && <span>{current.example_translation}</span>}
                  </div>
                )}
                <div className="flashcard-actions">
                  <button type="button" className="card-btn danger" onClick={repeatLater}>
                    {t('cardRepeat')} <span className="kbd">←</span>
                  </button>
                  <button type="button" className="card-btn success" onClick={() => void markKnown()}>
                    {t('cardKnow')} <span className="kbd">→</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flashcard-scene">
            <div className="flashcard-flip">
              <div className="flashcard-face front">
                <div className="flashcard-deco" aria-hidden="true">
                  {targetLang}
                </div>
                {items.length === 0 ? (
                  <>
                    <div className="flashcard-word">{t('yourVocab')}</div>
                    <p className="flashcard-hint">{t('emptyVocabHint')}</p>
                  </>
                ) : (
                  <>
                    <div className="flashcard-word">{t('allLearned')}</div>
                    <p className="flashcard-hint">{t('allLearnedHint')}</p>
                    <div className="flashcard-actions">
                      <button type="button" className="card-btn primary" onClick={trainAll}>
                        {t('trainAll', { total })}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {current && (
          <p className="cards-keys">
            <span className="kbd">Space</span> {t('keysFlip')} · <span className="kbd">→</span> {t('keysKnow')} ·{' '}
            <span className="kbd">←</span> {t('keysRepeat')}
          </p>
        )}
      </div>

      <div className="vocab-manage">
        <div className="vocab-add-row">
          <input
            type="text"
            value={newWord}
            placeholder={t('newWordPlaceholder')}
            onChange={e => setNewWord(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void addWord()
            }}
          />
          <button type="button" className="card-btn primary" onClick={() => void addWord()} disabled={adding}>
            {t('cardAdd')}
          </button>
        </div>
        {items.length > 0 && (
          <ul className="vocab-list">
            {items.map(i => (
              <li key={i.id} className={i.known ? 'known' : ''}>
                <span className="vocab-word" lang={targetLang}>
                  {i.word}
                </span>
                <span className="vocab-translation">{i.translation}</span>
                <span className="vocab-tools">
                  <button
                    type="button"
                    title={i.known ? t('againInTraining') : t('markLearned')}
                    onClick={() => toggleKnown(i)}
                  >
                    {i.known ? t('btnRepeat') : t('btnLearned')}
                  </button>
                  <button type="button" className="vocab-del" onClick={() => void removeWord(i.id)}>
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
