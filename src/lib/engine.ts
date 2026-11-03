// Port of backend/services/pipeline.py: the same pipeline
// (audio → VAD → ASR → tutor LLM → translation LLM → TTS → history)
// with the same timings, but fully inside the tab and in any of the five languages.
// One request at a time — the analog of the native server's gpu_lock.

import { asrEngine, AsrError } from './asr'
import { decodeBlobToPcm16k, detectSpeech, trimSilence, BadAudioError, EmptyAudioError } from './audio'
import { recordTurn } from './bench'
import { libT } from '../i18n'
import { langInfo, type TargetLang } from './langs'
import { llmEngine, LlmError, llmModelByKey } from './llm'
import {
  filterCorrections,
  hasCyrillic,
  parseTranslationJson,
  parseTutorReply,
  parseVocabJson,
  stripQuoteWrappers,
  stripThink,
} from './parse'
import {
  buildTutorMessages,
  buildTutorMessagesSimple,
  buildCorrectionsMessages,
  buildTranslateMessages,
  buildVocabMessages,
  vocabNotRealDefaultComment,
  type LlmMessage,
} from '../prompts'
import { parseCorrectionsJson } from './parse'
import { contextWindowFor } from './llm'
import { conversation, lookupDictionary, vocab } from './store'
import { ttsEngine } from './tts'
import { phononEngine } from './ttsPhonon'
import type { ChatResponse, Correction, Level, Suggestion, TtsEngineKind } from '../types'
import type { UiLang } from '../i18n'

export class PipelineError extends Error {}
export class ModelsNotReadyError extends PipelineError {}
export class InvalidParameterError extends PipelineError {}

const LLM_TEMPERATURE = 0.7
const LLM_TRANSLATION_TEMPERATURE = 0.2
const LLM_VOCAB_TEMPERATURE = 0.3
const LLM_CORRECTIONS_TEMPERATURE = 0.2

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

