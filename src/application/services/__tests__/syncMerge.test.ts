import { describe, expect, it } from 'vitest'
import { mergeActivity, mergeDiary, mergeHistory, mergeVocab } from '../SyncService'
import type { ConversationEntry, DiaryEntry, VocabItem } from '../../../domain/models'

function card(uid: string, updatedAt: string, known = false): VocabItem {
  return {
    id: 1,
    uid,
    word: 'Brot',
    translation: 'хлеб',
    partOfSpeech: '',
    example: '',
    exampleTranslation: '',
    known,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    lang: 'de',
  }
}

function entry(uid: string, createdAt: string): DiaryEntry {
  return { uid, lang: 'de', date: '2026-01-01', text: uid, translation: '', createdAt }
}

function message(id: number, createdAt: string): ConversationEntry {
  return {
    id,
    role: 'user',
    text: String(id),
    userTranslation: '',
    corrections: [],
    translation: '',
    followUp: '',
    createdAt,
  }
}

describe('sync merges', () => {
  it('unions vocabulary by uid with last-write-wins', () => {
    const merged = mergeVocab([card('a', '2026-01-02T00:00:00Z')], [card('a', '2026-01-01T00:00:00Z', true), card('b', '2026-01-01T00:00:00Z')])
    expect(merged).toHaveLength(2)
    expect(merged.find(i => i.uid === 'a')?.known).toBe(false)
  })

  it('unions diary entries by uid, newest first', () => {
    const merged = mergeDiary([entry('a', '2026-01-01T00:00:00Z')], [entry('b', '2026-01-02T00:00:00Z')])
    expect(merged.map(e => e.uid)).toEqual(['b', 'a'])
  })

  it('keeps the newer chat tail', () => {
    const local = [message(1, '2026-01-01T00:00:00Z')]
    const remote = [message(1, '2026-01-01T00:00:00Z'), message(2, '2026-01-02T00:00:00Z')]
    expect(mergeHistory(local, remote)).toHaveLength(2)
    expect(mergeHistory(remote, local)).toHaveLength(2)
  })

  it('takes the per-day maximum count', () => {
    expect(mergeActivity({ '2026-01-01': 2, '2026-01-02': 1 }, { '2026-01-01': 5 })).toEqual({
      '2026-01-01': 5,
      '2026-01-02': 1,
    })
  })
})
