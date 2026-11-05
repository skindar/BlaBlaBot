import { describe, expect, it } from 'vitest'
import { normalizeWord, wordsMatch } from '../words'

describe('normalizeWord', () => {
  it('lowercases, strips the German article and trailing punctuation', () => {
    expect(normalizeWord('Die Katze.', 'de')).toBe('katze')
    expect(normalizeWord('  das   Brot! ', 'de')).toBe('brot')
  })

  it('strips French, Spanish and Portuguese articles', () => {
    expect(normalizeWord('la maison', 'fr')).toBe('maison')
    expect(normalizeWord('el perro', 'es')).toBe('perro')
    expect(normalizeWord('o livro', 'pt')).toBe('livro')
  })

  it('leaves languages without articles untouched', () => {
    expect(normalizeWord('the cat', 'en')).toBe('the cat')
  })
})

describe('wordsMatch', () => {
  it('matches with and without the article', () => {
    expect(wordsMatch('Brot', 'das Brot', 'de')).toBe(true)
  })

  it('matches a substring', () => {
    expect(wordsMatch('Katze', 'Hauskatze', 'de')).toBe(true)
  })

  it('does not match unrelated words', () => {
    expect(wordsMatch('Brot', 'Kaffee', 'de')).toBe(false)
  })
})
