// Bilingual UI (RU/EN): string catalog + React context.
// Non-React library code (lib/*) uses tr() with a global activeLang,
// which App keeps in sync when the UI language changes.

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

export type UiLang = 'ru' | 'en'

type Dict = Record<string, string>

const RU: Dict = {
  // Common / status
  appName: 'BlaBlaBot',
  tagline: 'Голосовой репетитор: говори, слушай, запоминай',
  loadingModels: 'Загружаю модели…',
  readyToTalk: 'Готов к разговору',
  modelsErrorStatus: 'Ошибка загрузки моделей — см. настройки',
  loadingModelsShort: 'Загружаю модели',
  tutorSpeaking: '{name} говорит…',
  recognizing: 'Распознаю речь и готовлю ответ…',
  answerReady: 'Ответ готов',
  newDialogStarted: 'Начат новый диалог',
  recordingStatus: 'Запись… говори',
  tabChat: 'Диалог',
  tabCards: 'Карточки',
  addToVocab: '+ В словарь',
  vocabAdded: '{word} — {translation} · добавлено в словарь',
  vocabExisted: '{word} — {translation} · уже было в словаре',
  vocabFailed: 'Не удалось добавить слово',
  audioFailed: 'Не удалось воспроизвести аудио',
  unknownError: 'Неизвестная ошибка',
  openSettings: 'Настройки',
  newDialog: 'Новый диалог',
  close: 'Готово',

  // Sidebar
  voiceLabel: 'Голос',
  noVoicesFound: 'Подходящих голосов не найдено',
  systemVoiceNet: 'сетевой',
  systemVoiceNovelty: '(шутейный)',
  modelsTitle: 'Модели',
  modelReady: 'готова',
  modelLoading: 'загрузка…',
  modelError: 'ошибка',
  modelIdle: 'ожидание',
  asrRow: 'Whisper (ASR)',
  llmRow: '{name} (LLM)',
  ttsRow: 'Голос (TTS)',
  webgpuNote: 'WebGPU недоступен: LLM не заработает (нужен Chrome/Edge или Safari 26+), Whisper переключён в медленный WASM',
  noSystemVoiceForLang: 'Системных голосов для этого языка не найдено — включи Phonon в настройках',

  // Settings
  settingsTitle: 'Настройки',
  sectionGeneral: 'Общие',
  sectionSpeech: 'Озвучка',
  sectionModels: 'Модели',
  sectionTutor: 'Тьютор',
  interfaceLang: 'Язык интерфейса',
  studyLang: 'Язык изучения',
  theme: 'Тема',
  themeSystem: 'Системная',
  themeLight: 'Светлая',
  themeDark: 'Тёмная',
  level: 'Уровень',
  showTranslation: 'Показывать перевод',
  ttsEngine: 'Движок озвучки',
  enginePhonon: 'Phonon (~75 МБ, офлайн)',
  engineSystem: 'Системный голос (0 МБ)',
  ttsSpeed: 'Скорость ×{x}',
  phononBase: 'URL модели TTS',
  phononBaseHint: 'Модель не хранится в репозитории: файлы качаются в браузер при первом включении. GitHub Release (…/releases/download/тег/) или hf://публичное-зеркало — см. README',
  llmModel: 'Модель (LLM)',
  llmHint: 'При первом выборе скачивается с HF и кешируется браузером — дальше офлайн',
  ramInTab: 'В памяти вкладки: {size}',
  asrModel: 'Распознавание речи',
  extraPrompt: 'Доп. инструкции тьютору',
  extraPromptPlaceholder: 'Например: говори простыми фразами, используй только прошедшее время, тема разговора — работа и офис',

  // Onboarding
  onboardingStart: 'Начать',
  onboardingUiLang: 'Язык интерфейса',
  onboardingStudy: 'Что будем учить?',
  onboardingHint: 'Модели скачиваются при первом запуске и кешируются — дальше работает офлайн',

  // Chat
  emptyTitle: 'BlaBlaBot',
  emptyText: 'Голосовой репетитор: зажми кнопку ниже (или Space) и говори — бот услышит, ответит голосом, исправит ошибки и переведёт.',
  emptyHint: 'Пока диалог пуст, можно начать с подсказки:',
  suggestionsTitle: 'Можно сказать дальше:',
  followLabel: 'Тьютор спрашивает:',
  mistakesCount: 'Ошибки ({count})',
  replay: 'Переиграть',

  // Push-to-talk button
  pttIdle: 'Зажми и говори, отпусти — отправится. Короткий клик игнорируется',
  pttRecording: 'Запись… отпусти, чтобы отправить',
  pttProcessing: 'Whisper → LLM → голос, подожди…',
  pttRecordingLong: 'Запись… говори',

  // Flashcards
  cardsLoading: 'Загружаю словарь…',
  cardsProgress: 'Выучено {learned} из {total} · в колоде {queue}',
  cardHint: 'Вспомни перевод — потом проверь себя',
  cardSpeak: 'Озвучить',
  cardReveal: 'Показать перевод',
  cardRepeat: 'Ещё повторю',
  cardKnow: 'Знаю',
  yourVocab: 'Твой словарь',
  emptyVocabHint: 'Выдели слово в диалоге и нажми «+ В словарь» — или добавь его вручную ниже.',
  allLearned: 'Всё выучено!',
  allLearnedHint: 'Все слова отмечены выученными.',
  trainAll: 'Тренировать все ({total})',
  newWordPlaceholder: 'Новое слово или фраза…',
  cardAdd: 'Добавить',
  againInTraining: 'Снова в тренировку',
  markLearned: 'Отметить выученным',
  btnRepeat: 'повторить',
  btnLearned: 'выучено',
  keysFlip: 'перевернуть',
  keysKnow: 'знаю',
  keysRepeat: 'повторю',

  // Status bar
  timingTotal: 'всего',
  timingTranslation: 'перевод',
  statusServerDown: 'Сервер недоступен',
  statusAllReady: 'Все модели готовы',
  statusModelsLoading: 'Модели загружаются…',

  // Engine error strings (lib/*)
  errModelsNotReady: 'Модели ещё не загружены — подожди загрузки в настройках',
  errModelSwitching: 'Новая модель ещё загружается — подожди и повтори',
  errTextTooLong: 'Текст слишком длинный (максимум 500 символов)',
  errNeedInput: 'Нужна запись аудио или текст',
  errSilence: 'В записи только тишина — попробуй ещё раз',
  errAsrFailed: 'Не удалось распознать речь — попробуй ещё раз',
  errAsrLoad: 'Не удалось загрузить модель распознавания: {reason}',
  errLlmFailed: 'Ошибка генерации ответа: {reason}',
  errVocabFailed: 'Не удалось перевести слово — попробуй ещё раз',
  errVocabNotReal: '«{word}», похоже, не настоящее слово — в словарь не добавлено. {comment}',
  errVocabNotRealDefault: 'такого слова нет',
  errVocabEmpty: 'Слово пустое или слишком длинное',
  errTtsNotLoaded: 'Модель озвучки Phonon ещё не загружена',
  errTtsUnsupported: 'speechSynthesis не поддерживается браузером',
  errTtsUnavailable: 'Озвучка недоступна в этом браузере',
  errTtsNoVoice: 'Системный голос для этого языка не найден — установи его в системе или включи Phonon в настройках',
  errTtsSpeak: 'Ошибка озвучки ({error})',
  errWebgpuMissing: 'WebGPU недоступен в этом браузере — LLM работает только с WebGPU (Chrome/Edge, Safari 26+)',
  errLlmNotLoaded: 'LLM ещё не загружена',
  errAsrNotLoaded: 'ASR ещё не загружен',
  warnPhononNotReady: 'Озвучка Phonon не готова (модель не загрузилась), но текст ответа получен',
  warnNoSystemVoice: 'Системный голос не найден — включи Phonon в настройках. Текст ответа получен',
  warnTtsUnavailable: 'Озвучка недоступна, но текст ответа получен',
  fileMs: 'мс',
  fileCached: '(кеш)',
  fileMb: 'МБ',

  // Bench tab
  tabBench: 'Bench',
  showBenchTab: 'Показывать вкладку Bench',
  benchTitle: 'Бенчмарк WebLLM',
  benchEnvTitle: 'Окружение',
  benchEnvHint: 'Снимок делается при открытии вкладки',
  benchModelsTitle: 'Модели для прогона',
  benchRun: 'Прогнать бенчмарк',
  benchRunning: 'Идёт прогон…',
  benchProgress: '{model}: {text}',
  benchAggTitle: 'Агрегат по моделям (этап «тьютор»)',
  benchColModel: 'Модель',
  benchColTurns: 'Ходов',
  benchColDecode: 'Decode, ток/с',
  benchColTtft: 'TTFT, мс',
  benchColWall: 'Wall, мс',
  benchColJson: 'JSON ок, %',
  benchColCorr: 'Правок',
  benchLoadsTitle: 'Загрузки моделей',
  benchColKind: 'Тип',
  benchColMs: 'мс',
  benchColSource: 'Файлы из',
  benchTurnsTitle: 'Последние вызовы',
  benchColStage: 'Этап',
  benchColTokens: 'Токены (in/out)',
  benchColParse: 'Парсинг',
  benchCopyMd: 'Скопировать Markdown',
  benchCopyJson: 'Скопировать JSON',
  benchClear: 'Очистить',
  benchCopied: 'Скопировано в буфер',
  benchEmpty: 'Пока нет данных — прогони бенчмарк или просто поговори с тьютором',
  benchProbe: 'Контекст-проба',
  benchProbeHint: 'Растит диалог на первой отмеченной модели до упора в контекст',
  benchProbeTitle: 'Контекст-проба (последняя)',
  benchColTurn: 'Ход',
  benchColPromptTok: 'Промпт, ток',
}