/** Is the translation in the UI language? ru — Cyrillic, en — Latin without Cyrillic */
function translationOk(text: string, uiLang: UiLang): boolean {
  if (!text) return false
  if (uiLang === 'ru') return hasCyrillic(text)
  return /[a-zà-ÿ]/i.test(text) && !hasCyrillic(text)
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
    let text: string
    try {
      text = await asrEngine.transcribe(trimmed, targetLang)
    } catch (err) {
      if (err instanceof AsrError) throw err
      throw new PipelineError(libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }))
    }
    timings.asr_ms = Math.round(nowMs() - t0)
    timings.speech_ms = Math.round(vad.speechMs)
    if (!text) throw new EmptyAudioError(libT('errAsrFailed'))
    userText = text
  }

  // ---- LLM: tutor reply (tiny models use the 2-key contract, corrections
  //  move to their own single-key call) ----
  const history = conversation.historyForLlm(targetLang, 50)
  const tutorOption0 = llmEngine.loadedKey ? llmModelByKey(llmEngine.loadedKey) : null
  const tiny = Boolean(tutorOption0?.tiny)
  const builtMessages = tiny
    ? buildTutorMessagesSimple(history, userText, level, targetLang, uiLang, extraPrompt)
    : buildTutorMessages(history, userText, level, targetLang, uiLang, extraPrompt)
  const trimmed = tutorOption0 ? trimHistoryToFit(builtMessages, tutorOption0.modelId, tutorOption0.key) : { messages: builtMessages, trimmedPairs: 0 }
  const messages = trimmed.messages
  const tLlm = nowMs()
  let tutorCall: Awaited<ReturnType<typeof llmEngine.chat>>
  try {
    tutorCall = await llmEngine.chat(messages, { temperature: LLM_TEMPERATURE })
  } catch (err) {
    if (err instanceof LlmError) throw new PipelineError(err.message)
    throw new PipelineError(libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }))
  }
  timings.llm_ms = Math.round(nowMs() - tLlm)

  const parsed = parseTutorReply(tutorCall.text)
  let keptCorrections: Correction[] = filterCorrections(parsed.corrections, userText)
  const suggestions: Suggestion[] = parsed.suggestions
  const tutorOption = tutorOption0

  // calibrate the token estimator with the real measurement
  if (tutorOption && tutorCall.perf?.promptTokens) {
    const promptChars = messages.reduce((acc, m) => acc + m.content.length + 8, 0)
    charsPerToken.set(tutorOption.modelId, promptChars / tutorCall.perf.promptTokens)
  }

  // tiny tier: corrections as a separate single-key call
  if (tiny && tutorOption) {
    const tCorr = nowMs()
    try {
      const corrCall = await llmEngine.chat(buildCorrectionsMessages(targetLang, uiLang, userText), {
        temperature: LLM_CORRECTIONS_TEMPERATURE,
        maxTokens: 400,
      })
      timings.corrections_ms = Math.round(nowMs() - tCorr)
      const corrParsed = parseCorrectionsJson(corrCall.text)
      keptCorrections = filterCorrections(corrParsed.corrections, userText)
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
    } catch {
      // corrections are an enhancement, not a requirement — keep the reply
      timings.corrections_ms = Math.round(nowMs() - tCorr)
    }
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
      parse: parsed.method,
      correctionsRaw: parsed.corrections.length,
      correctionsKept: keptCorrections.length,
      turnNo: Math.floor(history.length / 2) + 1,
      schema: tiny ? 'tiny' : 'full',
    })
  }

  // ---- LLM: translation (second call, temp 0.2) ----
  let translation = ''
  let userTranslation = ''
  const tTr = nowMs()
  try {
    const trMessages = buildTranslateMessages(targetLang, uiLang, userText, parsed.reply)
    const trCall = await llmEngine.chat(trMessages, { temperature: LLM_TRANSLATION_TEMPERATURE })
    const rawTr = trCall.text.trim()
    const parsedTr = parseTranslationJson(rawTr)
    if (parsedTr !== null) {
      translation = parsedTr.reply
      userTranslation = parsedTr.user
    } else {
      // Bare-text fallback: strip <think> blocks first if the model emitted
      // them, otherwise its reasoning leaks into the translation field
      const bare = stripQuoteWrappers(stripThink(rawTr))
      translation = bare.length > 0 && bare.length <= 400 ? bare : ''
    }
    if (!translationOk(translation, uiLang)) translation = ''
    if (!translationOk(userTranslation, uiLang)) userTranslation = ''
    timings.translation_ms = Math.round(nowMs() - tTr)
    if (tutorOption) {
      recordTurn({
        stage: 'translation',
        llmKey: tutorOption.key,
        modelId: tutorOption.modelId,
        device: llmEngine.deviceLabel,
        temperature: LLM_TRANSLATION_TEMPERATURE,
        promptTokens: trCall.perf?.promptTokens ?? null,
        completionTokens: trCall.perf?.completionTokens ?? null,
        ttftMs: trCall.perf?.ttftMs ?? null,
        prefillTokS: trCall.perf?.prefillTokS ?? null,
        decodeTokS: trCall.perf?.decodeTokS ?? null,
        e2eMs: trCall.perf?.e2eMs ?? null,
        wallMs: timings.translation_ms,
        parse: parsedTr !== null ? 'json' : translation ? 'fallback' : 'fail',
        correctionsRaw: null,
        correctionsKept: null,
        turnNo: Math.floor(history.length / 2) + 1,
      })
    }
  } catch (err) {
    // Translation failed — take the tutor reply's own translation field if present
    translation = parsed.translation || translation
    void err
  }

  // ---- TTS: prepare the selected engine (actual speech starts from the UI) ----
  const tTts = nowMs()
  let warning: string | null = null
  const ttsChoice = args.tts
  if (ttsChoice?.engine === 'phonon') {
    try {
      await phononEngine.ensure(targetLang, ttsChoice.phononBase, () => undefined)
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
  conversation.addTutor(targetLang, parsed.reply, keptCorrections, translation, parsed.follow_up)

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
    reply: parsed.reply,
    corrections: keptCorrections,
    translation,
    follow_up: parsed.follow_up,
    follow_up_translation: parsed.follow_up_translation,
    suggestions,
    // no wav files in the browser version; a marker that the line can be spoken
    audio_url: 'speech',
    warning,
    timings,
  }
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
  const dictHit = langInfo(targetLang).hasOfflineDict ? lookupDictionary(finalWord) : { translations: [], pos: '' }
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
