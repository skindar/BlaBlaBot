import { describe, expect, it } from 'vitest'
import { shouldDiscardRecording } from '../recorderPolicy'

describe('shouldDiscardRecording', () => {
  it('discards silence when the meter is active', () => {
    expect(shouldDiscardRecording(true, false)).toBe(true)
  })

  it('keeps a recording with confirmed speech', () => {
    expect(shouldDiscardRecording(true, true)).toBe(false)
  })

  it('cannot judge without a meter', () => {
    expect(shouldDiscardRecording(false, false)).toBe(false)
  })
})