const EN: Dict = {
  appName: 'BlaBlaBot',
  tagline: 'Voice tutor: speak, listen, remember',
  loadingModels: 'Loading models…',
  readyToTalk: 'Ready to talk',
  modelsErrorStatus: 'Model loading failed — see Settings',
  loadingModelsShort: 'Loading models',
  tutorSpeaking: '{name} is speaking…',
  recognizing: 'Transcribing and preparing a reply…',
  answerReady: 'Reply ready',
  newDialogStarted: 'New conversation started',
  recordingStatus: 'Recording… speak now',
  tabChat: 'Chat',
  tabCards: 'Cards',
  addToVocab: '+ Add to vocab',
  vocabAdded: '{word} — {translation} · added to vocabulary',
  vocabExisted: '{word} — {translation} · already in vocabulary',
  vocabFailed: 'Could not add the word',
  audioFailed: 'Audio playback failed',
  unknownError: 'Unknown error',
  openSettings: 'Settings',
  newDialog: 'New conversation',
  close: 'Done',

  voiceLabel: 'Voice',
  noVoicesFound: 'No matching voices found',
  systemVoiceNet: 'network',
  systemVoiceNovelty: '(novelty)',
  modelsTitle: 'Models',
  modelReady: 'ready',
  modelLoading: 'loading…',
  modelError: 'error',
  modelIdle: 'waiting',
  asrRow: 'Whisper (ASR)',
  llmRow: '{name} (LLM)',
  ttsRow: 'Voice (TTS)',
  webgpuNote: 'WebGPU unavailable: LLM will not work (needs Chrome/Edge or Safari 26+); Whisper falls back to slow WASM',
  noSystemVoiceForLang: 'No system voices for this language — enable Phonon in Settings',

  settingsTitle: 'Settings',
  sectionGeneral: 'General',
  sectionSpeech: 'Speech',
  sectionModels: 'Models',
  sectionTutor: 'Tutor',
  interfaceLang: 'Interface language',
  studyLang: 'Language to learn',
  theme: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  level: 'Level',
  showTranslation: 'Show translations',
  ttsEngine: 'TTS engine',
  enginePhonon: 'Phonon (~75 MB, offline)',
  engineSystem: 'System voice (0 MB)',
  ttsSpeed: 'Speed ×{x}',
  phononBase: 'TTS model URL',
  phononBaseHint: 'The model is not stored in the repo: files are downloaded to the browser on first use. GitHub Release (…/releases/download/tag/) or hf://public-mirror — see README',
  llmModel: 'Model (LLM)',
  llmHint: 'Downloaded from HF on first use and cached by the browser — offline afterwards',
  ramInTab: 'Tab memory: {size}',
  asrModel: 'Speech recognition',
  extraPrompt: 'Extra tutor instructions',
  extraPromptPlaceholder: 'E.g. speak in simple phrases, use only past tense, conversation topic — work and office',

  onboardingStart: 'Start',
  onboardingUiLang: 'Interface language',
  onboardingStudy: 'What would you like to learn?',
  onboardingHint: 'Models download on first launch and are cached — offline afterwards',

  emptyTitle: 'BlaBlaBot',
  emptyText: 'Voice tutor: hold the button below (or Space) and speak — the bot will listen, answer with its voice, correct your mistakes and translate.',
  emptyHint: 'The conversation is empty — start with a suggestion:',
  suggestionsTitle: 'You could say:',
  followLabel: 'Tutor asks:',
  mistakesCount: 'Mistakes ({count})',
  replay: 'Replay',

  pttIdle: 'Hold and speak, release to send. A short click is ignored',
  pttRecording: 'Recording… release to send',
  pttProcessing: 'Whisper → LLM → voice, hang on…',
  pttRecordingLong: 'Recording… speak now',

  cardsLoading: 'Loading vocabulary…',
  cardsProgress: 'Learned {learned} of {total} · {queue} in deck',
  cardHint: 'Recall the translation — then check yourself',
  cardSpeak: 'Speak',
  cardReveal: 'Show translation',
  cardRepeat: 'Repeat later',
  cardKnow: 'I know it',
  yourVocab: 'Your vocabulary',
  emptyVocabHint: 'Select a word in the chat and press “+ Add to vocab” — or type it below.',
  allLearned: 'All learned!',
  allLearnedHint: 'Every word is marked as learned.',
  trainAll: 'Train all ({total})',
  newWordPlaceholder: 'New word or phrase…',
  cardAdd: 'Add',
  againInTraining: 'Back to training',
  markLearned: 'Mark as learned',
  btnRepeat: 'repeat',
  btnLearned: 'learned',
  keysFlip: 'flip',
  keysKnow: 'know',
  keysRepeat: 'repeat',

  timingTotal: 'total',
  timingTranslation: 'translation',
  statusServerDown: 'Server unavailable',
  statusAllReady: 'All models ready',
  statusModelsLoading: 'Models are loading…',

  errModelsNotReady: 'Models are not loaded yet — wait for loading in Settings',
  errModelSwitching: 'The new model is still loading — wait a moment and retry',
  errTextTooLong: 'Text is too long (500 characters max)',
  errNeedInput: 'Audio recording or text is required',
  errSilence: 'Only silence in the recording — try again',
  errAsrFailed: 'Could not recognize the speech — try again',
  errAsrLoad: 'Failed to load the recognition model: {reason}',
  errLlmFailed: 'Reply generation failed: {reason}',
  errVocabFailed: 'Could not translate the word — try again',
  errVocabNotReal: '“{word}” does not seem to be a real word — not added. {comment}',
  errVocabNotRealDefault: 'no such word',
  errVocabEmpty: 'The word is empty or too long',
  errTtsNotLoaded: 'The Phonon voice model is not loaded yet',
  errTtsUnsupported: 'speechSynthesis is not supported by this browser',
  errTtsUnavailable: 'Speech is unavailable in this browser',
  errTtsNoVoice: 'No system voice for this language — install one in the OS or enable Phonon in Settings',
  errTtsSpeak: 'Speech error ({error})',
  errWebgpuMissing: 'WebGPU is unavailable in this browser — the LLM needs WebGPU (Chrome/Edge, Safari 26+)',
  errLlmNotLoaded: 'The LLM is not loaded yet',
  errAsrNotLoaded: 'ASR is not loaded yet',
  warnPhononNotReady: 'Phonon voice is not ready (model failed to load), but the reply text is here',
  warnNoSystemVoice: 'No system voice found — enable Phonon in Settings. The reply text is here',
  warnTtsUnavailable: 'Speech is unavailable, but the reply text is here',
  fileMs: 'ms',
  fileCached: '(cached)',
  fileMb: 'MB',

  // Bench tab
  tabBench: 'Bench',
  showBenchTab: 'Show the Bench tab',
  benchTitle: 'WebLLM benchmark',
  benchEnvTitle: 'Environment',
  benchEnvHint: 'Captured when the tab opens',
  benchModelsTitle: 'Models to run',
  benchRun: 'Run benchmark',
  benchRunning: 'Running…',
  benchProgress: '{model}: {text}',
  benchAggTitle: 'Per-model aggregate (tutor stage)',
  benchColModel: 'Model',
  benchColTurns: 'Turns',
  benchColDecode: 'Decode tok/s',
  benchColTtft: 'TTFT ms',
  benchColWall: 'Wall ms',
  benchColJson: 'JSON ok %',
  benchColCorr: 'Corrections',
  benchLoadsTitle: 'Model loads',
  benchColKind: 'Kind',
  benchColMs: 'ms',
  benchColSource: 'Files from',
  benchTurnsTitle: 'Recent calls',
  benchColStage: 'Stage',
  benchColTokens: 'Tokens (in/out)',
  benchColParse: 'Parse',
  benchCopyMd: 'Copy Markdown',
  benchCopyJson: 'Copy JSON',
  benchClear: 'Clear',
  benchCopied: 'Copied to clipboard',
  benchEmpty: 'No data yet — run the benchmark or just talk to the tutor',
  benchProbe: 'Context probe',
  benchProbeHint: 'Grows a dialog on the first checked model until it hits the context limit',
  benchProbeTitle: 'Context probe (latest)',
  benchColTurn: 'Turn',
  benchColPromptTok: 'Prompt tok',
}

