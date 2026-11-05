/** A recording may become a turn only when the live meter confirmed real
 *  speech (≥250 ms over the threshold). Silence and short clacks must be
 *  discarded, otherwise Whisper hallucinates lines like "Делаем на письмо."
 *  on the empty audio. If no meter exists we cannot judge, so keep the turn. */
export function shouldDiscardRecording(meterActive: boolean, speechDetected: boolean): boolean {
  return meterActive && !speechDetected
}
