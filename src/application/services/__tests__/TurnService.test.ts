import { describe, expect, it } from 'vitest'
import { TurnService, type TurnOptions } from '../TurnService'
import { InvalidParameterError, ModelsNotReadyError } from '../../errors'
import {
  LocalActivityRepository,
  LocalConversationRepository,
  LocalDiaryRepository,
  LocalSessionRepository,
  MemoryKeyValue,
  SequentialIdSource,
} from '../../../infrastructure/storage/repositories'
import { EventBus } from '../../support/EventBus'
import { FakeAsr, FakeBrain, FakeClock, FakeSpeech, FakeTelemetry } from '../../../test/fakes'
import type { LlmMessage } from '../../../domain/models'

function json(text: unknown): string {
  return JSON.stringify(text)
}

function build(opts: { tiny?: boolean } = {}) {
  const store = new MemoryKeyValue()
  const clock = new FakeClock()
  const bus = new EventBus()
  const ids = new SequentialIdSource(store, clock)
  const conversation = new LocalConversationRepository(store, bus, clock, ids)
  const diary = new LocalDiaryRepository(store, bus, clock, ids)
  const sessions = new LocalSessionRepository(store)
  const activity = new LocalActivityRepository(store, bus, clock)
  const telemetry = new FakeTelemetry()
  const speech = new FakeSpeech()
  const asr = new FakeAsr()

  const brain = new FakeBrain((messages: LlmMessage[]) => {
    const system = messages[0]?.content ?? ''
    if (/translator/i.test(system)) {
      return {
        text: json({ user: 'Привет, меня зовут Анна.', reply: 'Привет! Как дела?' }),
        perf: null,
      }
    }
    return {
      text: json({
        reply: 'Hallo! Wie geht es dir?',
        corrections: [],
        suggestions: [{ text: 'Mir geht es gut', translation: 'У меня всё хорошо' }],
      }),
      perf: null,
    }
  })
  brain.tiny = opts.tiny ?? false
  const turns = new TurnService({
    brain,
    asr,
    speech,
    conversation,
    diary,
    sessions,
    activity,
    dictionary: { lookup: async () => ({ translations: [], pos: '' }) },
    telemetry,
    clock,
  })
  return { turns, brain, asr, speech, conversation, diary, sessions, activity, telemetry, clock }
}

const options: TurnOptions = {
  level: 'A2',
  targetLang: 'de',
  uiLang: 'ru',
  llmKey: 'fake-model',
  speech: { engine: 'phonon', voice: 'voice', phononBase: 'https://example.test/model/' },
}

describe('TurnService (full tier, text input)', () => {
  it('runs the turn, translates both lines, persists history and records timings', async () => {
    const ctx = build()
    const result = await ctx.turns.process({ text: 'Ich heiße Anna.' }, options)

    expect(result.userText).toBe('Ich heiße Anna.')
    expect(result.reply.length).toBeGreaterThan(0)
    expect(result.reply).toContain('?')
    expect(result.userTranslation).toBe('Привет, меня зовут Анна.')
    expect(result.translation).toBe('Привет! Как дела?')
    expect(result.canSpeak).toBe(true)
    expect(result.timings.llm_ms).toBeGreaterThanOrEqual(0)
    expect(result.timings.total_ms).toBeGreaterThanOrEqual(0)
    expect(result.suggestions.length).toBeGreaterThan(0)

    expect(ctx.conversation.recent('de')).toHaveLength(2)
    expect(ctx.sessions.get('de')?.nextIndex).toBe(1)
    expect(ctx.activity.list()).toEqual({ '2026-01-01': 1 })
    expect(ctx.speech.ensureCalls).toBe(1)

    const stages = ctx.telemetry.turnLog.map(t => t.stage)
    expect(stages).toContain('tutor')
    expect(stages).toContain('translation')
    expect(stages).toContain('turn')
  })

  it('appends to the diary in diary mode', async () => {
    const ctx = build()
    await ctx.turns.process({ text: 'Heute war ich im Park.' }, { ...options, diaryMode: true })
    expect(ctx.diary.list('de')).toHaveLength(1)
    expect(ctx.diary.list('de')[0].text).toBe('Heute war ich im Park.')
  })

  it('serializes concurrent turns instead of interleaving them', async () => {
    const ctx = build()
    const [a, b] = await Promise.all([
      ctx.turns.process({ text: 'Erste Nachricht.' }, options),
      ctx.turns.process({ text: 'Zweite Nachricht.' }, options),
    ])
    expect(a.userText).toBe('Erste Nachricht.')
    expect(b.userText).toBe('Zweite Nachricht.')
    expect(ctx.conversation.recent('de')).toHaveLength(4)
  })
})

