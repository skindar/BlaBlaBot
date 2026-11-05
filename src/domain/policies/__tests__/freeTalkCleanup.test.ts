import { describe, expect, it } from 'vitest'
import { freeTalkFallback, hasAssistantOffer, sameAssistantReply, stripAssistantOffers } from '../freeTalk'

describe('assistant-offer cleanup', () => {
  it('drops the support sentence but keeps the natural answer', () => {
    expect(stripAssistantOffers('Привет! Меня зовут Анна. Как я могу помочь вам сегодня?')).toBe(
      'Привет! Меня зовут Анна.',
    )
  })

  it('handles Russian offer variants', () => {
    expect(stripAssistantOffers('Настроение хорошее. Могу помочь вам с чем-то?')).toBe(
      'Настроение хорошее.',
    )
    expect(stripAssistantOffers('Чем я могу быть полезной?')).toBe('')
    expect(stripAssistantOffers('Рада помочь!')).toBe('')
    expect(stripAssistantOffers('Могу чем-то помочь?')).toBe('')
    expect(stripAssistantOffers('Я всегда готова помочь.')).toBe('')
    expect(stripAssistantOffers('Извините за путаницу! Может, расскажу больше?')).toBe('')
  })

  it('handles English support phrases', () => {
    expect(stripAssistantOffers('Nice to meet you! How can I help you today?')).toBe('Nice to meet you!')
  })

  it('keeps normal conversation intact', () => {
    const text = 'Привет! Я Анна. А тебя как зовут?'
    expect(stripAssistantOffers(text)).toBe(text)
    expect(hasAssistantOffer(text)).toBe(false)
  })

  it('detects a verbatim repeated reply', () => {
    expect(sameAssistantReply('Извините за путаницу!', 'извините за путаницу')).toBe(true)
    expect(sameAssistantReply('Привет!', 'Привет! Как дела?')).toBe(false)
  })

  it('has a target-language fallback', () => {
    expect(freeTalkFallback('ru')).toContain('как дела')
  })
})
