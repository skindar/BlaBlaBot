// Port of backend/services/pipeline.py: the same pipeline
// (audio → VAD → ASR → tutor LLM → translation LLM → TTS → history)
// with the same timings, but fully inside the tab and in any of the five languages.
// One request at a time — the analog of the native server's gpu_lock.

import { asrEngine, AsrError } from './asr'
import { decodeBlobToPcm16k, detectSpeech, splitAtSilence, trimSilence, BadAudioError, EmptyAudioError } from './audio'
import { recordTurn } from './bench'
import { libT } from '../i18n'
import {
  FAREWELL_RE,
  TUTOR_FAREWELL,
  TUTOR_FAREWELL_TRANSLATION,
  langInfo,
  type TargetLang,
} from './langs'
import { llmEngine, LlmError, llmModelByKey } from './llm'
import {
  filterCorrections,
  hasCyrillic,
  parseSuggestionsJson,
  parseTranslationJson,
  parseTutorReply,
  parseVocabJson,
  stripQuoteWrappers,
  stripThink,
} from './parse'
import {
  buildTutorMessages,
  buildCorrectionsMessages,
  buildTranslateMessages,
  buildSingleTranslateMessages,
  buildSuggestionsMessages,
  buildDiaryRefineMessages,
  buildDiaryPhraseRefineMessages,
  buildVocabMessages,
  scenarioGrounding,
  vocabNotRealDefaultComment,
  type LlmMessage,
} from '../prompts'
import { parseCorrectionsJson } from './parse'
import { contextWindowFor } from './llm'
import { conversation, diary, lookupDictionary, tutorSession, vocab } from './store'
import { ttsEngine } from './tts'
import { phononEngine } from './ttsPhonon'
import {
  advanceFullSession,
  ensurePrescribedQuestion,
  looksEnglishDrift,
  polishReply,
  prescribedChips,
  prescribedQuestion,
  runDiaryTurn,
  runTinyTutorTurn,
  templateFloor,
  type TutorParts,
} from './tutor'
import { newSession, scenarioById, selectScenario } from './scenarios'
import type { ParseOutcome } from './bench'
import type { ChatResponse, Correction, Level, Suggestion, TtsEngineKind } from '../types'
import type { UiLang } from '../i18n'

export class PipelineError extends Error {}
export class ModelsNotReadyError extends PipelineError {}
export class InvalidParameterError extends PipelineError {}

const LLM_TEMPERATURE = 0.7
const LLM_TRANSLATION_TEMPERATURE = 0.2
const LLM_VOCAB_TEMPERATURE = 0.3
const LLM_CORRECTIONS_TEMPERATURE = 0.2
const LLM_SUGGESTIONS_TEMPERATURE = 0.5

/** Calibrated chars-per-token per model (updated after every tutor call with
 *  the real prompt_tokens) — feeds the history auto-trim estimator */
const charsPerToken = new Map<string, number>()
const DEFAULT_CHARS_PER_TOKEN = 3.2

function estimateTokens(messages: LlmMessage[], modelId: string): number {
  const chars = messages.reduce((acc, m) => acc + m.content.length + 8, 0)
  return Math.ceil(chars / (charsPerToken.get(modelId) ?? DEFAULT_CHARS_PER_TOKEN))
}

/** Auto-trim: drop oldest user+assistant pairs until the prompt fits the
 *  model's context budget (prebuilt web-llm builds hard-cap at 4096 tokens,
 *  so a growing dialog would otherwise hit the wall mid-conversation). */
function trimHistoryToFit(
  messages: LlmMessage[],
  modelId: string,
  llmKey: string,
): { messages: LlmMessage[]; trimmedPairs: number } {
  const { promptBudget } = contextWindowFor(llmKey)
  let trimmedPairs = 0
  let out = messages
  while (estimateTokens(out, modelId) > promptBudget && out.length > 3) {
    // keep [0] = system; drop the next user+assistant pair
    out = [out[0], ...out.slice(3)]
    trimmedPairs++
  }
  return { messages: out, trimmedPairs }
}

export interface ProcessChatArgs {
  blob?: Blob
  text?: string
  level: Level
  targetLang: TargetLang
  uiLang: UiLang
  llmKey: string
  extraPrompt?: string
  tts?: TtsSettings
  /** diary mode: supportive listener, messages go to the diary */
  diaryMode?: boolean
}

export interface TtsSettings {
  engine: TtsEngineKind
  voice: string
  phononBase: string
}

export interface SpeakOptions extends TtsSettings {
  rate: number
  targetLang: TargetLang
  onFirstAudio?: (ms: number) => void
}

/** Serial queue — like the native server's global lock */
let queue: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

function nowMs(): number {
  return performance.now()
}

/** Is the translation in the UI language? ru — Cyrillic without foreign-script
 *  junk or Latin chatter; en — Latin without Cyrillic or CJK. */
function translationOk(text: string, uiLang: UiLang): boolean {
  if (!text) return false
  const junk =
    /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Arabic}/u
  if (junk.test(text)) return false
  if (uiLang === 'ru') {
    if (!hasCyrillic(text)) return false
    // one Latin token is a name ("Anna"); two or more is chatter ("choose a name")
    const latinWords = text.match(/[a-z]{2,}/gi) ?? []
    if (latinWords.length > 1) return false
    return true
  }
  return /[a-zà-ÿ]/i.test(text) && !hasCyrillic(text)
}

/** Case/quote/space-insensitive phrase comparison */
function samePhrase(a: string, b: string): boolean {
  const norm = (x: string) =>
    x.toLowerCase().replace(/[«»"'’"]/g, '').replace(/\s+/g, ' ').trim()
  return norm(a) === norm(b)
}

/** English function words absent from de/fr/es/pt ("was"/"an"/"will"/"her"/
 *  "no"/"a"/"me" are real words in those languages — excluded on purpose) */
