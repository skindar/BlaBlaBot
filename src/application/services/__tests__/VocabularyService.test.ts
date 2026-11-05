import { describe, expect, it } from 'vitest'
import { VocabularyService } from '../VocabularyService'
import { FakeBrain, FakeClock, FakeTelemetry } from '../../../test/fakes'
import { LocalVocabularyRepository, MemoryKeyValue, SequentialIdSource } from '../../../infrastructure/storage/repositories'
import { EventBus } from '../../support/EventBus'
import { InvalidParameterError } from '../../errors'

function build(dictionaryTranslations: string[] = []) {
  const store = new MemoryKeyValue()
  const clock = new FakeClock()
  const ids = new SequentialIdSource(store, clock)
  const vocab = new LocalVocabularyRepository(store, new EventBus(), clock, ids)
  const brain = new FakeBrain(() => ({
    text: JSON.stringify({
      exists: true,
      word: 'das Brot',
      translation: 'хлеб',
      part_of_speech: 'сущ.',
      example: 'Ich esse Brot.',
      example_translation: 'Я ем хлеб.',
    }),
    perf: null,
  }))
  const service = new VocabularyService({
    brain,
    vocab,
    telemetry: new FakeTelemetry(),
    clock,
    dictionary: { lookup: async () => ({ translations: dictionaryTranslations, pos: 'сущ.' }) },
  })
  return { service, vocab }
}

describe('VocabularyService', () => {
  it('looks a word up and stores a flashcard', async () => {
    const { service, vocab } = build()
    const result = await service.lookup('  das   Brot ', {
      llmKey: 'fake-model',
      targetLang: 'de',
      uiLang: 'ru',
    })
    expect(result.existed).toBe(false)
    expect(result.item.word).toBe('das Brot')
    expect(vocab.list('de')).toHaveLength(1)
  })

  it('prefers the offline dictionary translation when available', async () => {
    const { service } = build(['хлеб (из муки)'])
    const result = await service.lookup('Brot', {
      llmKey: 'fake-model',
      targetLang: 'de',
      uiLang: 'ru',
    })
    expect(result.item.translation).toBe('хлеб (из муки)')
  })

  it('rejects an empty word', async () => {
    const { service } = build()
    await expect(
      service.lookup('   ', { llmKey: 'fake-model', targetLang: 'de', uiLang: 'ru' }),
    ).rejects.toBeInstanceOf(InvalidParameterError)
  })
})
