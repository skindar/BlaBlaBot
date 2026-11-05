import { describe, expect, it } from 'vitest'
import {
  LocalActivityRepository,
  LocalConversationRepository,
  LocalDiaryRepository,
  LocalSessionRepository,
  LocalSettingsRepository,
  LocalVocabularyRepository,
  MemoryKeyValue,
  SequentialIdSource,
} from '../repositories'
import { EventBus } from '../../../application/support/EventBus'
import { FakeClock } from '../../../test/fakes'
import { defaultSettings } from '../../../domain/policies/settings'

function makeRepos() {
  const store = new MemoryKeyValue()
  const bus = new EventBus()
  const clock = new FakeClock()
  const ids = new SequentialIdSource(store, clock)
  const changes: string[] = []
  bus.subscribe(change => changes.push(`${change.kind}:${change.lang}`))
  return {
    store,
    bus,
    clock,
    ids,
    changes,
    conversation: new LocalConversationRepository(store, bus, clock, ids),
    vocab: new LocalVocabularyRepository(store, bus, clock, ids),
    diary: new LocalDiaryRepository(store, bus, clock, ids),
    sessions: new LocalSessionRepository(store),
    activity: new LocalActivityRepository(store, bus, clock),
  }
}

const defaults = () =>
  defaultSettings('ru', { llmModel: 'gemma-3-1b', asrModel: 'base' })

describe('LocalSettingsRepository', () => {
  it('returns defaults when empty and round-trips a saved value', () => {
    const { store } = makeRepos()
    const repo = new LocalSettingsRepository(store, defaults)
    expect(repo.load().level).toBe('A2')
    repo.save({ ...defaults(), level: 'B1' })
    expect(new LocalSettingsRepository(store, defaults).load().level).toBe('B1')
  })
})

describe('conversation repository', () => {
  it('persists turns and builds the LLM history with follow-ups', () => {
    const { conversation, changes } = makeRepos()
    conversation.addUser('de', 'Hallo', 'Привет')
    conversation.addTutor('de', 'Guten Tag!', [], 'Здравствуйте!', 'Wie heißt du?')
    const recent = conversation.recent('de')
    expect(recent).toHaveLength(2)
    expect(recent[0].userTranslation).toBe('Привет')
    expect(conversation.historyForLlm('de')).toEqual([
      { role: 'user', content: 'Hallo' },
      { role: 'assistant', content: 'Guten Tag! Wie heißt du?' },
    ])
    expect(changes).toContain('history:de')
  })

  it('resets one language without touching another', () => {
    const { conversation } = makeRepos()
    conversation.addUser('de', 'Hallo', '')
    conversation.addUser('en', 'Hello', '')
    conversation.reset('de')
    expect(conversation.recent('de')).toHaveLength(0)
    expect(conversation.recent('en')).toHaveLength(1)
  })
})

describe('vocabulary repository', () => {
  it('deduplicates fuzzily and keeps the existing card', () => {
    const { vocab } = makeRepos()
    const first = vocab.add({
      lang: 'de',
      word: 'Brot',
      translation: 'хлеб',
      partOfSpeech: 'сущ.',
      example: '',
      exampleTranslation: '',
    })
    const second = vocab.add({
      lang: 'de',
      word: 'das Brot',
      translation: 'хлеб',
      partOfSpeech: 'сущ.',
      example: '',
      exampleTranslation: '',
    })
    expect(first.existed).toBe(false)
    expect(second.existed).toBe(true)
    expect(second.item.id).toBe(first.item.id)
  })

  it('lists unknown cards first and supports known/remove', () => {
    const { vocab } = makeRepos()
    const a = vocab.add({ lang: 'de', word: 'Brot', translation: 'хлеб', partOfSpeech: '', example: '', exampleTranslation: '' })
    const b = vocab.add({ lang: 'de', word: 'Kaffee', translation: 'кофе', partOfSpeech: '', example: '', exampleTranslation: '' })
    vocab.setKnown('de', a.item.id, true)
    expect(vocab.list('de').map(i => i.id)).toEqual([b.item.id, a.item.id])
    expect(vocab.remove('de', b.item.id)).toBe(true)
    expect(vocab.list('de')).toHaveLength(1)
  })
})

