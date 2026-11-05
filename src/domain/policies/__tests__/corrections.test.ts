import { describe, expect, it } from 'vitest'
import { diffToCorrections, splitSentences } from '../corrections'

describe('splitSentences', () => {
  it('splits a two-sentence utterance', () => {
    expect(splitSentences('Ich heiße Anna. Ich komme aus Berlin.')).toEqual([
      'Ich heiße Anna.',
      'Ich komme aus Berlin.',
    ])
  })

  it('respects the cap', () => {
    expect(splitSentences('A. B. C. D.', 2)).toHaveLength(2)
  })
})

describe('diffToCorrections', () => {
  it('turns a fixed sentence into a local word diff', () => {
    const corrections = diffToCorrections('Ich habe ein Katze', 'Ich habe eine Katze')
    expect(corrections.length).toBeGreaterThan(0)
    expect(corrections[0].original).toContain('ein')
    expect(corrections[0].corrected).toContain('eine')
  })

  it('returns nothing when the sentence is unchanged', () => {
    expect(diffToCorrections('Ich heiße Anna', 'Ich heiße Anna')).toEqual([])
  })
})
