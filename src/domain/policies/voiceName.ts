// The free-talk persona follows the selected TTS voice: if the picker says
// "Ирина"/"Денис"/"Annika", that is the name the model should use. A profile
// is just a voice here — no hardcoded "Anna" for every language.

import type { TargetLang, TtsEngineKind } from '../models'
import { PIPER_VOICES } from './piperVoices'

const FALLBACK_NAME = 'Alex'

function nameFromSystemUri(uri: string): string {
  // macOS: com.apple.voice.compact.ru-RU.Milena
  // Windows/Chrome: "Microsoft Irina - Russian (Russia)"
  const tail = uri.split('.').pop() ?? uri
  const beforeDash = tail.split(/\s+-\s+/)[0]
  return beforeDash
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^(Microsoft|Google|Apple)\s+/i, '')
    .trim()
}

/** Human name for the current voice, used by the universal free-talk prompt.
 *  Piper labels are already localized (Ирина, Денис); Phonon names are human
 *  names; a system voice URI is best-effort parsed. */
export function tutorNameForVoice(lang: TargetLang, voice: string, engine: TtsEngineKind): string {
  const piper = PIPER_VOICES[lang]?.find(v => v.id === voice)
  if (piper) return piper.label
  if (engine === 'phonon' && voice && !/^(default)$/i.test(voice)) return voice
  if (engine === 'system' && voice) {
    const parsed = nameFromSystemUri(voice)
    if (parsed) return parsed
  }
  return FALLBACK_NAME
}
