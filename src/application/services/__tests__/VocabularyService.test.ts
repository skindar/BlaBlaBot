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
  return { service, vocab, brain }
}

describe('VocabularyService', () => {
  it('stores the selected word, not a model-provided replacement', async () => {
    const { service, vocab } = build()
    const result = await service.lookup('  das   Brot ', {
      llmKey: 'fake-model',
      targetLang: 'de',
      uiLang: 'ru',
    })
    expect(result.existed).toBe(false)
    expect(result.item.word).toBe('das Brot')
    expect(result.item.translation).toBe('хлеб')
    expect(vocab.list('de')).toHaveLength(1)
  })

  it('strips punctuation from a selected chat word', async () => {
    const { service } = build()
    const result = await service.lookup('«Brot.»', {
      llmKey: 'fake-model',
      targetLang: 'de',
      uiLang: 'ru',
    })
    expect(result.item.word).toBe('Brot')
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

  it('keeps the French selected word and uses the returned translation', async () => {
    const store = new MemoryKeyValue()
    const clock = new FakeClock()
    const ids = new SequentialIdSource(store, clock)
    const vocab = new LocalVocabularyRepository(store, new EventBus(), clock, ids)
    const brain = new FakeBrain(() => ({
      text: JSON.stringify({ translation: 'как', part_of_speech: 'наречие' }),
      perf: null,
    }))
    const service = new VocabularyService({
      brain,
      vocab,
      telemetry: new FakeTelemetry(),
      clock,
      dictionary: { lookup: async () => ({ translations: [], pos: '' }) },
    })
    const result = await service.lookup('Comment', {
      llmKey: 'fake-model',
      targetLang: 'fr',
      uiLang: 'ru',
    })
    expect(result.item.word).toBe('Comment')
    expect(result.item.translation).toBe('как')
    expect(vocab.list('fr')).toHaveLength(1)
  })

  it('rejects a meta explanation and retries with a strict gloss', async () => {
    const store = new MemoryKeyValue()
    const clock = new FakeClock()
    const ids = new SequentialIdSource(store, clock)
    const vocab = new LocalVocabularyRepository(store, new EventBus(), clock, ids)
    let calls = 0
    const brain = new FakeBrain(() => {
      calls += 1
      return {
        text:
          calls === 1
            ? JSON.stringify({ translation: 'how to say something in English' })
            : JSON.stringify({ translation: 'how' }),
        perf: null,
      }
    })
    const service = new VocabularyService({
      brain,
      vocab,
      telemetry: new FakeTelemetry(),
      clock,
      dictionary: { lookup: async () => ({ translations: [], pos: '' }) },
    })
    const result = await service.lookup('Comment', {
      llmKey: 'fake-model',
      targetLang: 'fr',
      uiLang: 'en',
    })
    expect(result.item.word).toBe('Comment')
    expect(result.item.translation).toBe('how')
  })

  it('translates a Spanish conjugated form without changing the selection', async () => {
    const store = new MemoryKeyValue()
    const clock = new FakeClock()
    const ids = new SequentialIdSource(store, clock)
    const vocab = new LocalVocabularyRepository(store, new EventBus(), clock, ids)
    const brain = new FakeBrain(() => ({
      text: JSON.stringify({ translation: 'нужно', part_of_speech: 'глагол' }),
      perf: null,
    }))
    const service = new VocabularyService({
      brain,
      vocab,
      telemetry: new FakeTelemetry(),
      clock,
      dictionary: { lookup: async () => ({ translations: [], pos: '' }) },
    })
    const result = await service.lookup('Necesitas', {
      llmKey: 'fake-model',
      targetLang: 'es',
      uiLang: 'ru',
    })
    expect(result.item.word).toBe('Necesitas')
    expect(result.item.translation).toBe('нужно')
  })

  it('rejects an empty word', async () => {
    const { service } = build()
    await expect(
      service.lookup('   ', { llmKey: 'fake-model', targetLang: 'de', uiLang: 'ru' }),
    ).rejects.toBeInstanceOf(InvalidParameterError)
  })
})
