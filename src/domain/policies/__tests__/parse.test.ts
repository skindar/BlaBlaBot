import { describe, expect, it } from 'vitest'
import {
  filterCorrections,
  parseCorrectionsJson,
  parseSuggestionsJson,
  parseTranslationJson,
  parseTutorReply,
  parseVocabJson,
  stripThink,
} from '../parse'

describe('parseTutorReply', () => {
  it('parses the strict JSON contract', () => {
    const raw = JSON.stringify({
      reply: 'Hallo! Wie geht es dir?',
      corrections: [{ original: 'Ich habe ein Katze', corrected: 'Ich habe eine Katze', explanation: 'Artikel' }],
      suggestions: [{ text: 'Mir geht es gut', translation: 'У меня всё хорошо' }],
    })
    const parsed = parseTutorReply(raw, 'de')
    expect(parsed.method).toBe('json')
    expect(parsed.reply).toBe('Hallo! Wie geht es dir?')
    expect(parsed.corrections).toHaveLength(1)
    expect(parsed.suggestions[0]).toEqual({ text: 'Mir geht es gut', translation: 'У меня всё хорошо' })
  })

  it('accepts fenced JSON and strips thinking blocks', () => {
    const raw = '```json\n{"reply":"Guten Tag!","corrections":[]}\n```'
    const parsed = parseTutorReply(raw, 'de')
    expect(parsed.reply).toBe('Guten Tag!')
    expect(parsed.method).toBe('json')
    const open = '<' + 'think>'
    const close = '<' + '/think>'
    expect(stripThink('a ' + open + '\nsecret\n' + close + ' b')).toBe('a  b')
  })

  it('falls back to plain text when nothing parses', () => {
    const parsed = parseTutorReply('Einfach nur Text', 'de')
    expect(parsed.method).toBe('plain')
    expect(parsed.reply).toBe('Einfach nur Text')
  })

  it('repairs a trailing comma', () => {
    const parsed = parseTutorReply('{"reply":"Hallo",}', 'de')
    expect(parsed.reply).toBe('Hallo')
  })
})

describe('side parsers', () => {
  it('parses a translation pair', () => {
    expect(parseTranslationJson('{"user":"Привет","reply":"Как дела?"}')).toEqual({
      user: 'Привет',
      reply: 'Как дела?',
    })
  })

  it('parses vocabulary JSON', () => {
    const lookup = parseVocabJson(
      JSON.stringify({
        exists: true,
        word: 'das Brot',
        translation: 'хлеб',
        part_of_speech: 'сущ.',
        example: 'Ich esse Brot.',
        example_translation: 'Я ем хлеб.',
      }),
    )
    expect(lookup?.exists).toBe(true)
    expect(lookup?.translation).toBe('хлеб')
  })

  it('parses suggestions', () => {
    const parsed = parseSuggestionsJson('{"suggestions":[{"text":"Mir geht es gut","translation":"Хорошо"}]}')
    expect(parsed.suggestions).toHaveLength(1)
    expect(parsed.suggestions[0].text).toBe('Mir geht es gut')
  })

  it('parses corrections', () => {
    const parsed = parseCorrectionsJson(
      '{"corrections":[{"original":"ein Katze","corrected":"eine Katze","explanation":"Artikel"}]}',
    )
    expect(parsed.corrections).toHaveLength(1)
  })
})

describe('filterCorrections', () => {
  it('keeps a real article fix that appears in the user message', () => {
    const kept = filterCorrections(
      [{ original: 'Ich habe ein Katze', corrected: 'Ich habe eine Katze', explanation: 'Artikel' }],
      'Ich habe ein Katze',
      'ru',
    )
    expect(kept).toHaveLength(1)
  })

  it('ignores corrections invented for a different sentence', () => {
    const kept = filterCorrections(
      [{ original: 'Der Hund läuft', corrected: 'Der Hund rennt', explanation: 'x' }],
      'Ich heiße Anna',
      'ru',
    )
    expect(kept).toHaveLength(0)
  })

  it('drops telegraphic fragments under three words', () => {
    expect(filterCorrections([], 'Ja.', 'ru')).toHaveLength(0)
  })
})
