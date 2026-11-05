import { describe, expect, it } from 'vitest'
import {
  collapseAsrRepetition,
  isAsrHallucination,
  isCollapsedLoop,
  isDegenerateTranscript,
} from '../asrText'

describe('collapseAsrRepetition', () => {
  it('collapses a repeated hyphen syllable', () => {
    expect(collapseAsrRepetition('Ди-ди-ди-ди')).toBe('Ди')
  })

  it('collapses a repeated multi-word run', () => {
    const out = collapseAsrRepetition("I don't I don't I don't know")
    expect(out).toBe("I don't know")
  })

  it('leaves normal Russian speech untouched', () => {
    expect(collapseAsrRepetition('Я люблю кофе и хлеб')).toBe('Я люблю кофе и хлеб')
  })
})

describe('degenerate transcripts', () => {
  it('detects a syllable loop', () => {
    expect(isDegenerateTranscript('ла ла ла ла ла')).toBe(true)
  })

  it('does not flag a normal sentence', () => {
    expect(isDegenerateTranscript('Ich heiße Anna und komme aus Berlin')).toBe(false)
  })

  it('detects a collapsed loop', () => {
    expect(isCollapsedLoop('ди-ди-ди-ди', 'Ди')).toBe(true)
  })
})

describe('isAsrHallucination', () => {
  it('detects Russian subtitle credits', () => {
    expect(isAsrHallucination('Субтитры Т.')).toBe(true)
    expect(isAsrHallucination('Редактор субтитров А.Синецкая')).toBe(true)
  })

  it('detects English sign-offs', () => {
    expect(isAsrHallucination('Thank you for watching!')).toBe(true)
  })

  it('keeps a long real sentence that mentions subtitles', () => {
    expect(
      isAsrHallucination(
        'Ich habe gestern einen Film mit deutschen Untertiteln gesehen und danach mit Anna geredet',
      ),
    ).toBe(false)
  })
})