describe('diary repository', () => {
  it('appends entries, tracks state and caches pages', () => {
    const { diary } = makeRepos()
    const entry = diary.append({ lang: 'de', text: 'Heute war es schön', translation: 'Сегодня было хорошо' })
    expect(diary.list('de')).toHaveLength(1)
    expect(diary.list('en')).toHaveLength(0)
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    diary.setState('de', { qIdx: 2 })
    expect(diary.state('de').qIdx).toBe(2)
    diary.savePage({
      lang: 'de',
      date: entry.date,
      text: 'Ein schöner Tag.',
      facts: ['Es war schön'],
      translation: 'Хороший день.',
      updatedAt: entry.createdAt,
    })
    expect(diary.page('de', entry.date)?.text).toBe('Ein schöner Tag.')
    diary.prunePages('de', new Set())
    expect(diary.page('de', entry.date)).toBeNull()
  })
})

describe('activity and sessions', () => {
  it('counts actions per local day', () => {
    const { activity, clock } = makeRepos()
    activity.bump()
    activity.bump(2)
    const days = activity.list()
    const key = Object.keys(days)[0]
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(days[key]).toBe(3)
    clock.advance(24 * 3600 * 1000)
    activity.bump()
    expect(Object.keys(activity.list())).toHaveLength(2)
  })

  it('round-trips a tutor session', () => {
    const { sessions } = makeRepos()
    sessions.set('de', { scenarioId: 'de-a1-kennenlernen', nextIndex: 2, topicKey: '' })
    expect(sessions.get('de')?.nextIndex).toBe(2)
    sessions.reset('de')
    expect(sessions.get('de')).toBeNull()
  })
})


describe('chat archiving', () => {
  it('keeps the previous chat when a new one starts', () => {
    const { conversation } = makeRepos()
    conversation.addUser('de', 'Erster Chat', 'Первый чат')
    conversation.addTutor('de', 'Hallo!', [], '', '')
    const before = conversation.currentChat('de')
    expect(before.messageCount).toBe(2)
    expect(before.title).toBe('Erster Chat')

    conversation.reset('de')
    expect(conversation.currentChat('de').messageCount).toBe(0)
    const archived = conversation.archives('de')
    expect(archived).toHaveLength(1)
    expect(archived[0].title).toBe('Erster Chat')

    expect(conversation.openArchive(archived[0].id)).toBe(true)
    expect(conversation.currentChat('de').messageCount).toBe(2)
    expect(conversation.recent('de')[0].text).toBe('Erster Chat')
    expect(conversation.archives('de')).toHaveLength(0)
  })

  it('deletes an archived chat on request', () => {
    const { conversation } = makeRepos()
    conversation.addUser('de', 'Alt', '')
    conversation.reset('de')
    const [chat] = conversation.archives('de')
    expect(conversation.deleteArchive(chat.id)).toBe(true)
    expect(conversation.archives('de')).toHaveLength(0)
  })
})


describe('chat deletion', () => {
  it('clears the current chat without archiving it', () => {
    const { conversation } = makeRepos()
    conversation.addUser('de', 'Weg damit', '')
    expect(conversation.deleteChat('current', 'de')).toBe(true)
    expect(conversation.currentChat('de').messageCount).toBe(0)
    expect(conversation.archives('de')).toHaveLength(0)
  })

  it('deletes an archived chat by id', () => {
    const { conversation } = makeRepos()
    conversation.addUser('de', 'Archiv', '')
    conversation.reset('de')
    const [chat] = conversation.archives('de')
    expect(conversation.deleteChat(chat.id, 'de')).toBe(true)
    expect(conversation.archives('de')).toHaveLength(0)
  })
})
