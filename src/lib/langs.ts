// Target languages: everything that depends on the learned language in one place —
// default Phonon models, voices, articles, offline dictionary, Whisper/TTS codes.

import type { UiLang } from '../i18n'

export type TargetLang = 'de' | 'en' | 'fr' | 'es' | 'pt'

// ---------- Public Phonon sources on Hugging Face ----------
// Commits are pinned so a browser-cached download can never drift when the
// repo above it changes (the same thing phonon-tts's hf:// loader does).

const HF = 'https://huggingface.co'

/** Public byte-for-byte mirror of gradium/phonon-40m-multilingual
 *  (en/fr/de/es/pt, weights CC BY-NC 4.0). Gradium's own repo is gated
 *  (auto — needs an accepted HF account), so a visitor's browser cannot
 *  fetch it; this copy loads anonymously. */
const MULTILINGUAL_REPO = 'empyrealworks/Phonon-40M-multilingual'
const MULTILINGUAL_SHA = '9eedfd90e9a06a2e4a47dc57473b2997f155c005'
export const MULTILINGUAL_BASE = `hf://${MULTILINGUAL_REPO}`

/** The public English model (Apache 2.0) — works out of the box. */
const PHONON_31M_EN_REPO = 'gradium/phonon-31m-en'
const PHONON_31M_EN_SHA = '92741c5b07d085ff840e26fea8ce43110b87852f'
export const PHONON_31M_EN_BASE = `hf://${PHONON_31M_EN_REPO}`

/** The public voice catalog (Apache 2.0): 102 voices across all five
 *  languages — the flat voices/<id>.safetensors files work with every
 *  Phonon model size (31m/40m/56m/98m, format ba7a5a45@300). */
const VOICES_REPO = 'gradium/phonon-voices'
const VOICES_SHA = '0ee17205f254b5abc43b266c8a0f215565c352f7'

/** File URL pinned to a commit inside one of the repos above */
function hfFile(repo: string, sha: string, file: string): string {
  return `${HF}/${repo}/resolve/${sha}/${file}`
}

/** Catalog voice file by its id (e.g. 'p6Uutkyi3j2iNAUu' = Annika) */
export function catalogVoiceUrl(id: string): string {
  return `${HF}/${VOICES_REPO}/resolve/${VOICES_SHA}/voices/${id}.safetensors`
}

export function multilingualFile(file: string): string {
  return hfFile(MULTILINGUAL_REPO, MULTILINGUAL_SHA, file)
}

export function phonon31mEnFile(file: string): string {
  return hfFile(PHONON_31M_EN_REPO, PHONON_31M_EN_SHA, file)
}

export function isHfUrl(base: string): boolean {
  return base.startsWith('hf://')
}

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
    // Dedicated German model: local files in dev, self-hosted (GitHub
    // Release) in prod — see scripts/publish-phonon.sh. Unreachable bases
    // fall back to MULTILINGUAL_BASE automatically (ttsPhonon.ts).
    phononBase: '/models/phonon-40m-de/',
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
    phononBase: PHONON_31M_EN_BASE,
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
    // gradium/phonon-40m-fr is gated on HF; the public multilingual model
    // covers French out of the box
    phononBase: MULTILINGUAL_BASE,
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
    phononBase: MULTILINGUAL_BASE,
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
    phononBase: MULTILINGUAL_BASE,
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

/** What the tutor says when the model output could not be parsed at all —
 *  per target language (parse.ts falls back to it) */
export const TUTOR_FALLBACK: Record<TargetLang, string> = {
  de: 'Entschuldigung, das habe ich nicht verstanden.',
  en: "Sorry, I didn't understand that.",
  fr: "Désolé, je n'ai pas compris.",
  es: 'Perdona, no lo he entendido.',
  pt: 'Desculpa, não entendi.',
}

// ---------- Tutor scaffold: per-language dialog mechanics ----------

/** Target-language wh-words (wie/was/quoi/cómo/…): used both by the
 *  translation sanity checks and to detect that the student asked a
 *  question (engine.ts + tutor.ts). */
export const TARGET_WH_RE: Record<TargetLang, RegExp> = {
  de: /(^|\s)(wie|was|wo|wann|warum|weshalb|wieso|wozu|welche[rsmn]?|wer|wieviel[e]?)(?=\W|$)/i,
  en: /(^|\s)(what|which|who|when|where|why|how)(?=\W|$)/i,
  fr: /(^|\s)(comment|quoi|o[uù]|quand|pourquoi|quel(le|le|s)?|qui|combien)(?=\W|$)/i,
  es: /(^|\s)(c[oó]mo|qu[eé]|d[oó]nde|cu[aá]ndo|cu[aá]l|qui[eé]n|cu[aá]nto)(?=\W|$)/i,
  pt: /(^|\s)(como|que|onde|quando|qual|quem|quanto)(?=\W|$)/i,
}

