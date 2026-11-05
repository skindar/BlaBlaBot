import { describe, expect, it } from 'vitest'
import { speechWatchdogMs } from '../speechTiming'

describe('speechWatchdogMs', () => {
  it('covers a cold Piper synthesis plus a short reply', () => {
    // 8 words: ~4 s of playback; the old 8 s cap cut it after cold synthesis.
    expect(speechWatchdogMs('Привет! Как я могу помочь вам сегодня?', 1)).toBeGreaterThanOrEqual(30_000)
  })

  it('grows with a long reply and slows down with a lower rate', () => {
    const text = Array.from({ length: 80 }, () => 'слово').join(' ')
    expect(speechWatchdogMs(text, 1)).toBeGreaterThan(50_000)
    expect(speechWatchdogMs(text, 0.5)).toBeGreaterThan(speechWatchdogMs(text, 1))
  })

  it('never goes below the synthesis floor', () => {
    expect(speechWatchdogMs('Да', 1)).toBe(30_000)
  })
})
