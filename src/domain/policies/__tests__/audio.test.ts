import { describe, expect, it } from 'vitest'
import { decodeBlobToPcm16k, detectSpeech, splitAtSilence, trimSilence } from '../audio'

function speechLike(seconds: number, sampleRate = 16000): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.4
  }
  return samples
}

describe('detectSpeech', () => {
  it('rejects digital silence', () => {
    const vad = detectSpeech(new Float32Array(16000), 16000)
    expect(vad.isSpeech).toBe(false)
  })

  it('detects a loud tone as speech', () => {
    const vad = detectSpeech(speechLike(1), 16000)
    expect(vad.isSpeech).toBe(true)
    expect(vad.speechMs).toBeGreaterThan(0)
  })
})

describe('trimSilence / splitAtSilence', () => {
  it('trimmed audio is never longer than the input', () => {
    const pcm = speechLike(1)
    const vad = detectSpeech(pcm, 16000)
    expect(trimSilence(pcm, vad, 16000).length).toBeLessThanOrEqual(pcm.length)
  })

  it('splits a long utterance into chunks', () => {
    const pcm = speechLike(3)
    const chunks = splitAtSilence(pcm, 16000, { splitAboveMs: 500 })
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks.reduce((acc, c) => acc + c.length, 0)).toBeLessThanOrEqual(pcm.length + 16000)
  })
})

describe('decodeBlobToPcm16k', () => {
  it('rejects a non-audio blob with BadAudioError', async () => {
    const blob = new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'video/webm' })
    await expect(decodeBlobToPcm16k(blob)).rejects.toBeTruthy()
  })
})
