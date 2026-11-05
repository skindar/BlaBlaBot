import { describe, expect, it } from 'vitest'
import {
  advanceFullSession,
  ensurePrescribedQuestion,
  looksEnglishDrift,
  polishReply,
  prescribedChips,
  prescribedQuestion,
  runTinyTutorTurn,
  stripTtsJunk,
} from '../tutor'
import type { ChatFunction } from '../../models'
import { SCENARIOS, newSession, nextScenario, scenarioById, selectScenario } from '../scenarios'

const kennenlernen = SCENARIOS.find(s => s.id === 'de-a1-kennenlernen')!

describe('scenario selection and progression', () => {
  it('selects a topic by id', () => {
    expect(selectScenario('de', 'A2', '', 'de-a1-kennenlernen').id).toBe('de-a1-kennenlernen')
  })

  it('selects by free-text keywords', () => {
    expect(selectScenario('de', 'A2', 'Frühstück').id).toBe('de-a1-fruehstueck')
  })

  it('falls back to a language scenario', () => {
    expect(selectScenario('de', 'A2', '').lang).toBe('de')
  })

  it('resolves a scenario by id and rotates', () => {
    expect(scenarioById('de-a1-kennenlernen')?.id).toBe('de-a1-kennenlernen')
    expect(scenarioById('missing') ?? null).toBeNull()
    expect(nextScenario(kennenlernen).id).not.toBe(kennenlernen.id)
  })

  it('starts a session at turn 0 and advances', () => {
    const session = newSession(kennenlernen, '')
    expect(prescribedQuestion(kennenlernen, session)).toBe(kennenlernen.turns[0].question)
    const next = advanceFullSession(kennenlernen, session)
    expect(next.nextIndex).toBe(1)
  })

  it('exposes canonical chips for the current turn', () => {
    const session = newSession(kennenlernen, '')
    const chips = prescribedChips(kennenlernen, session)
    expect(chips.length).toBe(kennenlernen.turns[0].chips.length)
    expect(chips.every(c => typeof c.text === 'string' && c.text.length > 0)).toBe(true)
  })
})

describe('reply polishing', () => {
  it('strips markdown, emoji and wrapping quotes', () => {
    expect(stripTtsJunk('**Hallo** 🎉 «Welt»')).toBe('Hallo Welt')
  })

  it('keeps exactly one question', () => {
    const out = polishReply('Hallo! Wie geht es dir? Und dir?', { maxWords: 40 })
    expect(out.match(/\?/g)).toHaveLength(1)
    expect(out.endsWith('Und dir?')).toBe(true)
  })

  it('appends the prescribed question only when the model asked nothing', () => {
    expect(ensurePrescribedQuestion('Super gemacht!', 'Wie heißt du?')).toBe(
      'Super gemacht! Wie heißt du?',
    )
    expect(ensurePrescribedQuestion('Super! Wie heißt du?', 'Wie geht es dir?')).toBe(
      'Super! Wie heißt du?',
    )
  })

  it('detects English drift in a German lesson', () => {
    expect(looksEnglishDrift('I would like to order the coffee please', 'de')).toBe(true)
    expect(looksEnglishDrift('Ich möchte bitte einen Kaffee', 'de')).toBe(false)
    expect(looksEnglishDrift('I would like coffee', 'en')).toBe(false)
  })
})

describe('tiny-tier turn routing (the loop bug)', () => {
  const vyhodnye = scenarioById('ru-a2-vyhodnye')!
  const sessionAtTurnTwo = {
    ...newSession(vyhodnye, ''),
    nextIndex: 1,
    lastQuestion: vyhodnye.turns[0].question,
  }
  const chat: ChatFunction = async () => ({ text: 'Здорово!', perf: null })

  it('advances when the answer also ends with a counter-question', async () => {
    const plan = await runTinyTutorTurn({
      chat,
      userText: 'Я гулял с друзьями, а ты?',
      level: 'A2',
      targetLang: 'ru',
      extraPrompt: '',
      scenario: vyhodnye,
      session: sessionAtTurnTwo,
      corrections: [],
    })
    expect(plan.move).toBe('advance')
    expect(plan.session.nextIndex).toBe(2)
    expect(plan.question).toBe(vyhodnye.turns[1].question)
  })

  it('does not treat a mid-sentence "как" as a question to the tutor', async () => {
    const plan = await runTinyTutorTurn({
      chat,
      userText: 'Ну я же сказал, как в предыдущем: я гулял с друзьями.',
      level: 'A2',
      targetLang: 'ru',
      extraPrompt: '',
      scenario: vyhodnye,
      session: sessionAtTurnTwo,
      corrections: [],
    })
    expect(plan.move).toBe('advance')
    expect(plan.session.nextIndex).toBe(2)
  })

  it('still answers a pure question without advancing', async () => {
    const plan = await runTinyTutorTurn({
      chat,
      userText: 'А что ты любишь готовить?',
      level: 'A2',
      targetLang: 'ru',
      extraPrompt: '',
      scenario: vyhodnye,
      session: sessionAtTurnTwo,
      corrections: [],
    })
    expect(plan.move).toBe('answer')
    expect(plan.session.nextIndex).toBe(1)
    expect(plan.reply).toContain('?')
  })

  it('rejects a decoder-loop reaction (repeated token)', async () => {
    const loopChat: ChatFunction = async () => ({
      text: 'Гулять — неуместное, неуместное, неуместное, неуместное, неуместное.',
      perf: null,
    })
    const plan = await runTinyTutorTurn({
      chat: loopChat,
      userText: 'Поговорим о погоде.',
      level: 'A2',
      targetLang: 'ru',
      extraPrompt: '',
      scenario: vyhodnye,
      session: sessionAtTurnTwo,
      corrections: [],
    })
    expect(plan.reply).not.toContain('неуместное')
  })

  it('rotates the scenario when the student asks for another topic', async () => {
    const plan = await runTinyTutorTurn({
      chat,
      userText: 'Давай поговорим о чём-то другом.',
      level: 'A2',
      targetLang: 'ru',
      extraPrompt: '',
      scenario: vyhodnye,
      session: sessionAtTurnTwo,
      corrections: [],
    })
    expect(plan.move).toBe('advance')
    expect(plan.session.scenarioId).not.toBe(vyhodnye.id)
    expect(plan.session.nextIndex).toBe(1)
  })

  it('rejects a wrong-script reaction and uses the curated template floor', async () => {
    const badChat: ChatFunction = async () => ({
      text: 'Поговорим о чему khác, я не интересен',
      perf: null,
    })
    const plan = await runTinyTutorTurn({
      chat: badChat,
      userText: 'Поговорим о погоде.',
      level: 'A2',
      targetLang: 'ru',
      extraPrompt: '',
      scenario: vyhodnye,
      session: sessionAtTurnTwo,
      corrections: [],
    })
    expect(plan.reply).not.toContain('khác')
    expect(plan.move).toBe('stay')
  })
})
