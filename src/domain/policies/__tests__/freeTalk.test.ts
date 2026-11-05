import { describe, expect, it } from 'vitest'
import { buildFreeTalkMessages } from '../prompts'

describe('buildFreeTalkMessages', () => {
  it('builds a lean plain-text chat prompt with the history', () => {
    const messages = buildFreeTalkMessages(
      [
        { role: 'user', content: 'Меня зовут Анна.' },
        { role: 'assistant', content: 'Приятно познакомиться, Анна!' },
      ],
      'Как дела?',
      'A2',
      'ru',
      'ru',
      'Ирина',
      'Будь дружелюбной.',
    )
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Ирина')
    expect(messages[0].content).toContain('NOT an AI assistant')
    expect(messages[0].content).not.toContain('strict JSON')
    expect(messages[0].content).toContain('Будь дружелюбной.')
    expect(messages).toHaveLength(4)
    expect(messages[3]).toEqual({ role: 'user', content: 'Как дела?' })
  })

  it('does not contradict itself for an English target', () => {
    const messages = buildFreeTalkMessages([], 'Hello', 'A2', 'en', 'ru', 'Alex')
    expect(messages[0].content).toContain('Answer ONLY in natural conversational English')
    expect(messages[0].content).not.toContain('Never answer in English')
  })

  it('adds a hard language rule on the retry', () => {
    const messages = buildFreeTalkMessages([], 'Hello', 'A1', 'de', 'ru', 'Alex', '', true)
    expect(messages[0].content).toContain('CRITICAL')
    expect(messages[0].content).toContain('German')
  })
})


describe('universal free-talk persona name', () => {
  it('uses the selected voice name instead of a fixed Anna persona', () => {
    const messages = buildFreeTalkMessages([], 'Hi', 'A2', 'de', 'ru', 'Annika')
    expect(messages[0].content).toContain('You are Annika')
    expect(messages[0].content).not.toContain('Anna')
    expect(messages[0].content).not.toContain('Moscow')
  })
})

describe('tutor prompt persona', () => {
  it('uses the voice name in the scenario tutor prompt', async () => {
    const { buildTutorMessages } = await import('../prompts')
    const messages = buildTutorMessages([], 'Hallo', 'A2', 'de', 'ru', '', false, {
      block: '',
      tutorName: 'Annika',
    })
    expect(messages[0].content).toContain('You are Annika')
  })
})
