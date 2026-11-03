// Audio preparation instead of the native version's ffmpeg conversion:
// Blob (webm/opus | mp4/aac) → AudioContext.decodeAudioData →
// OfflineAudioContext 16 kHz mono → Float32Array for whisper.
// Plus a port of the energy VAD from backend/models/asr.py.

export const FRAME_MS = 30
export const MIN_SPEECH_MS = 250
export const TARGET_SR = 16000

export interface VadResult {
  isSpeech: boolean
  speechMs: number
  audioMs: number
  peakDb: number
  thresholdDb: number
}

export class EmptyAudioError extends Error {}
export class BadAudioError extends Error {}

/** Decode a microphone recording into mono Float32 @ 16 kHz */
export async function decodeBlobToPcm16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const AudioCtx: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  let ctx: AudioContext | null = null
  try {
    ctx = new AudioCtx()
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
    // Resample to 16 kHz mono via OfflineAudioContext (the browser's interpolation)
    const frames = Math.max(1, Math.ceil((decoded.duration * TARGET_SR) | 0) || 1)
    const offline = new OfflineAudioContext(1, frames, TARGET_SR)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    return rendered.getChannelData(0).slice()
  } catch (err) {
    throw new BadAudioError(
      `Не удалось декодировать запись: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    void ctx?.close().catch(() => undefined)
  }
}

function frameDb(samples: Float32Array, sr: number, frameMs: number): { dbs: number[]; frameLen: number } {
  const frameLen = Math.floor((sr * frameMs) / 1000)
  const nFrames = frameLen > 0 ? Math.floor(samples.length / frameLen) : 0
  const dbs: number[] = new Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    let sum = 0
    const off = i * frameLen
    for (let j = 0; j < frameLen; j++) {
      const v = samples[off + j]
      sum += v * v
    }
    const rms = Math.sqrt(sum / frameLen)
    dbs[i] = 20 * Math.log10(rms + 1e-10)
  }
  return { dbs, frameLen }
}

/** Port of detect_speech: adaptive threshold max(-50 dB, peak − 35 dB) */
export function detectSpeech(samples: Float32Array, sr: number): VadResult {
  const audioMs = (samples.length / sr) * 1000
  const { dbs } = frameDb(samples, sr, FRAME_MS)
  if (dbs.length === 0) {
    return { isSpeech: false, speechMs: 0, audioMs, peakDb: -120, thresholdDb: -45 }
  }
  let peakDb = -Infinity
  for (const db of dbs) if (db > peakDb) peakDb = db
  const thresholdDb = Math.max(-50, peakDb - 35)
  const loudFrames = dbs.reduce((acc, db) => acc + (db > thresholdDb ? 1 : 0), 0)
  const speechMs = loudFrames * FRAME_MS
  const isSpeech = speechMs >= MIN_SPEECH_MS && peakDb > -40
  return { isSpeech, speechMs, audioMs, peakDb, thresholdDb }
}

/** Port of trim_silence: trim edge silence with 120 ms padding */
export function trimSilence(samples: Float32Array, vad: VadResult, sr: number, padMs = 120): Float32Array {
  const { dbs } = frameDb(samples, sr, FRAME_MS)
  if (dbs.length === 0) return samples
  let first = -1
  let last = -1
  for (let i = 0; i < dbs.length; i++) {
    if (dbs[i] > vad.thresholdDb) {
      if (first === -1) first = i
      last = i
    }
  }
  if (first === -1) return samples
  const padFrames = Math.ceil(padMs / FRAME_MS)
  const startFrame = Math.max(0, first - padFrames)
  const endFrame = Math.min(dbs.length - 1, last + padFrames)
  const frameLen = Math.floor((sr * FRAME_MS) / 1000)
  return samples.slice(startFrame * frameLen, (endFrame + 1) * frameLen)
}
