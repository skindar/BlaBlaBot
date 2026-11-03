// Target languages: everything that depends on the learned language in one place —
// default Phonon models, voices, articles, offline dictionary, Whisper/TTS codes.

import type { UiLang } from '../i18n'

export type TargetLang = 'de' | 'en' | 'fr' | 'es' | 'pt'

export interface TargetLangInfo {
  code: TargetLang
  /** BCP-47 for system voices and html lang */
  bcp47: string
  nativeName: string
  nameRu: string
  nameEn: string
  flag: string
  /** language code for Whisper */
  whisper: string
  /** default Phonon model files URL (overridable in settings) */
  phononBase: string
  /** model can load straight from HF without self-hosting */
  phononPublic: boolean
  /** language has an offline dictionary (deu-rus exists for German only) */
  hasOfflineDict: boolean
  /** nouns take an article (affects prompts and word normalization) */
  usesArticles: boolean
  /** informal address for the tutor prompt */
  informalAddress: string
  /** article hint for the dictionary prompt */
  articleHint: string
}

export const TARGET_LANGS: Record<TargetLang, TargetLangInfo> = {
  de: {
    code: 'de',
    bcp47: 'de-DE',
    nativeName: 'Deutsch',
    nameRu: 'Немецкий',
    nameEn: 'German',
    flag: '🇩🇪',
    whisper: 'de',
    phononBase: '/models/phonon-40m-de/',
    phononPublic: false, // gradium/phonon-40m-de is gated on HF — files must be hosted separately
    hasOfflineDict: true,
    usesArticles: true,
    informalAddress: 'use informal "du"',
    articleHint: 'keep the article for nouns (der/die/das)',
  },
  en: {
    code: 'en',
    bcp47: 'en-US',
    nativeName: 'English',
    nameRu: 'Английский',
    nameEn: 'English',
    flag: '🇬🇧',
    whisper: 'en',
    phononBase: 'hf://gradium/phonon-31m-en',
    phononPublic: true, // public Phonon 31m model (Apache 2.0) — works out of the box
    hasOfflineDict: false,
    usesArticles: false,
    informalAddress: 'speak casually',
    articleHint: 'use the base dictionary form',
  },
  fr: {
    code: 'fr',
    bcp47: 'fr-FR',
    nativeName: 'Français',
    nameRu: 'Французский',
    nameEn: 'French',
    flag: '🇫🇷',
    whisper: 'fr',
    phononBase: '/models/phonon-40m-fr/',
    phononPublic: false, // gated — files must be hosted (locally or via GitHub Release)
    hasOfflineDict: false,
    usesArticles: true,
    informalAddress: 'use informal "tu"',
    articleHint: 'keep the article for nouns (le/la/les)',
  },
  es: {
    code: 'es',
    bcp47: 'es-ES',
    nativeName: 'Español',
    nameRu: 'Испанский',
    nameEn: 'Spanish',
    flag: '🇪🇸',
    whisper: 'es',
    phononBase: '/models/phonon-40m-es/',
    phononPublic: false,
    hasOfflineDict: false,
    usesArticles: true,
    informalAddress: 'use informal "tú"',
    articleHint: 'keep the article for nouns (el/la)',
  },
  pt: {
    code: 'pt',
    bcp47: 'pt-BR',
    nativeName: 'Português',
    nameRu: 'Португальский',
    nameEn: 'Portuguese',
    flag: '🇧🇷',
    whisper: 'pt',
    phononBase: '/models/phonon-40m-pt/',
    phononPublic: false,
    hasOfflineDict: false,
    usesArticles: true,
    informalAddress: 'use informal "você"',
    articleHint: 'keep the article for nouns (o/a)',
  },
}

export const TARGET_LANG_LIST: TargetLang[] = ['de', 'en', 'fr', 'es', 'pt']

export function isTargetLang(v: string): v is TargetLang {
  return v in TARGET_LANGS
}

export function langInfo(lang: TargetLang): TargetLangInfo {
  return TARGET_LANGS[lang]
}

/** Target language name in the UI language */
export function langName(lang: TargetLang, uiLang: UiLang): string {
  const info = TARGET_LANGS[lang]
  return uiLang === 'en' ? info.nameEn : info.nameRu
}

/** Target language name for prompts (always English) */
export function langNameForPrompt(lang: TargetLang): string {
  return TARGET_LANGS[lang].nameEn
}