/** "The student says goodbye" — end the lesson politely, no new question */
export const FAREWELL_RE: Record<TargetLang, RegExp> = {
  de: /\b(tschüss|wiedersehen|bis bald|bis dann|gute nacht)\b/i,
  en: /\b(bye|goodbye|see you|good night|farewell)\b/i,
  fr: /\b(au revoir|[àa] bient[ôo]t|bonne nuit)\b/i,
  es: /\b(adi[óo]s|hasta luego|hasta ma[ñn]ana|buenas noches)\b/i,
  pt: /\b(tchau|adeus|até logo|boa noite)\b/i,
}

/** "The student opens with a greeting" — greet back, then the first question */
export const GREETING_RE: Record<TargetLang, RegExp> = {
  de: /^\s*(hallo|hi|hey|moin|servus|guten\s+(tag|morgen|abend))\b/i,
  en: /^\s*(hi|hello|hey|good\s+(morning|afternoon|evening))\b/i,
  fr: /^\s*(salut|bonjour|coucou)\b/i,
  es: /^\s*(hola|buenas|buenos\s+d[ií]as)\b/i,
  pt: /^\s*(ol[áa]|oi|bom\s+dia|boa\s+(tarde|noite))\b/i,
}

/** "My name is X" — the student introduced themselves */
export const INTRO_RE: Record<TargetLang, RegExp> = {
  de: /\b(?:mein\s+name\s+ist|ich\s+hei[ßs]e)\s+([A-ZÄÖÜ][\p{L}-]+)/iu,
  en: /\b(?:my\s+name\s+is|i\s+am|i'm)\s+([A-Z][\p{L}-]+)/iu,
  fr: /\b(?:je\s+m'appelle|mon\s+nom\s+est|je\s+suis)\s+([A-ZÀ-Þ][\p{L}-]+)/iu,
  es: /\b(?:me\s+llamo|mi\s+nombre\s+es|soy)\s+([A-ZÁ-ÚÑ][\p{L}-]+)/iu,
  pt: /\b(?:meu\s+nome\s+[ée]|chamo-me|eu\s+sou\s+o|eu\s+sou)\s+([A-ZÁ-ÚÃ][\p{L}-]+)/iu,
}

/** Deterministic reaction to an introduction — never trust a 1B model with it */
export const INTRO_REACTION: Record<TargetLang, string> = {
  de: 'Freut mich, {name}!',
  en: 'Nice to meet you, {name}!',
  fr: 'Enchanté, {name} !',
  es: '¡Mucho gusto, {name}!',
  pt: 'Prazer em conhecer você, {name}!',
}

export const INTRO_REACTION_TR: Record<TargetLang, { ru: string; en: string }> = {
  de: { ru: 'Приятно познакомиться, {name}!', en: 'Nice to meet you, {name}!' },
  en: { ru: 'Приятно познакомиться, {name}!', en: 'Nice to meet you, {name}!' },
  fr: { ru: 'Приятно познакомиться, {name}!', en: 'Nice to meet you, {name}!' },
  es: { ru: 'Приятно познакомиться, {name}!', en: 'Nice to meet you, {name}!' },
  pt: { ru: 'Приятно познакомиться, {name}!', en: 'Nice to meet you, {name}!' },
}

/** Questions that ask for the student's name (any language mix) */
export const NAME_QUESTION_RE = /name|hei[ßs]t|appelle|llamo|nome|зват/i

export const TUTOR_FAREWELL: Record<TargetLang, string> = {
  de: 'Tschüss! Es war schön, mit dir zu sprechen. Bis bald!',
  en: 'Bye! It was great talking to you. See you soon!',
  fr: 'Au revoir ! C’était super de parler avec toi. À bientôt !',
  es: '¡Adiós! Fue genial hablar contigo. ¡Hasta pronto!',
  pt: 'Tchau! Foi ótimo falar com você. Até logo!',
}

/** Fixed translations of the deterministic farewell: translating a constant
 *  again wastes a call, and the 1B model maps the short farewell to a
 *  greeting ("Tschüss!" -> "Здравствуйте!"). */
export const TUTOR_FAREWELL_TRANSLATION: Record<TargetLang, Record<'ru' | 'en', string>> = {
  de: {
    ru: 'Пока! Было приятно с тобой поговорить. До скорого!',
    en: 'Bye! It was nice talking to you. See you soon!',
  },
  en: {
    ru: 'Пока! Было приятно с тобой поговорить. До скорого!',
    en: 'Bye! It was nice talking to you. See you soon!',
  },
  fr: {
    ru: 'Пока! Было здорово с тобой поговорить. До скорого!',
    en: 'Bye! It was great talking to you. See you soon!',
  },
  es: {
    ru: 'Пока! Было здорово с тобой поговорить. До скорого!',
    en: 'Bye! It was great talking to you. See you soon!',
  },
  pt: {
    ru: 'Пока! Было очень приятно поговорить. До скорого!',
    en: 'Bye! It was great talking to you. See you soon!',
  },
}

/** Negation words — pick the "negative" reaction template */
export const NEGATION_RE: Record<TargetLang, RegExp> = {
  de: /\b(nicht|kein\w*|nie|mals|leider)\b/i,
  en: /\b(not|no|never|nothing)\b/i,
  fr: /\b(ne|pas|jamais|rien|non)\b/i,
  es: /\b(no|nunca|nada)\b/i,
  pt: /\b(n[ãa]o|nunca|nada)\b/i,
}

/** "{topic}" → transition line when the scenario rotates */
export const TUTOR_TRANSITION: Record<TargetLang, string> = {
  de: 'Sehr gut gemacht! Neues Thema: {topic}.',
  en: 'Well done! New topic: {topic}.',
  fr: 'Très bien ! Nouveau sujet : {topic}.',
  es: '¡Muy bien! Nuevo tema: {topic}.',
  pt: 'Muito bem! Novo tema: {topic}.',
}

/** Fixed UI-language translation of the transition line */
export const TUTOR_TRANSITION_TR: { ru: string; en: string } = {
  ru: 'Очень хорошо! Новая тема: {topic}.',
  en: 'Very good! New topic: {topic}.',
}

// ---------- Phonon voices ----------

export interface PhononVoiceInfo {
  name: string
  /** voice file URL (.safetensors) */
  url: string
}

// The gradium/phonon-voices catalog (public, Apache 2.0): display name →
// catalog id. One flat voices/<id>.safetensors file per voice, compatible
// with every Phonon model of any size — which is what makes the public
// multilingual model usable with per-language voices.
const CATALOG_VOICES: Record<TargetLang, Array<[name: string, id: string]>> = {
  de: [
    ['Annika', 'p6Uutkyi3j2iNAUu'],
    ['Anton', '3ZKKapPOvuWFcw9f'],
    ['Henrik', 'yyS1KYWs6mXoEw7D'],
    ['Jette', '4Mn9VfG2wsLLEzi5'],
    ['Josefine', 'yadpmqsHVrYC0NJp'],
    ['Jule', 'MxhgvuHuUER7qjmL'],
    ['Leon', '20zdyYrQPzKlCwkk'],
    ['Lotta', 'MOrDPn052KUlnKXk'],
    ['Mats', 'Kf5m22mROozoMWj3'],
    ['Mika', 'R3uU1GTAZJotUhUs'],
    ['Mirko', 'Xn9xDzqSSr4xGTNg'],
    ['Nele', '2A2fFf8SkDEJ8nzx'],
    ['Svea', 'Adoh4wA9tp5QXJi9'],
  ],
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
  fr: [
    ['Noémie', 'FXxJ9mANRq6BCTX5'],
    ['Coralie', 'ZeSg853xFACESHHI'],
    ['Tiphaine', '0fvH6XAKvA748v2v'],
    ['Maëlys', 's048cR1l2Jmu4k3B'],
    ['Orianne', 'TUk4X11S6UytB3G6'],
    ['Solène', 'YhIHaAfQ0cQPDV9R'],
    ['Ninon', 'qtPlUYAZ4EJDuWMm'],
    ['Lilou', '4iKxBtHBRzr1YOph'],
    ['Hélène', 'Vvakv7iWZCUrBooR'],
    ['Augustin', 'Tek4tJXiX6_yvXq7'],
    ['Arnaud', 'aXMVwiUhITMrwPzd'],
    ['Jules', 'YKeBw3OV1RgpdhLh'],
    ['Baptiste', 'rqqeErpASHVQXHDd'],
    ['Lucien', 'LIv4NaG8ay4Mhqtd'],
    ['Marius', 'biuhvu17TxVKOcyy'],
  ],
  es: [
    ['Noa', 'b6FvJAiokjdqIti4'],
    ['Lucía-Sol', '3p0eIGbkmny71GlA'],
    ['Candela', 'c9wqBDmQiBie5q6Y'],
    ['Celia', 'rmLBOdHrfkFym9MM'],
    ['Alba', 'u2UscyAnHilpiwmf'],
    ['Alicia', '4701YgRXjkBcg6sL'],
    ['Nerea', 'EQcQFGkYfMn5YJgx'],
    ['Rebeca', 'Sx8m6WdXBG06zwZT'],
    ['Regina', 's58clrg2fe0MO7Y-'],
    ['Danae', 'evfxKSxpDIhmsNoq'],
    ['Azucena', 'KJpIQlbYrZPA4aLq'],
    ['Jimena', 'qG5BXOJYrKEnXLIX'],
    ['Ximena', 'VDwnGxAo68C8U8vC'],
    ['Marcos', 'jvPx8j8zLGQ3utZz'],
    ['Borja', 'tIjCgP8v3RY8UpgM'],
    ['Iker', 't-_TS1e-0GzDAX02'],
    ['Nuno', 'fghJGlv90qu8OJ36'],
    ['Izan', 'Ejb29qHnSOK0cIHY'],
    ['Guillermo', 'FaLVVqpFQcDOtq45'],
    ['Lalo', 'F05gqkzX7WhKVpSL'],
    ['Aldo', 'ax7dW1XB0eiMfHgO'],
    ['Yael', 'ALczEazoF4n6PmGl'],
    ['Ulises', 'G5HLUsQd659UtRe7'],
    ['Leonel', 'BkuASiOJRrJEB5qA'],
    ['Nico', 'PwgPEaweQILZdGc4'],
  ],
  pt: [
    ['Manuela-Lu', 'KgC2Nqnjj48NUiyV'],
    ['Isadora', 'CtNvKUUMrx1h56ih'],
    ['Débora', 'K8mj96kYHMy8q3Hb'],
    ['Rafaela', '6k6cRt7QJfm5ChrH'],
    ['Clarice', 'sGCMzFIA53ppIngM'],
    ['Flávia', 'gOc90Rjmv5CobHCj'],
    ['Davi', 'NuUr_x5V90hSHzCJ'],
    ['Igor', 'l7520SIXi14iEamd'],
    ['Kauã', '6HftnVU1XqVBJS8t'],
    ['Vitor', 'mWgyMRkFED70QxQv'],
    ['Otávio', 'JYtmeaysoaR0Wybf'],
    ['Marcelo', 'qDeAnE4L4bk0BRz1'],
  ],
}

// Local German voices (hosted next to the phonon-40m-de model) — the same
// names as the catalog, so switching between the local model and the
// multilingual fallback keeps the selected voice working.
const DE_VOICES = [
  'Annika', 'Anton', 'Henrik', 'Jette', 'Josefine', 'Jule',
  'Leon', 'Lotta', 'Mats', 'Mika', 'Mirko', 'Nele', 'Svea',
] as const

function withSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`
}

/**
 * Phonon voice list for a (language, model base) pair:
 *  • multilingual base — the per-language catalog voices (public HF files);
 *  • de on a non-hf base — the voice files hosted next to the model;
 *  • en on the public 31m base — the model's own default voice + the catalog;
 *  • any other hf:// repo — phonon-tts lists the repo's own voices
 *    (the name it registers for the bundled default is 'default');
 *  • custom hosted base (GitHub Release/mirror) — default-voice.safetensors.
 */
export function phononVoices(lang: TargetLang, base: string): PhononVoiceInfo[] {
  if (base.startsWith(MULTILINGUAL_BASE)) {
    return CATALOG_VOICES[lang].map(([name, id]) => ({ name, url: catalogVoiceUrl(id) }))
  }
  if (lang === 'de' && !isHfUrl(base)) {
    const b = withSlash(base)
    return DE_VOICES.map(name => ({ name, url: `${b}voice-${name}.safetensors` }))
  }
  if (lang === 'en' && base.startsWith(PHONON_31M_EN_BASE)) {
    return [
      { name: 'Default', url: phonon31mEnFile('default-voice.safetensors') },
      ...CATALOG_VOICES.en.map(([name, id]) => ({ name, url: catalogVoiceUrl(id) })),
    ]
  }
  if (isHfUrl(base)) {
    return [{ name: 'default', url: '' }]
  }
  return [{ name: 'Default', url: `${withSlash(base)}default-voice.safetensors` }]
}

/** The first catalog voice of the language is its default
 *  (de → Annika, en → Zoey, fr → Noémie, es → Noa, pt → Manuela-Lu) */
export function defaultPhononVoice(lang: TargetLang): string {
  return CATALOG_VOICES[lang][0][0]
}

/** A voice name the selected model actually has: the saved value if it is in
 *  the list, else the language default, else the first entry — a stale saved
 *  name (base switched, voice not hosted) must never reach the model. */
export function resolvePhononVoice(lang: TargetLang, base: string, saved?: string): string {
  const names = phononVoices(lang, base).map(v => v.name)
  if (saved && names.includes(saved)) return saved
  const def = defaultPhononVoice(lang)
  if (names.includes(def)) return def
  return names[0] ?? 'default'
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