const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'and', 'is', 'are', 'was', 'were', 'be', 'been', 'you', 'your', 'i', 'we', 'our',
  'they', 'them', 'their', 'he', 'she', 'his', 'it', 'its', 'this', 'that', 'these', 'those',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'not', 'with', 'of', 'to', 'from',
  'for', 'about', 'have', 'has', 'had', 'do', 'does', 'did', 'would', 'could', 'should',
  'can', 'very', 'really', 'just', 'most', 'more', 'some', 'any', 'here', 'there', 'yes',
])

/** Does the text look like English? Tiny tutors occasionally drift into
 *  English mid-lesson; de/fr/es/pt text carries ~none of these words. */
function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length === 0) return false
  const markers = words.filter(w => ENGLISH_FUNCTION_WORDS.has(w.replace(/'(s|ve|re|ll|d|m)$/, ''))).length
  return markers / words.length >= 0.25
}

/** Drop parenthetical/bracketed remarks in a foreign script, anywhere in the
 *  line: model chatter like "Меня зовут (choose a name – e.g., Иван)" is
 *  meta-instruction, never part of the translation. */
/** Collapse ASR repetition loops ("I don't I don't I don I don…") that
 *  Whisper base produces on silence-heavy audio: consecutive identical
 *  1-3 word runs collapse to a single instance, in passes until stable. */
function collapseAsrRepetition(text: string): string {
  // word boundaries via lookaround (\b is ASCII-only and breaks on Cyrillic):
  // without them the backreference matches word prefixes ("Ich h|abe" -> "h h")
  const re = /(?<![\p{L}'’])([\p{L}'’]+(?:\s+[\p{L}'’]+){0,2})(?:\s+\1)+(?![\p{L}'’])/giu
  let out = text.replace(re, '$1')
  let prev = text
  let guard = 0
  while (out !== prev && guard < 3) {
    prev = out
    out = out.replace(re, '$1')
    guard++
  }
  return out
}

function stripForeignParens(line: string, uiLang: UiLang): string {
  const foreign = uiLang === 'ru' ? /[a-z]/i : /[а-яё]/i
  return line
    .replace(/\(([^()]*)\)/g, (m, inner: string) => (foreign.test(inner) ? '' : m))
    .replace(/\[([^\[\]]*)\]/g, (m, inner: string) => (foreign.test(inner) ? '' : m))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Target-language wh-words (wie/was/quoi/cómo/…): a translation of such a
 *  question must carry a UI-language question word. Yes/no questions
 *  (verb-first: "Hast du…?") have none — there only the "?" remains. */
const TARGET_WH_RE: Record<TargetLang, RegExp> = {
  de: /(^|\s)(wie|was|wo|wann|warum|weshalb|wieso|wozu|welche[rsmn]?|wer|wieviel[e]?)/i,
  en: /(^|\s)(what|which|who|when|where|why|how)/i,
  fr: /(^|\s)(comment|quoi|o[uù]|quand|pourquoi|quel(le|le|s)?|qui|combien)/i,
  es: /(^|\s)(c[oó]mo|qu[eé]|d[oó]nde|cu[aá]ndo|cu[aá]l|qui[eé]n|cu[aá]nto)/i,
  pt: /(^|\s)(como|que|onde|quando|qual|quem|quanto)/i,
}

/** Last-ditch rescue for a translation that dropped the "?" of a yes/no
 *  question ("Hast du… gelesen?" -> "Ты читала книгу"): no question word
 *  is expected there, so accept the line with the "?" restored — unless
 *  it looks like an answer (Да/Нет…) or loses numbers. Wh-questions still
 *  require a real question word in the translation. */
function rescueYesNoQuestion(source: string, candidate: string, uiLang: UiLang, targetLang: TargetLang): string {
  const srcQ = (source.match(/\?/g) ?? []).length
  if (srcQ === 0) return ''
  const line = stripForeignParens(candidate.trim(), uiLang)
  if (!line || !translationOk(line, uiLang)) return ''
  if ((line.match(/\?/g) ?? []).length > 0) return ''
  const nums = source.match(/\d+/g) ?? []
  if (nums.some(n => !line.includes(n))) return ''
  if (TARGET_WH_RE[targetLang].test(source)) {
    // a wh-question must surface its question word — answers don't
    return QUESTION_WORD_RE[uiLang].test(line) ? line : ''
  }
  // yes/no question: answers start with yes/no, translations don't
  const ANSWER_PREFIX_RE = { ru: /^(да|нет|конечно)(?![а-яё])/i, en: /^(yes|no|of course|sure)(?![a-z])/i } as const
  if (ANSWER_PREFIX_RE[uiLang].test(line)) return ''
  return line.replace(/[.!]?\s*$/, '?')
}

/** Pull one translated line out of a bare-text answer. Some models wrap
 *  their translation into a single-string JSON anyway — extract it;
 *  everything else (think blocks, wrapping quotes) is stripped. */
function parseSingleTranslation(raw: string): string {
  const bare = stripQuoteWrappers(stripThink(raw.trim())).replace(/\s+/g, ' ').trim()
  if (bare.startsWith('{')) {
    try {
      const data: unknown = JSON.parse(bare)
      if (typeof data === 'object' && data !== null) {
        const values = Object.values(data as Record<string, unknown>).filter(
          (v): v is string => typeof v === 'string' && v.trim().length > 0,
        )
        if (values.length > 0) return values[0].trim()
      }
    } catch {
      /* not JSON after all — keep the bare text */
    }
  }
  return bare.length > 0 && bare.length <= 400 ? bare : ''
}

/** Cheap cross-language sanity checks for a translation candidate.
 *  A real translation keeps the source's questions and numbers. Tiny
 *  models often ANSWER the text instead of translating it ("Wie ist das
 *  Wetter?" -> "Погода хорошая, но идёт дождь"), translate the other
 *  party's line, or drop half the content.
 *
 *  strict = true: every question must survive — a cut like "Mir geht es
 *  gut, und dir? Was möchtest du…?" -> "У вас как?" is rejected.
 *  strict = false (last-resort tier): at least the question-ness must
 *  survive — an answer instead of a translation still never passes.
 *  Invented questions and lost numbers are rejected on every tier. */
/** UI-language question words: a translation of a question keeps one even
 *  when the model drops the "?" — an answer does not */
const QUESTION_WORD_RE = {
  ru: /(^|[^а-яё])(какие|какого|каким|какую|какой|какая|какое|сколько|откуда|почему|когда|зачем|куда|кому|чего|чем|что|как|где|кто)(?![а-яё])/i,
  en: /(^|[^a-z])(which|whose|what|where|when|why|who|how)(?![a-z])/i,
} as const

function translationSane(source: string, candidate: string, uiLang: UiLang, strict = true): boolean {
  if (!candidate) return false
  const srcQ = (source.match(/\?/g) ?? []).length
  const trQ = (candidate.match(/\?/g) ?? []).length
  // strict: every question survives; loose: at least a question word does
  if (srcQ > 0 && (strict ? trQ < srcQ : trQ === 0 && !QUESTION_WORD_RE[uiLang].test(candidate)))
    return false
  if (srcQ === 0 && trQ > 0) return false
  // numbers survive translation
  const nums = source.match(/\d+/g) ?? []
  if (nums.some(n => !candidate.includes(n))) return false
  // A real translation keeps most of the content: "Danke fürs Erzählen! Sehr
  // gut gemacht! Neues Thema: Frühstück. Trinkst du…?" -> "Сегодняшний
  // завтрак?" silently dropped half the sentences. Russian runs ~0.7–1.0× of
  // the German word count, so 0.55 (strict) / 0.45 (loose) is a safe floor.
  const srcWords = (source.match(/[\p{L}\p{N}]+/gu) ?? []).length
  const trWords = (candidate.match(/[\p{L}\p{N}]+/gu) ?? []).length
  if (srcWords >= 6 && trWords < Math.ceil(srcWords * (strict ? 0.55 : 0.45))) return false
  return true
}

/** Clean raw model suggestions. Tiny models often echo the target-language
 *  phrase into "translation" (the chip then shows the same line twice),
 *  swap the text/translation fields, repeat the tutor's reply as a
 *  "suggestion", or emit one phrase three times. Keep the UI honest:
 *  a chip shows a short target-language phrase plus a translation that is
 *  really in the UI language — anything else loses the gray line or the
 *  whole chip. */
function cleanSuggestions(raw: Suggestion[], uiLang: UiLang, targetLang: TargetLang): Suggestion[] {
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const s of raw) {
    let text = stripQuoteWrappers(s.text.trim())
    let translation = stripQuoteWrappers(s.translation.trim())
    if (!text) continue
    // a chip must be in the target language — an English chip is drift
    if (targetLang !== 'en' && looksEnglish(text)) continue
    // Swapped fields (ru UI): "text" holds the Russian translation
    if (uiLang === 'ru' && hasCyrillic(text) && translation && !hasCyrillic(translation)) {
      ;[text, translation] = [translation, text]
    }
    // A suggestion is a complete mini-sentence the student could say —
    // single words ("meine") and full tutor replies are both useless here
    const words = text.split(/\s+/).filter(Boolean).length
    if (words < 2 || words > 10 || text.length > 90) continue
    const key = text.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    // The gray line must be a real UI-language translation:
    // drop echoes of the text itself and wrong-language strings
    if (!translation || !translationOk(translation, uiLang) || samePhrase(text, translation)) {
      translation = ''
    }
    // After cleanup the phrase itself must be in the target language
    if (uiLang === 'ru' && hasCyrillic(text)) continue
    seen.add(key)
    out.push({ text, translation })
    if (out.length >= 3) break
  }
  return out
}

/** Diary auto-refine: clean ONE phrase for the refined view — bare-text
 *  contract for tiny models; a failed or drifting refine keeps the raw line. */
async function refineDiaryPhrase(text: string, level: Level, targetLang: TargetLang): Promise<string> {
  const call = await llmEngine.chat(buildDiaryPhraseRefineMessages(level, targetLang, text), {
    temperature: 0.3,
    maxTokens: 120,
  })
  const refined = stripQuoteWrappers(stripThink(call.text.trim()))
  if (!refined || refined.length > 300) return ''
  if (targetLang !== 'en' && looksEnglish(refined)) return ''
  return refined
}

export function processChat(args: ProcessChatArgs): Promise<ChatResponse> {
  return enqueue(() => processChatInner(args))
}

async function processChatInner(args: ProcessChatArgs): Promise<ChatResponse> {
  const { level, llmKey, targetLang, uiLang, blob, extraPrompt = '' } = args

  if (llmEngine.loadedKey === null || asrEngine.loadedKey === null) {
    throw new ModelsNotReadyError(libT('errModelsNotReady'))
  }
  if (llmEngine.loadedKey !== llmKey) {
    // The model was switched but not reloaded yet — like the native 503
    throw new ModelsNotReadyError(libT('errModelSwitching'))
  }

  const timings: Record<string, number> = {}
  const tTotal = nowMs()

  let userText = (args.text ?? '').trim()
  if (userText && userText.length > 500) {
    throw new InvalidParameterError(libT('errTextTooLong'))
  }

  if (!userText) {
    if (!blob) throw new InvalidParameterError(libT('errNeedInput'))
    // convert + VAD + ASR; asr_ms is measured from the start of conversion — as in the native version
    const t0 = nowMs()
    const pcm = await decodeBlobToPcm16k(blob)
    timings.convert_ms = Math.round(nowMs() - t0)
    const vad = detectSpeech(pcm, 16000)
    if (!vad.isSpeech) {
      throw new EmptyAudioError(libT('errSilence'))
    }
    const trimmed = trimSilence(pcm, vad, 16000)
    // hands-free monologues: feed Whisper speech chunks, not one long
    // silence-heavy blob — that is where it starts looping "I don't I don…"
    const segments = splitAtSilence(trimmed, 16000)
    let text: string
    try {
      let joined = ''
      for (const seg of segments) {
        const part = await asrEngine.transcribe(seg, targetLang)
        if (part) joined = joined ? `${joined} ${part.trim()}` : part.trim()
      }
      text = collapseAsrRepetition(joined)
    } catch (err) {
      if (err instanceof AsrError) throw err
      throw new PipelineError(libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }))
    }
    timings.asr_ms = Math.round(nowMs() - t0)
    timings.speech_ms = Math.round(vad.speechMs)
    if (!text) throw new EmptyAudioError(libT('errAsrFailed'))
    userText = text
  }

  // ---- Scenario session (docs/tutor-methodology.md): the deterministic half.
  //  A fresh dialog starts a fresh session; a changed sidebar topic re-selects.
  //  Diary mode replaces the scenario with a supportive listener. ----
  const history = conversation.historyForLlm(targetLang, 50)
  const tutorOption = llmEngine.loadedKey ? llmModelByKey(llmEngine.loadedKey) : null
  const tiny = Boolean(tutorOption?.tiny)
  const diaryMode = Boolean(args.diaryMode)
  const activeScenario = selectScenario(targetLang, level, extraPrompt)
  let session = tutorSession.get(targetLang)
  if (
    history.length === 0 ||
    !session ||
    scenarioById(session.scenarioId) === null ||
    session.topicKey !== extraPrompt
  ) {
    session = newSession(activeScenario, extraPrompt)
  }
  const scenario = scenarioById(session.scenarioId) ?? activeScenario

  let reply = ''
  let suggestions: Suggestion[] = []
  let keptCorrections: Correction[] = []
  let tutorMethod: ParseOutcome = 'plain'
  /** deterministic reply composition (tiny tier): translate the reaction only */
  let tutorParts: TutorParts | null = null

  /** Corrections as their own single-key call — tiny tier and diary mode
   *  (the full tier reads corrections from the tutor JSON instead). In diary
   *  mode they go to the UI card and the diary entry only — never into the
   *  tutor's speech. */
  const runCorrections = async (): Promise<void> => {
    const tCorr = nowMs()
    try {
      const corrCall = await llmEngine.chat(buildCorrectionsMessages(targetLang, uiLang, userText), {
        temperature: LLM_CORRECTIONS_TEMPERATURE,
        maxTokens: 160,
        // the model sometimes continues with another "Example" after the JSON
        stop: ['Example', '\n\n\n'],
      })
      timings.corrections_ms = Math.round(nowMs() - tCorr)
      const corrParsed = parseCorrectionsJson(corrCall.text)
      keptCorrections = filterCorrections(corrParsed.corrections, userText, uiLang)
      if (tutorOption) {
        recordTurn({
          stage: 'corrections',
          llmKey: tutorOption.key,
          modelId: tutorOption.modelId,
          device: llmEngine.deviceLabel,
          temperature: LLM_CORRECTIONS_TEMPERATURE,
          promptTokens: corrCall.perf?.promptTokens ?? null,
          completionTokens: corrCall.perf?.completionTokens ?? null,
          ttftMs: corrCall.perf?.ttftMs ?? null,
          prefillTokS: corrCall.perf?.prefillTokS ?? null,
          decodeTokS: corrCall.perf?.decodeTokS ?? null,
          e2eMs: corrCall.perf?.e2eMs ?? null,
          wallMs: timings.corrections_ms,
          parse: corrParsed.method === 'fail' ? 'fail' : corrParsed.method,
          correctionsRaw: corrParsed.corrections.length,
          correctionsKept: keptCorrections.length,
          turnNo: null,
          schema: 'tiny',
        })
      }
    } catch {
      // corrections are an enhancement, not a requirement — keep the reply
      timings.corrections_ms = Math.round(nowMs() - tCorr)
    }
  }

  if (diaryMode) {
    // ---- Diary mode (docs/tutor-methodology.md §diary): the tutor only
    //  supports the speaker — short reaction + a listening question from the
    //  bank; corrections stay in the UI card, never in speech. ----
    await runCorrections()
    const tLlm = nowMs()
    const dst = diary.state(targetLang)
    const opening = history.length === 0
    const plan = await runDiaryTurn({
      userText,
      level,
      targetLang,
      extraPrompt,
      qIdx: dst.qIdx,
      opening,
    })
    diary.setState(targetLang, { qIdx: plan.session.nextIndex })
    reply = plan.reply
    suggestions = plan.suggestions
    tutorMethod = plan.method
    tutorParts = plan.parts
    timings.llm_ms = Math.round(nowMs() - tLlm)

    if (tutorOption) {
      recordTurn({
        stage: 'tutor',
        llmKey: tutorOption.key,
        modelId: tutorOption.modelId,
        device: llmEngine.deviceLabel,
        temperature: 0.4,
        promptTokens: null,
        completionTokens: null,
        ttftMs: null,
        prefillTokS: null,
        decodeTokS: null,
        e2eMs: null,
        wallMs: timings.llm_ms,
        parse: tutorMethod,
        correctionsRaw: null,
        correctionsKept: null,
        turnNo: Math.floor(history.length / 2) + 1,
        schema: tiny ? 'tiny' : 'full',
      })
    }
  } else if (tiny) {
    // ---- Tiny tier (Gemma-3-1B): scaffolded turn. Corrections FIRST so the
    //  reaction can recast the fixed form; the scenario asks the question. ----
    await runCorrections()

    const tLlm = nowMs()
    const plan = await runTinyTutorTurn({
      userText,
      level,
      targetLang,
      extraPrompt,
      scenario,
      session,
      corrections: keptCorrections,
    })
    tutorSession.set(targetLang, plan.session)
    reply = plan.reply
    suggestions = plan.suggestions
    tutorMethod = plan.method
    tutorParts = plan.parts
    timings.llm_ms = Math.round(nowMs() - tLlm)

    if (tutorOption) {
      recordTurn({
        stage: 'tutor',
        llmKey: tutorOption.key,
        modelId: tutorOption.modelId,
        device: llmEngine.deviceLabel,
        temperature: LLM_TEMPERATURE,
        promptTokens: null,
        completionTokens: null,
        ttftMs: null,
        prefillTokS: null,
        decodeTokS: null,
        e2eMs: null,
        wallMs: timings.llm_ms,
        parse: tutorMethod,
        correctionsRaw: null,
        correctionsKept: keptCorrections.length,
        turnNo: Math.floor(history.length / 2) + 1,
        schema: 'tiny',
      })
    }
  } else {
    // ---- Full tier (Gemma-4 E2B, Qwen2.5-1.5B): same scenario progression,
    //  but the model writes the whole reply around the prescribed question. ----
    const question = prescribedQuestion(scenario, session)
    const builtMessages = buildTutorMessages(
      history,
      userText,
      level,
      targetLang,
      uiLang,
      extraPrompt,
      false,
      { block: scenarioGrounding(scenario, question) },
    )
    const trimmed = tutorOption
      ? trimHistoryToFit(builtMessages, tutorOption.modelId, tutorOption.key)
      : { messages: builtMessages, trimmedPairs: 0 }
    const messages = trimmed.messages
    const tLlm = nowMs()
    let tutorCall: Awaited<ReturnType<typeof llmEngine.chat>>
    try {
      tutorCall = await llmEngine.chat(messages, { temperature: LLM_TEMPERATURE })
    } catch (err) {
      if (err instanceof LlmError) throw new PipelineError(err.message)
      throw new PipelineError(libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }))
    }

    // Language-drift rescue: full tutors occasionally answer in English even
    // for a German/French/… lesson — one retry with a hard language rule.
    if (targetLang !== 'en' && looksEnglish(parseTutorReply(tutorCall.text, targetLang).reply)) {
      const retryBuilt = buildTutorMessages(
        history,
        userText,
        level,
        targetLang,
        uiLang,
        extraPrompt,
        true,
        { block: scenarioGrounding(scenario, question) },
      )
      const retryTrimmed = tutorOption
        ? trimHistoryToFit(retryBuilt, tutorOption.modelId, tutorOption.key)
        : { messages: retryBuilt, trimmedPairs: 0 }
      try {
        const retryCall = await llmEngine.chat(retryTrimmed.messages, { temperature: LLM_TEMPERATURE })
        if (!looksEnglish(parseTutorReply(retryCall.text, targetLang).reply)) tutorCall = retryCall
      } catch {
        /* keep the first reply — it is better than nothing */
      }
    }
    timings.llm_ms = Math.round(nowMs() - tLlm)

    const parsed = parseTutorReply(tutorCall.text, targetLang)
    keptCorrections = filterCorrections(parsed.corrections, userText, uiLang)
    tutorMethod = parsed.method

    // The prescribed question ends the reply; polish enforces one question,
    // length and TTS-cleanliness. Still-English replies hit the template floor.
    reply = ensurePrescribedQuestion(parsed.reply, question)
    reply = polishReply(reply, { maxWords: level === 'A1' ? 28 : 40 })
    if (looksEnglishDrift(reply, targetLang) && question) {
      reply = polishReply(`${templateFloor(targetLang, scenario, session, userText)} ${question}`, {
        maxWords: level === 'A1' ? 28 : 40,
      })
      tutorMethod = 'template'
    }
    suggestions = prescribedChips(scenario, session)
    if (suggestions.length === 0) suggestions = cleanSuggestions(parsed.suggestions, uiLang, targetLang)
    tutorSession.set(targetLang, advanceFullSession(scenario, session))

    // calibrate the token estimator with the real measurement
    if (tutorOption && tutorCall.perf?.promptTokens) {
      const promptChars = messages.reduce((acc, m) => acc + m.content.length + 8, 0)
      charsPerToken.set(tutorOption.modelId, promptChars / tutorCall.perf.promptTokens)
    }

    if (tutorOption) {
      recordTurn({
        stage: 'tutor',
        llmKey: tutorOption.key,
        modelId: tutorOption.modelId,
        device: llmEngine.deviceLabel,
        temperature: LLM_TEMPERATURE,
        promptTokens: tutorCall.perf?.promptTokens ?? null,
        completionTokens: tutorCall.perf?.completionTokens ?? null,
        ttftMs: tutorCall.perf?.ttftMs ?? null,
        prefillTokS: tutorCall.perf?.prefillTokS ?? null,
        decodeTokS: tutorCall.perf?.decodeTokS ?? null,
        e2eMs: tutorCall.perf?.e2eMs ?? null,
        wallMs: timings.llm_ms,
        parse: tutorMethod,
        correctionsRaw: parsed.corrections.length,
        correctionsKept: keptCorrections.length,
        turnNo: Math.floor(history.length / 2) + 1,
        schema: 'full',
      })
    }
  }

  // ---- Suggestions rescue: only when the scenario chips came up empty
  //  (full tier without a usable turn) — a dedicated single-key call ----
  if (suggestions.length === 0 && tutorOption && !tiny) {
    const tSugg = nowMs()
    try {
      const suggCall = await llmEngine.chat(buildSuggestionsMessages(level, targetLang, reply), {
        temperature: LLM_SUGGESTIONS_TEMPERATURE,
        maxTokens: 200,
      })
      timings.suggestions_ms = Math.round(nowMs() - tSugg)
      const suggParsed = parseSuggestionsJson(suggCall.text)
      suggestions = cleanSuggestions(suggParsed.suggestions, uiLang, targetLang)
      recordTurn({
        stage: 'suggestions',
        llmKey: tutorOption.key,
        modelId: tutorOption.modelId,
        device: llmEngine.deviceLabel,
        temperature: LLM_SUGGESTIONS_TEMPERATURE,
        promptTokens: suggCall.perf?.promptTokens ?? null,
        completionTokens: suggCall.perf?.completionTokens ?? null,
        ttftMs: suggCall.perf?.ttftMs ?? null,
        prefillTokS: suggCall.perf?.prefillTokS ?? null,
        decodeTokS: suggCall.perf?.decodeTokS ?? null,
        e2eMs: suggCall.perf?.e2eMs ?? null,
        wallMs: timings.suggestions_ms,
        parse: suggParsed.method,
        correctionsRaw: null,
        correctionsKept: null,
        turnNo: Math.floor(history.length / 2) + 1,
      })
    } catch {
      // suggestions are an enhancement, not a requirement — keep the reply
      timings.suggestions_ms = Math.round(nowMs() - tSugg)
    }
  }

  // ---- LLM: translation (second call(s), temp 0.2) ----
  let translation = ''
  let userTranslation = ''
  // Offline dictionary fast path: single-word utterances ("Brot.",
  // "Frühstück.") are common at A1 and the deu-rus dictionary is instant
  // and never hallucinates, unlike a 1B model asked to translate one word
  let dictUserTranslation = ''
  if (userText && uiLang === 'ru' && langInfo(targetLang).hasOfflineDict) {
    const single = userText.replace(/[.,!?;:]+\s*$/, '').trim()
    if (single && !single.includes(' ')) {
      const hit = await lookupDictionary(single)
      if (hit.translations.length > 0) dictUserTranslation = hit.translations[0]
    }
  }
  const tTr = nowMs()
  try {
    /** Strict acceptance: the gray line must be in the UI language and
     *  honest to its source — complete questions, kept numbers. */
    const validTr = (candidate: string, source: string): string => {
      const line = stripForeignParens(candidate.trim(), uiLang)
      return translationOk(line, uiLang) && translationSane(source, line, uiLang, true) ? line : ''
    }
    /** Last-resort acceptance: a real but partial translation beats no
     *  line at all — answers-instead-of-translations still never pass. */
    const looseTr = (candidate: string, source: string): string => {
      const line = stripForeignParens(candidate.trim(), uiLang)
      return translationOk(line, uiLang) && translationSane(source, line, uiLang, false) ? line : ''
    }

    /** Single-text translation without a JSON contract: a bare line is
     *  what tiny models reliably produce; JSON is where they fail */
    const translateOne = async (text: string, strictPrompt = false) => {
      const call = await llmEngine.chat(buildSingleTranslateMessages(targetLang, uiLang, text, strictPrompt), {
        temperature: LLM_TRANSLATION_TEMPERATURE,
        // a translation is one short line; a derailing model must not buy
        // itself 900 tokens of repetition
        maxTokens: 220,
        stop: ['\n'],
      })
      return { text: parseSingleTranslation(call.text), call }
    }

    /** One text -> one gray line: strict first, strict retry second,
     *  then accept the best partial translation over nothing. */
    const translateOneValidated = async (text: string) => {
      const first = await translateOne(text)
      const strict1 = validTr(first.text, text)
      if (strict1) return { line: strict1, call: first.call }
      const second = await translateOne(text, true)
      const strict2 = validTr(second.text, text)
      if (strict2) return { line: strict2, call: second.call }
      return {
        line:
          looseTr(second.text, text) ||
          looseTr(first.text, text) ||
          rescueYesNoQuestion(text, second.text, uiLang, targetLang) ||
          rescueYesNoQuestion(text, first.text, uiLang, targetLang),
        call: second.call,
      }
    }

    if (tiny) {
      // Tiny tier. The deterministic parts of the reply (scenario question,
      // transition, farewell) carry fixed UI-language translations from the
      // scenario data — the 1B model only translates the short reaction.
      // The short farewell maps to a greeting if translated ("Tschüss!" ->
      // "Здравствуйте!"), so it is glossary-only.
      let replyCall: Awaited<ReturnType<typeof llmEngine.chat>> | null = null
      if (tutorParts && tutorParts.reaction) {
        const fixed = tutorParts.fixedTr[uiLang]
        const done = await translateOneValidated(tutorParts.reaction)
        translation = done.line ? `${done.line} ${fixed}` : fixed
        replyCall = done.call
      } else if (tutorParts) {
        translation = tutorParts.fixedTr[uiLang]
      } else if (samePhrase(reply, TUTOR_FAREWELL[targetLang])) {
        translation = TUTOR_FAREWELL_TRANSLATION[targetLang][uiLang]
      } else {
        const replyDone = await translateOneValidated(reply)
        translation = replyDone.line
        replyCall = replyDone.call
      }
      if (dictUserTranslation) {
        userTranslation = dictUserTranslation
      } else if (userText) {
        // A short farewell from the student also gets a fixed translation
        if (FAREWELL_RE[targetLang].test(userText) && userText.trim().split(/\s+/).length <= 4) {
          userTranslation = uiLang === 'ru' ? 'Пока! До встречи!' : 'Bye! See you!'
        } else {
          const userDone = await translateOneValidated(userText)
          userTranslation = userDone.line
          replyCall = userDone.call
        }
      }
      timings.translation_ms = Math.round(nowMs() - tTr)
      if (tutorOption) {
        recordTurn({
          stage: 'translation',
          llmKey: tutorOption.key,
          modelId: tutorOption.modelId,
          device: llmEngine.deviceLabel,
          temperature: LLM_TRANSLATION_TEMPERATURE,
          promptTokens: replyCall?.perf?.promptTokens ?? null,
          completionTokens: replyCall?.perf?.completionTokens ?? null,
          ttftMs: replyCall?.perf?.ttftMs ?? null,
          prefillTokS: replyCall?.perf?.prefillTokS ?? null,
          decodeTokS: replyCall?.perf?.decodeTokS ?? null,
          e2eMs: replyCall?.perf?.e2eMs ?? null,
          wallMs: timings.translation_ms,
          parse: translation ? 'fallback' : 'fail',
          correctionsRaw: null,
          correctionsKept: null,
          turnNo: Math.floor(history.length / 2) + 1,
        })
      }
    } else {
      // Full tier: one combined JSON call for both lines + one strict retry
      const translateOnce = async (strict: boolean) => {
        const trMessages = buildTranslateMessages(targetLang, uiLang, userText, reply, strict)
        const trCall = await llmEngine.chat(trMessages, { temperature: LLM_TRANSLATION_TEMPERATURE })
        const rawTr = trCall.text.trim()
        const parsedTr = parseTranslationJson(rawTr)
        if (parsedTr !== null) return { user: parsedTr.user, reply: parsedTr.reply, json: true, call: trCall }
        // Bare-text fallback: strip think blocks first if the model emitted
        // them, otherwise its reasoning leaks into the translation field
        const bare = stripQuoteWrappers(stripThink(rawTr))
        return { user: '', reply: bare.length > 0 && bare.length <= 400 ? bare : '', json: false, call: trCall }
      }

      const first = await translateOnce(false)
      let replyTr = validTr(first.reply, reply)
      let userTr = userText ? validTr(first.user, userText) : ''

      // One strict retry when the reply translation is missing or rejected,
      // or the user line was rejected — a wrong gray line is worse than the call
      if (!replyTr || (userText && !userTr && first.user)) {
        const second = await translateOnce(true)
        replyTr = replyTr || validTr(second.reply, reply)
        userTr = userTr || validTr(second.user, userText)
        // Accept the best partial translation over no line at all,
        // then try the dropped-"?" rescue for yes/no questions
        if (!replyTr)
          replyTr =
            looseTr(second.reply, reply) ||
            looseTr(first.reply, reply) ||
            rescueYesNoQuestion(reply, second.reply, uiLang, targetLang) ||
            rescueYesNoQuestion(reply, first.reply, uiLang, targetLang)
        if (userText && !userTr)
          userTr =
            looseTr(second.user, userText) ||
            looseTr(first.user, userText) ||
            rescueYesNoQuestion(userText, second.user, uiLang, targetLang) ||
            rescueYesNoQuestion(userText, first.user, uiLang, targetLang)
      }
      // The student must see what their own phrase means: if the combined
      // call still left the user line empty, translate it separately
      if (userText && !userTr && !dictUserTranslation) {
        const userSingle = await translateOne(userText)
        userTr = validTr(userSingle.text, userText) || looseTr(userSingle.text, userText)
      }
      translation = replyTr
      userTranslation = dictUserTranslation || userTr
      timings.translation_ms = Math.round(nowMs() - tTr)
      if (tutorOption) {
        recordTurn({
          stage: 'translation',
          llmKey: tutorOption.key,
          modelId: tutorOption.modelId,
          device: llmEngine.deviceLabel,
          temperature: LLM_TRANSLATION_TEMPERATURE,
          promptTokens: first.call.perf?.promptTokens ?? null,
          completionTokens: first.call.perf?.completionTokens ?? null,
          ttftMs: first.call.perf?.ttftMs ?? null,
          prefillTokS: first.call.perf?.prefillTokS ?? null,
          decodeTokS: first.call.perf?.decodeTokS ?? null,
          e2eMs: first.call.perf?.e2eMs ?? null,
          wallMs: timings.translation_ms,
          parse: first.json ? 'json' : translation ? 'fallback' : 'fail',
          correctionsRaw: null,
          correctionsKept: null,
          turnNo: Math.floor(history.length / 2) + 1,
        })
      }
    }
  } catch (err) {
    // Translation failed — keep whatever was produced; the reply text is there
    void err
  }

  // ---- Diary mode: the student's own words become a diary entry (verbatim +
  //  translation + the corrections applied as the "clean" version) ----
  if (diaryMode && userText) {
    let corrected: string | undefined
    if (keptCorrections.length > 0) {
      corrected = userText
      for (const c of keptCorrections) {
        corrected = corrected.replace(c.original, c.corrected)
      }
      if (corrected === userText) corrected = undefined
    }
    const entry = diary.append(targetLang, userText, userTranslation, corrected)
    // Auto-refine for the diary's refined view: strip fillers and false
    // starts, fix grammar — in the background, never blocking the reply.
    // Runs through the shared queue so it does not contend with the turn.
    void enqueue(async () => {
      try {
        const refined = await refineDiaryPhrase(userText, level, targetLang)
        if (refined) diary.patchRefined(entry.uid, refined)
      } catch {
        /* the raw + corrected line stays — refine is a nicety */
      }
    })
  }

  // ---- TTS: prepare the selected engine (actual speech starts from the UI) ----
  const tTts = nowMs()
  let warning: string | null = null
  const ttsChoice = args.tts
  if (ttsChoice?.engine === 'phonon') {
    try {
      await phononEngine.ensure(targetLang, ttsChoice.phononBase, ttsChoice.voice, () => undefined)
    } catch {
      warning = libT('warnPhononNotReady')
    }
  } else {
    try {
      const voice = await ttsEngine.ensure(ttsChoice?.voice, targetLang)
      if (voice === null) {
        warning = libT('warnNoSystemVoice')
      }
    } catch {
      warning = libT('warnTtsUnavailable')
    }
  }
  timings.tts_ms = Math.round(nowMs() - tTts)

  conversation.addUser(targetLang, userText, userTranslation)
  conversation.addTutor(targetLang, reply, keptCorrections, translation, '')

  timings.total_ms = Math.round(nowMs() - tTotal)

  // Full round-trip record: all stage timings in one row for the benchmark
  if (tutorOption) {
    recordTurn({
      stage: 'turn',
      llmKey: tutorOption.key,
      modelId: tutorOption.modelId,
      device: llmEngine.deviceLabel,
      temperature: LLM_TEMPERATURE,
      promptTokens: null,
      completionTokens: null,
      ttftMs: null,
      prefillTokS: null,
      decodeTokS: null,
      e2eMs: null,
      wallMs: timings.total_ms,
      parse: null,
      correctionsRaw: null,
      correctionsKept: null,
      turnNo: Math.floor(history.length / 2) + 1,
    })
  }

  return {
    user_text: userText,
    user_translation: userTranslation,
    reply,
    corrections: keptCorrections,
    translation,
    follow_up: '',
    follow_up_translation: '',
    suggestions,
    // no wav files in the browser version; a marker that the line can be spoken
    audio_url: 'speech',
    warning,
    timings,
  }
}