describe('TurnService guards', () => {
  it('rejects empty input', async () => {
    const ctx = build()
    await expect(ctx.turns.process({}, options)).rejects.toBeInstanceOf(InvalidParameterError)
  })

  it('rejects text above the length limit', async () => {
    const ctx = build()
    await expect(ctx.turns.process({ text: 'x'.repeat(501) }, options)).rejects.toBeInstanceOf(
      InvalidParameterError,
    )
  })

  it('refuses to run before the ASR model is loaded', async () => {
    const ctx = build()
    ctx.asr.loadedKey = null
    await expect(ctx.turns.process({ text: 'Hallo' }, options)).rejects.toBeInstanceOf(ModelsNotReadyError)
  })

  it('refuses to run when a different local model is active', async () => {
    const ctx = build()
    ctx.brain.modelKey = 'another-model'
    await expect(ctx.turns.process({ text: 'Hallo' }, options)).rejects.toBeInstanceOf(ModelsNotReadyError)
  })

})


describe('TurnService free-talk mode', () => {
  function buildFree() {
    const store = new MemoryKeyValue()
    const clock = new FakeClock()
    const bus = new EventBus()
    const ids = new SequentialIdSource(store, clock)
    const conversation = new LocalConversationRepository(store, bus, clock, ids)
    const diary = new LocalDiaryRepository(store, bus, clock, ids)
    const sessions = new LocalSessionRepository(store)
    const activity = new LocalActivityRepository(store, bus, clock)
    const telemetry = new FakeTelemetry()
    const speech = new FakeSpeech()
    const brain = new FakeBrain(messages => {
      const user = messages[messages.length - 1]?.content ?? ''
      return { text: `Конечно! Ты сказал: ${user}`, perf: null }
    })
    const turns = new TurnService({
      brain,
      asr: new FakeAsr(),
      speech,
      conversation,
      diary,
      sessions,
      activity,
      dictionary: { lookup: async () => ({ translations: [], pos: '' }) },
      telemetry,
      clock,
    })
    return { turns, brain, conversation, sessions, telemetry }
  }

  const freeOptions: TurnOptions = {
    level: 'A2',
    targetLang: 'ru',
    uiLang: 'ru',
    llmKey: 'fake-model',
    freeTalk: true,
    speech: { engine: 'phonon', voice: '', phononBase: '' },
  }

  it('answers as a chatbot and does not touch the scenario session', async () => {
    const ctx = buildFree()
    ctx.conversation.addUser('ru', 'Меня зовут Анна.', '')
    ctx.conversation.addTutor('ru', 'Приятно познакомиться!', [], '', '')
    const result = await ctx.turns.process({ text: 'Как дела?' }, freeOptions)
    expect(result.reply).toContain('Как дела?')
    expect(result.corrections).toEqual([])
    expect(result.suggestions).toEqual([])
    expect(ctx.sessions.get('ru')).toBeNull()
    expect(ctx.telemetry.turnLog.some(t => t.stage === 'tutor')).toBe(true)
  })

  it('passes the real dialog history to the model', async () => {
    const ctx = buildFree()
    ctx.conversation.addUser('ru', 'Меня зовут Анна.', '')
    ctx.conversation.addTutor('ru', 'Приятно познакомиться!', [], '', '')
    await ctx.turns.process({ text: 'Как дела?' }, freeOptions)
    const contents = ctx.brain.calls[0].messages.map(m => m.content).join('\n')
    expect(contents).toContain('Меня зовут Анна.')
    expect(contents).toContain('Приятно познакомиться!')
  })
})
