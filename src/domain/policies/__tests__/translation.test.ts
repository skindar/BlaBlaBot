import { describe, expect, it } from 'vitest'
import {
  cleanSuggestions,
  hasWrongScript,
  looksEnglish,
  parseSingleTranslation,
  rescueYesNoQuestion,
  samePhrase,
  stripForeignParens,
  translationOk,
  translationSane,
} from '../translation'

describe('translationOk', () => {
  it('accepts Cyrillic for the Russian UI', () => {
    expect(translationOk('Привет, как дела?', 'ru')).toBe(true)
  })

  it('rejects Latin chatter for the Russian UI', () => {
    expect(translationOk('choose a name', 'ru')).toBe(false)
    expect(translationOk('Привет choose name', 'ru')).toBe(false)
  })

  it('allows a single Latin name', () => {
    expect(translationOk('Привет, Anna', 'ru')).toBe(true)
  })

  it('rejects CJK junk on every UI language', () => {
    expect(translationOk('你好', 'en')).toBe(false)
  })
})

describe('translationSane', () => {
  it('requires every question to survive', () => {
    expect(translationSane('Wie geht es dir?', 'Как дела?', 'ru', true)).toBe(true)
    expect(translationSane('Wie geht es dir?', 'Хорошо', 'ru', true)).toBe(false)
  })

  it('rejects invented questions', () => {
    expect(translationSane('Ich trinke Kaffee.', 'Я пью кофе?', 'ru', true)).toBe(false)
  })

  it('rejects lost numbers', () => {
    expect(translationSane('Ich habe 3 Katzen.', 'У меня кошки.', 'ru', true)).toBe(false)
  })

  it('rejects a translation that dropped half the content', () => {
    expect(
      translationSane(
        'Danke fürs Erzählen! Sehr gut gemacht! Neues Thema: Frühstück. Trinkst du Kaffee?',
        'Завтрак?',
        'ru',
        true,
      ),
    ).toBe(false)
  })
})

describe('rescueYesNoQuestion', () => {
  it('restores the dropped question mark', () => {
    expect(rescueYesNoQuestion('Hast du das Buch gelesen?', 'Ты читала книгу', 'ru', 'de')).toBe(
      'Ты читала книгу?',
    )
  })

  it('does not turn an answer into a question', () => {
    expect(rescueYesNoQuestion('Hast du das Buch gelesen?', 'Да, читала', 'ru', 'de')).toBe('')
  })
})

describe('cleanSuggestions', () => {
  it('keeps short target-language chips with a real translation', () => {
    const out = cleanSuggestions(
      [
        { text: 'Mir geht es gut', translation: 'У меня всё хорошо' },
        { text: 'Ja', translation: 'Да' },
        { text: 'I am fine', translation: 'Я в порядке' },
      ],
      'ru',
      'de',
    )
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('Mir geht es gut')
  })

  it('swaps swapped fields (text holds the UI translation)', () => {
    const out = cleanSuggestions([{ text: 'Мне хорошо', translation: 'Mir geht es gut' }], 'ru', 'de')
    expect(out[0]).toEqual({ text: 'Mir geht es gut', translation: 'Мне хорошо' })
  })
})

describe('small helpers', () => {
  it('compares phrases ignoring quotes and case', () => {
    expect(samePhrase('«Hallo Welt»', 'hallo   welt')).toBe(true)
  })

  it('detects English drift', () => {
    expect(looksEnglish('I would like to have some coffee and the bill')).toBe(true)
    expect(looksEnglish('Ich möchte bitte einen Kaffee')).toBe(false)
  })

  it('strips foreign parenthetical remarks', () => {
    expect(stripForeignParens('Меня зовут Иван (choose a name)', 'ru')).toBe('Меня зовут Иван')
  })

  it('extracts a bare single translation', () => {
    expect(parseSingleTranslation('«Привет!»')).toBe('Привет!')
  })
})

describe('hasWrongScript', () => {
  it('catches lowercase Latin drift inside a Russian lesson', () => {
    expect(hasWrongScript('Поговорим о чему khác, давай разберемся', 'ru')).toBe(true)
    expect(hasWrongScript('Он сказал hello', 'ru')).toBe(true)
  })

  it('allows capitalised names in Russian text', () => {
    expect(hasWrongScript('Привет, Anna! Как дела?', 'ru')).toBe(false)
    expect(hasWrongScript('Я живу в Berlin.', 'ru')).toBe(false)
  })

  it('rejects Cyrillic inside a German lesson', () => {
    expect(hasWrongScript('Hallo, мир!', 'de')).toBe(true)
  })

  it('accepts normal target-language text', () => {
    expect(hasWrongScript('Привет! Как дела?', 'ru')).toBe(false)
    expect(hasWrongScript('Hallo! Wie geht es dir?', 'de')).toBe(false)
  })
})