export interface DiaryRefineResult {
  /** coherent diary page in the target language */
  text: string
  /** UI-language translation ('' when unavailable) */
  translation: string
}

/** Diary "refined" view: rewrite the day's raw lines into one readable page
 *  (target language), then translate it for comfortable re-reading. */
export async function processDiaryRefine(args: {
  /** raw diary lines (corrected versions win when present) */
  lines: string[]
  level: Level
  targetLang: TargetLang
  uiLang: UiLang
  llmKey: string
}): Promise<DiaryRefineResult> {
  const { level, targetLang, uiLang, llmKey } = args
  if (llmEngine.loadedKey === null || llmEngine.loadedKey !== llmKey) {
    throw new ModelsNotReadyError(libT('errModelsNotReady'))
  }
  const lines = args.lines.map(l => l.trim()).filter(Boolean)
  if (lines.length === 0) throw new InvalidParameterError(libT('errNeedInput'))

  const refineOnce = async (languageRetry: boolean): Promise<string> => {
    const call = await llmEngine.chat(buildDiaryRefineMessages(level, targetLang, lines, languageRetry), {
      temperature: 0.5,
    })
    const text = stripQuoteWrappers(stripThink(call.text.trim()))
    return text.length > 0 && text.length <= 4000 ? text : ''
  }

  let text = await refineOnce(false)
  if (!text || (targetLang !== 'en' && looksEnglish(text))) {
    const retry = await refineOnce(true)
    if (retry && !(targetLang !== 'en' && looksEnglish(retry))) text = retry
  }
  if (!text) throw new PipelineError(libT('errLlmFailed', { reason: libT('modelError') }))

  // translation for comfortable re-reading — best effort, never fails the page
  let translation = ''
  try {
    const trCall = await llmEngine.chat(buildSingleTranslateMessages(targetLang, uiLang, text), {
      temperature: LLM_TRANSLATION_TEMPERATURE,
    })
    const candidate = parseSingleTranslation(trCall.text)
    if (translationOk(candidate, uiLang) && translationSane(text, candidate, uiLang, false)) {
      translation = candidate
    }
  } catch {
    /* the refined page works without a translation */
  }

  return { text, translation }
}

