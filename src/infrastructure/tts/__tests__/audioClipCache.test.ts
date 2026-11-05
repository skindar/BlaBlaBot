import { describe, expect, it } from 'vitest'
import { LruCache, speechCacheKey } from '../audioClipCache'

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1) // refresh a
    cache.set('c', 3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(1)
    expect(cache.get('c')).toBe(3)
  })

  it('replaces an existing key without growing', () => {
    const cache = new LruCache<number>(2)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(2)
  })

  it('clears everything', () => {
    const cache = new LruCache<number>(2)
    cache.set('a', 1)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('speechCacheKey', () => {
  it('normalizes whitespace and joins the identity parts', () => {
    expect(speechCacheKey(['piper', 'ru', 'voice', '  Привет,   мир '])).toBe(
      'piper|ru|voice|Привет, мир',
    )
  })

  it('keeps different voices/texts apart', () => {
    expect(speechCacheKey(['phonon', 'de', 'base', 'Annika', 'Hallo'])).not.toBe(
      speechCacheKey(['phonon', 'de', 'base', 'Viktor', 'Hallo']),
    )
  })
})
