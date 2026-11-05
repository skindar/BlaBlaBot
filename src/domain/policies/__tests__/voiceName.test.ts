import { describe, expect, it } from 'vitest'
import { tutorNameForVoice } from '../voiceName'

describe('tutorNameForVoice', () => {
  it('uses the localized Piper label', () => {
    expect(tutorNameForVoice('ru', 'ru_RU-irina-medium', 'phonon')).toBe('Ирина')
    expect(tutorNameForVoice('ru', 'ru_RU-denis-medium', 'phonon')).toBe('Денис')
  })

  it('uses the Phonon voice name', () => {
    expect(tutorNameForVoice('de', 'Annika', 'phonon')).toBe('Annika')
    expect(tutorNameForVoice('en', 'Zoey', 'phonon')).toBe('Zoey')
  })

  it('parses common system voice URIs', () => {
    expect(tutorNameForVoice('ru', 'com.apple.voice.compact.ru-RU.Milena', 'system')).toBe('Milena')
    expect(tutorNameForVoice('ru', 'Microsoft Irina - Russian (Russia)', 'system')).toBe('Irina')
  })

  it('falls back to a neutral name for an unknown/default voice', () => {
    expect(tutorNameForVoice('fr', 'default', 'phonon')).toBe('Alex')
  })
})