export interface VocabResult {
  item: { word: string; translation: string; part_of_speech: string; example: string; example_translation: string }
  existed: boolean
}

/** Port of Pipeline.lookup_word: LLM dictionary + offline dictionary (de) + store insert */
export async function processVocab(
  word: string,
  llmKey: string,
  targetLang: TargetLang,
  uiLang: UiLang = 'ru',
): Promise<VocabResult> {
  if (llmEngine.loadedKey === null || llmEngine.loadedKey !== llmKey) {
    throw new ModelsNotReadyError(libT('errModelsNotReady'))
  }
  const cleaned = word.split(/\s+/).filter(Boolean).join(' ')
  if (!cleaned || cleaned.length > 80) {
    throw new InvalidParameterError(libT('errVocabEmpty'))
  }
  const messages = buildVocabMessages(targetLang, uiLang, cleaned)
  let vocabCall: Awaited<ReturnType<typeof llmEngine.chat>>
  try {
    vocabCall = await llmEngine.chat(messages, { temperature: LLM_VOCAB_TEMPERATURE })
  } catch (err) {
    if (err instanceof LlmError) throw new PipelineError(err.message)
    throw new PipelineError(libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }))
  }
  const data = parseVocabJson(vocabCall.text)
  if (data === null) {
    throw new PipelineError(libT('errVocabFailed'))
  }
  const vocabOption = llmModelByKey(llmKey)
  recordTurn({
    stage: 'vocab',
    llmKey,
    modelId: vocabOption.modelId,
    device: llmEngine.deviceLabel,
    temperature: LLM_VOCAB_TEMPERATURE,
    promptTokens: vocabCall.perf?.promptTokens ?? null,
    completionTokens: vocabCall.perf?.completionTokens ?? null,
    ttftMs: vocabCall.perf?.ttftMs ?? null,
    prefillTokS: vocabCall.perf?.prefillTokS ?? null,
    decodeTokS: vocabCall.perf?.decodeTokS ?? null,
    e2eMs: vocabCall.perf?.e2eMs ?? null,
    wallMs: null,
    parse: 'json',
    correctionsRaw: null,
    correctionsKept: null,
    turnNo: null,
  })
  if (!data.exists) {
    const comment = data.comment || vocabNotRealDefaultComment()
    throw new InvalidParameterError(
      libT('errVocabNotReal', { word: cleaned, comment }),
    )
  }
  const finalWord = data.word || cleaned
  // The offline dictionary currently exists for German only (deu-rus)
  const dictHit = langInfo(targetLang).hasOfflineDict
    ? await lookupDictionary(finalWord)
    : { translations: [], pos: '' }
  const translation = dictHit.translations.length > 0 ? dictHit.translations.join(', ') : data.translation
  const partOfSpeech = dictHit.pos || data.part_of_speech
  const preexisting = vocab.exists(targetLang, cleaned)
  const item = vocab.add(targetLang, finalWord, translation, partOfSpeech, data.example, data.example_translation)
  return {
    item: {
      word: item.word,
      translation: item.translation,
      part_of_speech: item.part_of_speech,
      example: item.example,
      example_translation: item.example_translation,
    },
    existed: preexisting !== null,
  }
}

/** Speak a tutor line or word with the selected engine (called from the UI) */
export async function speak(text: string, opts: SpeakOptions): Promise<void> {
  if (opts.engine === 'phonon') {
    const result = await phononEngine.speak(text, opts.rate, opts.voice)
    opts.onFirstAudio?.(result.firstAudioMs)
    return
  }
  await ttsEngine.speak(text, opts.rate, opts.targetLang, { voiceUri: opts.voice, onFirstAudio: opts.onFirstAudio })
}

export function cancelSpeech(): void {
  phononEngine.cancel()
  ttsEngine.cancel()
}

export { BadAudioError, EmptyAudioError }