export const STRINGS: Record<UiLang, Dict> = { ru: RU, en: EN }

/** Interpolate {vars} into a string */
function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    key in vars ? String(vars[key]) : m,
  )
}

/** For non-React code (lib/*): tr(lang, key, vars) */
export function tr(lang: UiLang, key: string, vars?: Record<string, string | number>): string {
  const dict = STRINGS[lang] ?? STRINGS.ru
  return format(dict[key] ?? STRINGS.ru[key] ?? key, vars)
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string

export function makeT(lang: UiLang): TFunc {
  return (key, vars) => tr(lang, key, vars)
}

// --- Global language for library code (engine errors etc.) ---
let activeLang: UiLang = 'ru'

export function setLibLang(lang: UiLang): void {
  activeLang = lang
}

export function libLang(): UiLang {
  return activeLang
}

/** Convenience accessor from lib/*: tr(libLang(), key) */
export function libT(key: string, vars?: Record<string, string | number>): string {
  return tr(activeLang, key, vars)
}

// --- React context ---
const I18nContext = createContext<TFunc>(makeT('ru'))

export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }): JSX.Element {
  const t = I18N_CACHE[lang] ?? (I18N_CACHE[lang] = makeT(lang))
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>
}

const I18N_CACHE: Partial<Record<UiLang, TFunc>> = {}

export function useI18n(): TFunc {
  return useContext(I18nContext)
}
