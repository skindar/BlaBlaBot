// Offline deu-rus dictionary (German only). The 2.2 MB JSON is a lazy
// dynamic-import chunk: learners of other languages never download it.

import type { DictionaryPort } from '../../application/ports'
import { normalizeWord } from '../../domain/policies/words'

type DictEntry = { t: string[]; pos?: string }

export class OfflineDictionary implements DictionaryPort {
  private cache: Record<string, DictEntry> | null = null
  private loading: Promise<Record<string, DictEntry>> | null = null

  private load(): Promise<Record<string, DictEntry>> {
    if (this.cache) return Promise.resolve(this.cache)
    this.loading ??= import('../../data/deu-rus.json').then(m => {
      this.cache = m as unknown as Record<string, DictEntry>
      return this.cache
    })
    return this.loading
  }

  /** First 3 translations + part of speech, article-stripped fallback. */
  async lookup(word: string): Promise<{ translations: string[]; pos: string }> {
    const dict = await this.load()
    const normalized = word.trim().toLowerCase()
    if (!normalized) return { translations: [], pos: '' }
    const entry = dict[normalized] ?? dict[normalizeWord(normalized, 'de')]
    if (!entry) return { translations: [], pos: '' }
    return { translations: (entry.t ?? []).slice(0, 3), pos: entry.pos ?? '' }
  }
}
