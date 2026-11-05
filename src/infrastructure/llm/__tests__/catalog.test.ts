import { describe, expect, it } from 'vitest'
import { samplingForModel } from '../catalog'

describe('samplingForModel', () => {
  it('uses the Qwen2.5 generation_config values', () => {
    expect(samplingForModel('Qwen2.5-1.5B-Instruct-q4f16_1-MLC')).toEqual({
      temperature: 0.7,
      topP: 0.8,
      repetitionPenalty: 1.1,
    })
  })

  it('keeps neutral defaults for other families', () => {
    expect(samplingForModel('gemma3-1b-it-q4f16_1-MLC')).toEqual({
      topP: 0.9,
      repetitionPenalty: 1.0,
    })
  })
})
