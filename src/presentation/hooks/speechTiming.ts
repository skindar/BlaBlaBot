/** Safety net for a speech promise that never settles (autoplay policy, a
 *  voice swap, a host without an audio device). It must cover synthesis +
 *  playback: cold Piper/Phonon can spend several seconds generating before
 *  the first sound reaches the speakers. */
export function speechWatchdogMs(text: string, rate: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const estimatedPlaybackMs = (words * 500) / Math.max(0.5, rate)
  return Math.max(30_000, estimatedPlaybackMs + 15_000)
}
