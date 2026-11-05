// Settings defaults and derived values. Pure functions: the browser
// detection lives in the bootstrap layer and is passed in.

import type { Settings, TargetLang, UiLang } from '../models'
import { langInfo, resolvePhononVoice } from './languages'
import { PIPER_VOICES, piperVoiceOrDefault } from './piperVoices'
/** App defaults. The detected UI language and the model catalog defaults are
 *  injected so this policy stays free of infrastructure imports. */
export function defaultSettings(
  uiLang: UiLang,
  defaults: { llmModel: string; asrModel: string },
): Settings {
  return {
    uiLang,
    targetLang: 'de',
    theme: 'system',
    level: 'A2',
    llmModel: defaults.llmModel,
    asrModel: defaults.asrModel,
    ttsEngine: 'phonon',
    ttsVoices: {},
    phononBases: {},
    topics: {},
    ttsSpeed: 1,
    showTranslation: true,
    handsFree: true,
    handsFreePauseMs: 3000,
    extraPrompt: '',
    driveAutoSync: true,
    talkMode: 'scenario',
    freeTalkTemperature: 0.7,
    diaryMode: false,
    showBench: false,
    brain: 'local',
    cloudProfile: 'custom',
    cloudBaseUrl: '',
    cloudApiKey: '',
    cloudModel: '',
  }
}

/** Phonon model base URL for the target language: saved value or the default. */
export function resolvePhononBase(settings: Settings, lang: TargetLang): string {
  return settings.phononBases[lang] || langInfo(lang).phononBase
}

/** Voice for the target language: saved value or the default. For Phonon the
 *  name is validated against what the selected model actually offers — a
 *  stale name (base switched, voice not hosted) falls back to the default. */
export function resolveVoice(settings: Settings, lang: TargetLang): string {
  const saved = settings.ttsVoices[lang]
  if (lang === 'ru' || (PIPER_VOICES[lang]?.length ?? 0) > 0) {
    return piperVoiceOrDefault(lang, saved)
  }
  if (settings.ttsEngine === 'phonon') {
    return resolvePhononVoice(lang, resolvePhononBase(settings, lang), saved)
  }
  return saved ?? ''
}
