// Piper voices are static data: the picker must work offline, before any
// engine is downloaded. Lives in the domain so settings resolution stays
// framework- and adapter-free.

import type { TargetLang } from '../models'

export interface PiperVoice {
  /** voice id used by the engine and by the voice picker */
  id: string
  label: string
}

/** Voices per target language. Only languages Phonon cannot speak live here. */
export const PIPER_VOICES: Partial<Record<TargetLang, PiperVoice[]>> = {
  ru: [
    { id: 'ru_RU-irina-medium', label: 'Ирина' },
    { id: 'ru_RU-denis-medium', label: 'Денис' },
    { id: 'ru_RU-dmitri-medium', label: 'Дмитрий' },
    { id: 'ru_RU-ruslan-medium', label: 'Руслан' },
  ],
}

export function piperVoiceOrDefault(lang: TargetLang, voice?: string): string {
  const list = PIPER_VOICES[lang] ?? []
  if (voice && list.some(v => v.id === voice)) return voice
  return list[0]?.id ?? ''
}
