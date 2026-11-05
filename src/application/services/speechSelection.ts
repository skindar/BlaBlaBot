// Speech selection derived from settings — one place that knows how a
// language, engine and saved voice turn into what the speech adapter needs.

import type { SpeechSelection } from '../ports'
import type { Settings, TargetLang } from '../../domain/models'
import { resolvePhononBase, resolveVoice } from '../../domain/policies/settings'

export function speechSelectionFor(settings: Settings, lang: TargetLang = settings.targetLang): SpeechSelection {
  return {
    engine: settings.ttsEngine,
    voice: resolveVoice(settings, lang),
    phononBase: resolvePhononBase(settings, lang),
  }
}