/** UI language name for prompts (always English) */
export function uiLangNameForPrompt(lang: UiLang): string {
  return lang === 'en' ? 'English' : 'Russian'
}

// ---------- Phonon voices ----------

export interface PhononVoiceInfo {
  name: string
  /** voice file URL (.safetensors) */
  url: string
}

// Voices from the gradium/phonon-voices catalog — Phonon S format (31M),
// compatible with 31m models only (English). Public files, cached by the browser.
const CATALOG_BASE = 'https://huggingface.co/gradium/phonon-voices/resolve/main/voices'
const CATALOG_VOICES_31M: Record<'en', Array<[name: string, id: string]>> = {
  en: [
    ['Zoey', 'NbpkqMVS3CJeq2j8'],
    ['Juniper', 'NIWIOv5vTi5eRMj8'],
    ['Everly', 'vjFyp2BcCyTlUmYb'],
    ['Harper', '4SZHfMpw-p46Ywgs'],
    ['Hadley', 'bXwrkHhURL1VFJdG'],
    ['Delia', 'nGzMHMPAWGaJFHOo'],
    ['Maeve', '6PWnV0Nq4wu7RVBT'],
    ['Freya', 'GgfEkEJtxZR7gnpy'],
    ['Pippa', 'uem82D50GRv2Dwma'],
    ['Elodie-Rose', 'y9bQqIDnyxwqK01t'],
    ['Imogen', 'gDT1nz7Ie36ZhL-C'],
    ['Lottie', 'm9MxpY6IUGXtWp76'],
    ['Bryony', 'gfP44RlHwr2kEwk7'],
    ['Easton', 'LMDIYE0Oa377Qh6Z'],
    ['Micah', '40QrMVgAxFiUnP9f'],
    ['Trevor', '0zLApsZfVLLNaEGl'],
    ['Russell', '_6Aslh2DxfmnRLmP'],
    ['Preston', 'qIxlZ7Ei8KvWlyQH'],
    ['Miles', 'd9XCyhjo4JhkHF1d'],
    ['Alfie', 'X6NceqF285Gr04gb'],
    ['Hugh', 'YyKcxPG7iIgS3jsK'],
    ['Edwin', 'zUCxzrOrugTSis03'],
    ['Spencer', 'JOW0vchyswkQUMDS'],
    ['Toby', 'dME3IWyZBvmh1n1q'],
    ['Teddy', 'Zn7g6NxLqXlJb7Qi'],
  ],
}

// Local German voices (hosted next to the phonon-40m-de model)
const DE_VOICES = [
  'Annika', 'Anton', 'Henrik', 'Jette', 'Josefine', 'Jule',
  'Leon', 'Lotta', 'Mats', 'Mika', 'Mirko', 'Nele', 'Svea',
] as const

function withSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Phonon voice list per language:
 *  • de — 13 local voices next to the model (as before);
 *  • en — gradium/phonon-voices catalog (31M format);
 *  • fr/es/pt — default-voice from the hosting folder (40m ships a single voice).
 * Plus "Default" for everything except de (default-voice.safetensors from base).
 */
export function phononVoices(lang: TargetLang, base: string): PhononVoiceInfo[] {
  const b = withSlash(base)
  const voices: PhononVoiceInfo[] = []
  if (lang === 'de') {
    for (const name of DE_VOICES) voices.push({ name, url: `${b}voice-${name}.safetensors` })
    return voices
  }
  if (lang === 'en' && base.startsWith('hf://gradium/phonon-31m-en')) {
    // Default voice of the public 31m model + the 31M voice catalog
    voices.push({
      name: 'Default',
      url: 'https://huggingface.co/gradium/phonon-31m-en/resolve/main/default-voice.safetensors',
    })
    for (const [name, id] of CATALOG_VOICES_31M.en) {
      voices.push({ name, url: `${CATALOG_BASE}/${id}.safetensors` })
    }
    return voices
  }
  // Custom base (release/mirror) or fr/es/pt: default-voice next to the model
  voices.push({ name: 'Default', url: `${b}default-voice.safetensors` })
  return voices
}

export function defaultPhononVoice(lang: TargetLang): string {
  if (lang === 'de') return 'Annika'
  if (lang === 'en') return 'Zoey'
  return 'Default'
}

/** Whether the model source is reachable (probes config.json; hf:// is checked by the load itself) */
export async function probePhononBase(base: string): Promise<boolean> {
  if (base.startsWith('hf://')) return true
  try {
    const res = await fetch(`${withSlash(base)}config.json`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}
