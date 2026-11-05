// The conversation turn pipeline: audio → VAD → ASR → tutor → translation →
// TTS preparation → persisted history. This is the application core; it
// depends only on ports, so every stage is unit-testable with fakes.
//
// One request at a time — the analog of the native server's gpu_lock.

import type {
  ActivityRepository,
  AsrPort,
  BrainPort,
  ClockPort,
  ConversationRepository,
  DiaryRepository,
  DictionaryPort,
  SessionRepository,
  SpeechPort,
  SpeechSelection,
  TelemetryPort,
} from '../ports'
import {
  AsrError,
  EmptyAudioError,
  InvalidParameterError,
  LlmError,
  ModelsNotReadyError,
  PipelineError,
} from '../errors'
import type {
  DiaryRefineResult,
  Level,
  Correction,
  LlmMessage,
  Suggestion,
  TargetLang,
  TurnInput,
  TurnResult,
  UiLang,
} from '../../domain/models'
import type { ParseOutcome } from '../telemetry'
import {
  BadAudioError as DomainBadAudioError,
  decodeBlobToPcm16k,
  detectSpeech,
  splitAtSilence,
  trimSilence,
} from '../../domain/policies/audio'
import {
  collapseAsrRepetition,
  isAsrHallucination,
  isCollapsedLoop,
  isDegenerateTranscript,
} from '../../domain/policies/asrText'
import {
  cleanSuggestions,
  hasWrongScript,
  parseSingleTranslation,
  rescueYesNoQuestion,
  samePhrase,
  stripForeignParens,
  translationOk,
  translationSane,
} from '../../domain/policies/translation'
import { tinyCorrections } from '../../domain/policies/corrections'
import { freeTalkFallback, sameAssistantReply, stripAssistantOffers } from '../../domain/policies/freeTalk'
import {
  FAREWELL_RE,
  INTRO_RE,
  NAME_QUESTION_RE,
  TUTOR_FALLBACK,
  TUTOR_FAREWELL,
  TUTOR_FAREWELL_TRANSLATION,
  langInfo,
} from '../../domain/policies/languages'
import {
  filterCorrections,
  parseSuggestionsJson,
  parseTranslationJson,
  parseTutorReply,
  stripQuoteWrappers,
  stripThink,
} from '../../domain/policies/parse'
import {
  buildDiaryFactsMessages,
  buildDiaryRefineMessages,
  buildFreeTalkMessages,
  buildSingleTranslateMessages,
  buildSuggestionsMessages,
  buildTranslateMessages,
  buildTutorMessages,
  scenarioGrounding,
} from '../../domain/policies/prompts'
import {
  ensurePrescribedQuestion,
  looksEnglishDrift,
  polishReply,
  runDiaryTurn,
  runTinyTutorTurn,
  templateFloor,
  type TutorParts,
} from '../../domain/policies/tutor'
import { newSession, scenarioById, selectScenario } from '../../domain/policies/scenarios'
import { planTutorTurn, scenarioToSpec } from '../../domain/policies/scenarioSpec'
import { libT } from '../../shared/i18nStrings'

const LLM_TEMPERATURE = 0.7
const LLM_TRANSLATION_TEMPERATURE = 0.2
const LLM_SUGGESTIONS_TEMPERATURE = 0.5
const DEFAULT_CHARS_PER_TOKEN = 3.2

export interface TurnOptions {
  level: Level
  targetLang: TargetLang
  uiLang: UiLang
  llmKey: string
  extraPrompt?: string
  /** explicitly chosen scenario id (the topic picker) — overrides topic text */
  topicId?: string
  /** diary mode: supportive listener, messages go to the diary */
  diaryMode?: boolean
  /** free conversational actor: no scenario, no scripted question */
  freeTalk?: boolean
  /** sampling temperature for free talk (default 0.8) */
  temperature?: number
  /** name of the selected TTS voice (free-talk persona) */
  tutorName?: string
  /** speech engine preparation at the end of the turn */
  speech: SpeechSelection
}

export interface TurnServiceDeps {
  brain: BrainPort
  asr: AsrPort
  speech: SpeechPort
  conversation: ConversationRepository
  diary: DiaryRepository
  sessions: SessionRepository
  activity: ActivityRepository
  dictionary: DictionaryPort
  telemetry: TelemetryPort
  clock: ClockPort
}

/** Chars-per-token calibration per model, updated after every tutor call with
 *  the real prompt_tokens — feeds the history auto-trim estimator. */
const charsPerToken = new Map<string, number>()

export class TurnService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: TurnServiceDeps) {}

  process(input: TurnInput, opts: TurnOptions): Promise<TurnResult> {
    const run = this.queue.then(
      () => this.processInner(input, opts),
      () => this.processInner(input, opts),
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  private now(): number {
    return this.deps.clock.nowMs()
  }

  private record(turn: Parameters<TelemetryPort['recordTurn']>[0]): void {
    this.deps.telemetry.recordTurn({ ...turn, ts: this.now() })
  }

  private async processInner(input: TurnInput, opts: TurnOptions): Promise<TurnResult> {
    const { level, llmKey, targetLang, uiLang, extraPrompt = '' } = opts
    const brain = this.deps.brain

    if (this.deps.asr.loadedKey === null) {
      throw new ModelsNotReadyError(libT('errModelsNotReady'))
    }
    if (brain.kind === 'local') {
      if (!brain.isReady()) throw new ModelsNotReadyError(libT('errModelsNotReady'))
      if (brain.modelKey !== llmKey) throw new ModelsNotReadyError(libT('errModelSwitching'))
    }

    const timings: Record<string, number> = {}
    const tTotal = this.now()

    let userText = (input.text ?? '').trim()
    if (userText && userText.length > 500) throw new InvalidParameterError(libT('errTextTooLong'))

    if (!userText) {
      if (!input.blob) throw new InvalidParameterError(libT('errNeedInput'))
      const t0 = this.now()
      let pcm: Float32Array
      try {
        pcm = await decodeBlobToPcm16k(input.blob)
      } catch (err) {
        if (err instanceof DomainBadAudioError) throw new InvalidParameterError(err.message)
        throw new PipelineError(libT('errBadAudio'))
      }
      timings.convert_ms = Math.round(this.now() - t0)
      const vad = detectSpeech(pcm, 16000)
      if (!vad.isSpeech) throw new EmptyAudioError(libT('errSilence'))
      const trimmed = trimSilence(pcm, vad, 16000)
      const longUtterance = trimmed.length / 16000 > 15
      const segments = longUtterance
        ? splitAtSilence(trimmed, 16000, { splitAboveMs: 15_000 })
        : [trimmed]
      let text: string
      let rawText = ''
      try {
        let joined = ''
        if (segments.length === 1) {
          joined = await this.deps.asr.transcribe(segments[0], targetLang, { long: longUtterance })
        } else {
          const parts = await Promise.all(segments.map(seg => this.deps.asr.transcribe(seg, targetLang)))
          joined = parts.filter(Boolean).map(p => p.trim()).join(' ')
        }
        rawText = joined
        text = collapseAsrRepetition(joined)
      } catch (err) {
        if (err instanceof AsrError) throw err
        throw new PipelineError(
          libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }),
        )
      }
      timings.asr_ms = Math.round(this.now() - t0)
      timings.speech_ms = Math.round(vad.speechMs)
      if (!text) throw new EmptyAudioError(libT('errAsrFailed'))
      if (isDegenerateTranscript(rawText) || isCollapsedLoop(rawText, text)) {
        throw new EmptyAudioError(libT('errNothingHeard'))
      }
      if (isAsrHallucination(text)) throw new EmptyAudioError(libT('errNothingHeard'))
      userText = text
    }

    const history = this.deps.conversation.historyForLlm(targetLang, 50)

    // Free-talk / actor mode: no scenario, no prescribed question, no chips.
    // The model gets the real dialog history so it can be evaluated as-is.
    if (opts.freeTalk && !opts.diaryMode) {
      return this.freeTurn({ userText, history, opts, timings, tTotal })
    }

    // ---- Scenario session: the deterministic half ----
    const tiny = brain.tiny
    const diaryMode = Boolean(opts.diaryMode)
    const topicId = opts.topicId?.trim() || undefined
    const activeScenario = selectScenario(targetLang, level, extraPrompt, topicId)
    const sessionKey = topicId ?? extraPrompt
    let session = this.deps.sessions.get(targetLang)
    if (
      history.length === 0 ||
      !session ||
      scenarioById(session.scenarioId) === null ||
      session.topicKey !== sessionKey
    ) {
      session = newSession(activeScenario, sessionKey)
    }
    const scenario = scenarioById(session.scenarioId) ?? activeScenario

    let reply = ''
    let suggestions: Suggestion[] = []
    let keptCorrections: Correction[] = []
    let tutorMethod: ParseOutcome = 'plain'
    let tutorParts: TutorParts | null = null
    const chat = brain.chat

    const runCorrections = async (): Promise<void> => {
      const tCorr = this.now()
      try {
        const result = await tinyCorrections({ chat, userText, targetLang })
        timings.corrections_ms = Math.round(this.now() - tCorr)
        keptCorrections = filterCorrections(result.corrections, userText, uiLang)
        const okCalls = result.calls.filter(c => c.fixed !== null).length
        this.record({
          stage: 'corrections',
          llmKey: brain.modelKey,
          modelId: brain.modelId,
          device: brain.device,
          temperature: 0,
          promptTokens: null,
          completionTokens: null,
          ttftMs: null,
          prefillTokS: null,
          decodeTokS: null,
          e2eMs: null,
          wallMs: timings.corrections_ms,
          parse: okCalls === result.calls.length ? 'json' : okCalls > 0 ? 'repaired' : 'fail',
          correctionsRaw: result.corrections.length,
          correctionsKept: keptCorrections.length,
          turnNo: null,
          schema: 'tiny',
        })
      } catch {
        // corrections are an enhancement, not a requirement — keep the reply
        timings.corrections_ms = Math.round(this.now() - tCorr)
      }
    }

    if (diaryMode) {
      await runCorrections()
      const tLlm = this.now()
      const dst = this.deps.diary.state(targetLang)
      const opening = history.length === 0
      const plan = await runDiaryTurn({
        chat,
        userText,
        level,
        targetLang,
        extraPrompt,
        qIdx: dst.qIdx,
        opening,
      })
      this.deps.diary.setState(targetLang, { qIdx: plan.session.nextIndex })
      reply = plan.reply
      suggestions = plan.suggestions
      tutorMethod = plan.method
      tutorParts = plan.parts
      timings.llm_ms = Math.round(this.now() - tLlm)
      this.record({
        stage: 'tutor',
        llmKey: brain.modelKey,
        modelId: brain.modelId,
        device: brain.device,
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
    } else if (tiny) {
      // Tiny tier: corrections FIRST so the reaction can recast the fixed form
      await runCorrections()
      const tLlm = this.now()
      const plan = await runTinyTutorTurn({
        chat,
        userText,
        level,
        targetLang,
        extraPrompt,
        scenario,
        session,
        corrections: keptCorrections,
      })
      this.deps.sessions.set(targetLang, plan.session)
      reply = plan.reply
      suggestions = plan.suggestions
      tutorMethod = plan.method
      tutorParts = plan.parts
      timings.llm_ms = Math.round(this.now() - tLlm)
      this.record({
        stage: 'tutor',
        llmKey: brain.modelKey,
        modelId: brain.modelId,
        device: brain.device,
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
    } else {
      // Full tier: the model writes the whole reply around the prescribed question
      // The controller owns the lesson structure: which question is allowed,
      // when the guided phase ends and when a controlled free phase starts.
      const spec = scenarioToSpec(scenario)
      let plan = planTutorTurn(spec, session)
      const fullIntroMatch = INTRO_RE[targetLang].exec(userText)
      if (fullIntroMatch && plan.phase === 'guided' && plan.question !== null && NAME_QUESTION_RE.test(plan.question)) {
        const i = Math.max(session.nextIndex, 1)
        if (i < scenario.turns.length) {
          plan = planTutorTurn(spec, { ...session, nextIndex: i, phase: 'guided', stayCount: 0 })
        }
      }
      const question = plan.question
      const builtMessages = buildTutorMessages(history, userText, level, targetLang, uiLang, extraPrompt, false, {
        block: scenarioGrounding(scenario, question),
        tutorName: opts.tutorName,
      })
      const trimmed = trimHistoryToFit(builtMessages, brain.promptBudget, brain.modelId)
      const messages = trimmed.messages
      const tLlm = this.now()
      let tutorCall
      try {
        tutorCall = await chat(messages, { temperature: LLM_TEMPERATURE })
      } catch (err) {
        if (err instanceof LlmError) throw new PipelineError(err.message)
        throw new PipelineError(
          libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }),
        )
      }

      // Language-drift rescue: one retry with a hard language rule
      if (
        targetLang !== 'en' &&
        looksEnglishDrift(parseTutorReply(tutorCall.text, targetLang).reply, targetLang)
      ) {
        const retryBuilt = buildTutorMessages(history, userText, level, targetLang, uiLang, extraPrompt, true, {
          block: scenarioGrounding(scenario, question),
          tutorName: opts.tutorName,
        })
        const retryTrimmed = trimHistoryToFit(retryBuilt, brain.promptBudget, brain.modelId)
        try {
          const retryCall = await chat(retryTrimmed.messages, { temperature: LLM_TEMPERATURE })
          if (!looksEnglishDrift(parseTutorReply(retryCall.text, targetLang).reply, targetLang)) {
            tutorCall = retryCall
          }
        } catch {
          /* keep the first reply — it is better than nothing */
        }
      }
      timings.llm_ms = Math.round(this.now() - tLlm)

      const parsed = parseTutorReply(tutorCall.text, targetLang)
      keptCorrections = filterCorrections(parsed.corrections, userText, uiLang)
      tutorMethod = parsed.method
      reply = ensurePrescribedQuestion(parsed.reply, question)
      reply = polishReply(reply, { maxWords: level === 'A1' ? 28 : 40 })
      if (looksEnglishDrift(reply, targetLang) || hasWrongScript(reply, targetLang)) {
        const floor = templateFloor(targetLang, scenario, session, userText)
        reply = polishReply(question ? `${floor} ${question}` : floor, {
          maxWords: level === 'A1' ? 28 : 40,
        })
        tutorMethod = 'template'
      }
      suggestions = plan.chips
      if (suggestions.length === 0) suggestions = cleanSuggestions(parsed.suggestions, uiLang, targetLang)
      this.deps.sessions.set(targetLang, plan.nextSession)

      if (tutorCall.perf?.promptTokens) {
        const promptChars = messages.reduce((acc, m) => acc + m.content.length + 8, 0)
        charsPerToken.set(brain.modelId, promptChars / tutorCall.perf.promptTokens)
      }
      this.record({
        stage: 'tutor',
        llmKey: brain.modelKey,
        modelId: brain.modelId,
        device: brain.device,
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

    // ---- Suggestions rescue: only when the scenario chips came up empty ----
    if (suggestions.length === 0 && !tiny) {
      const tSugg = this.now()
      try {
        const suggCall = await chat(buildSuggestionsMessages(level, targetLang, reply), {
          temperature: LLM_SUGGESTIONS_TEMPERATURE,
          maxTokens: 200,
        })
        timings.suggestions_ms = Math.round(this.now() - tSugg)
        const suggParsed = parseSuggestionsJson(suggCall.text)
        suggestions = cleanSuggestions(suggParsed.suggestions, uiLang, targetLang)
        this.record({
          stage: 'suggestions',
          llmKey: brain.modelKey,
          modelId: brain.modelId,
          device: brain.device,
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
        timings.suggestions_ms = Math.round(this.now() - tSugg)
      }
    }

    // ---- Translation (second call(s), temp 0.2) ----
    let translation = ''
    let userTranslation = ''
    let dictUserTranslation = ''
    if (userText && uiLang === 'ru' && langInfo(targetLang).hasOfflineDict) {
      const single = userText.replace(/[.,!?;:]+\s*$/, '').trim()
      if (single && !single.includes(' ')) {
        const hit = await this.deps.dictionary.lookup(single)
        if (hit.translations.length > 0) dictUserTranslation = hit.translations[0]
      }
    }
    const sameLanguage = targetLang === uiLang
    const tTr = this.now()
    try {
      const validTr = (candidate: string, source: string): string => {
        const line = stripForeignParens(candidate.trim(), uiLang)
        return translationOk(line, uiLang) && translationSane(source, line, uiLang, true) ? line : ''
      }
      const looseTr = (candidate: string, source: string): string => {
        const line = stripForeignParens(candidate.trim(), uiLang)
        return translationOk(line, uiLang) && translationSane(source, line, uiLang, false) ? line : ''
      }

      const translateOne = async (text: string, strictPrompt = false) => {
        const call = await chat(buildSingleTranslateMessages(targetLang, uiLang, text, strictPrompt), {
          temperature: LLM_TRANSLATION_TEMPERATURE,
          maxTokens: 220,
          stop: ['\n'],
        })
        return { text: parseSingleTranslation(call.text), call }
      }

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

      if (sameLanguage) {
        timings.translation_ms = 0
      } else if (tiny) {
        let replyCall: Awaited<ReturnType<typeof chat>> | null = null
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
          if (FAREWELL_RE[targetLang].test(userText) && userText.trim().split(/\s+/).length <= 4) {
            userTranslation = uiLang === 'ru' ? 'Пока! До встречи!' : 'Bye! See you!'
          } else {
            const userDone = await translateOneValidated(userText)
            userTranslation = userDone.line
            replyCall = userDone.call
          }
        }
        timings.translation_ms = Math.round(this.now() - tTr)
        this.record({
          stage: 'translation',
          llmKey: brain.modelKey,
          modelId: brain.modelId,
          device: brain.device,
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
      } else {
        const translateOnce = async (strict: boolean) => {
          const trMessages = buildTranslateMessages(targetLang, uiLang, userText, reply, strict)
          const trCall = await chat(trMessages, { temperature: LLM_TRANSLATION_TEMPERATURE })
          const rawTr = trCall.text.trim()
          const parsedTr = parseTranslationJson(rawTr)
          if (parsedTr !== null) {
            return { user: parsedTr.user, reply: parsedTr.reply, json: true, call: trCall }
          }
          const bare = stripQuoteWrappers(stripThink(rawTr))
          return {
            user: '',
            reply: bare.length > 0 && bare.length <= 400 ? bare : '',
            json: false,
            call: trCall,
          }
        }

        const first = await translateOnce(false)
        let replyTr = validTr(first.reply, reply)
        let userTr = userText ? validTr(first.user, userText) : ''
        if (!replyTr || (userText && !userTr && first.user)) {
          const second = await translateOnce(true)
          replyTr = replyTr || validTr(second.reply, reply)
          userTr = userTr || validTr(second.user, userText)
          if (!replyTr) {
            replyTr =
              looseTr(second.reply, reply) ||
              looseTr(first.reply, reply) ||
              rescueYesNoQuestion(reply, second.reply, uiLang, targetLang) ||
              rescueYesNoQuestion(reply, first.reply, uiLang, targetLang)
          }
          if (userText && !userTr) {
            userTr =
              looseTr(second.user, userText) ||
              looseTr(first.user, userText) ||
              rescueYesNoQuestion(userText, second.user, uiLang, targetLang) ||
              rescueYesNoQuestion(userText, first.user, uiLang, targetLang)
          }
        }
        if (userText && !userTr && !dictUserTranslation) {
          const userSingle = await translateOne(userText)
          userTr = validTr(userSingle.text, userText) || looseTr(userSingle.text, userText)
        }
        translation = replyTr
        userTranslation = dictUserTranslation || userTr
        timings.translation_ms = Math.round(this.now() - tTr)
        this.record({
          stage: 'translation',
          llmKey: brain.modelKey,
          modelId: brain.modelId,
          device: brain.device,
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
    } catch {
      // Translation failed — keep whatever was produced; the reply text is there
    }

    // ---- Diary mode: the student's own words become a diary entry ----
    if (diaryMode && userText) {
      let corrected: string | undefined
      if (keptCorrections.length > 0) {
        corrected = userText
        for (const c of keptCorrections) corrected = corrected.replace(c.original, c.corrected)
        if (corrected === userText) corrected = undefined
      }
      this.deps.diary.append({ lang: targetLang, text: userText, translation: userTranslation, corrected })
    }

    // ---- Speech: prepare the selected engine (actual speech starts from the UI) ----
    const tTts = this.now()
    let warning: string | null = null
    try {
      const prepared = await this.deps.speech.ensure(targetLang, opts.speech)
      warning = prepared.warning
    } catch {
      warning = libT('warnTtsUnavailable')
    }
    timings.tts_ms = Math.round(this.now() - tTts)

    this.deps.conversation.addUser(targetLang, userText, userTranslation)
    this.deps.conversation.addTutor(targetLang, reply, keptCorrections, translation, '')
    this.deps.activity.bump()
    timings.total_ms = Math.round(this.now() - tTotal)

    this.record({
      stage: 'turn',
      llmKey: brain.modelKey,
      modelId: brain.modelId,
      device: brain.device,
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

    return {
      userText,
      userTranslation,
      reply,
      corrections: keptCorrections,
      translation,
      followUp: '',
      followUpTranslation: '',
      suggestions,
      canSpeak: true,
      warning,
      timings,
    }
  }

  /** Free-talk turn: plain chatbot behaviour, no deterministic scaffolding. */
  private async freeTurn(args: {
    userText: string
    history: LlmMessage[]
    opts: TurnOptions
    timings: Record<string, number>
    tTotal: number
  }): Promise<TurnResult> {
    const { userText, history, opts, timings, tTotal } = args
    const { level, targetLang, uiLang, extraPrompt = '' } = opts
    const temperature = opts.temperature ?? 0.7
    const brain = this.deps.brain
    const chat = brain.chat
    const wrongLanguage = (text: string): boolean =>
      targetLang !== 'en'
        ? looksEnglishDrift(text, targetLang) || hasWrongScript(text, targetLang)
        : hasWrongScript(text, targetLang)

    const build = (retry: boolean): LlmMessage[] =>
      trimHistoryToFit(
        buildFreeTalkMessages(history, userText, level, targetLang, uiLang, opts.tutorName ?? 'Alex', extraPrompt, retry),
        brain.promptBudget,
        brain.modelId,
      ).messages

    const tLlm = this.now()
    const messages = build(false)
    let call
    try {
      call = await chat(messages, { temperature, maxTokens: 320 })
    } catch (err) {
      if (err instanceof LlmError) throw new PipelineError(err.message)
      throw new PipelineError(
        libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }),
      )
    }
    const clean = (raw: string): string =>
      polishReply(stripQuoteWrappers(stripThink(raw.trim())), { maxWords: 80, allowZeroQuestions: true })
    let reply = stripAssistantOffers(clean(call.text))
    let warning: string | null = null

    // Qwen1.5B sometimes answers a whole turn with "Как я могу помочь?".
    // The prompt reduces it; this repair + fallback removes it deterministically.
    if (!reply) {
      try {
        const repair = build(false)
        repair[0] = {
          ...repair[0],
          content: `${repair[0].content}\n\nВЕРНИСЬ К РОЛИ: прошлый ответ был языком службы поддержки. Ответь как Анна — живая знакомая, без предложения помощи и без фразы «чем я могу помочь».`,
        }
        const repairCall = await chat(repair, { temperature, maxTokens: 320 })
        reply = stripAssistantOffers(clean(repairCall.text))
        if (reply) call = repairCall
      } catch {
        /* use the fallback below */
      }
      if (!reply) reply = freeTalkFallback(targetLang)
    }

    // A small model sometimes repeats its previous line verbatim after a
    // correction ("Извините за путаницу!") — retry once, then use a short
    // natural fallback instead of showing the same sentence again.
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant')?.content ?? ''
    const lastUser = [...history].reverse().find(m => m.role === 'user')?.content ?? ''
    if (reply && lastAssistant && userText.trim() !== lastUser.trim() && sameAssistantReply(reply, lastAssistant)) {
      try {
        const retry = build(false)
        retry[0] = {
          ...retry[0],
          content: `${retry[0].content}\n\nНЕ ПОВТОРЯЙ свой предыдущий ответ. Отреагируй на последнее сообщение собеседника по-новому.`,
        }
        const retryCall = await chat(retry, { temperature, maxTokens: 320 })
        const candidate = stripAssistantOffers(clean(retryCall.text))
        reply = candidate && !sameAssistantReply(candidate, lastAssistant) ? candidate : freeTalkFallback(targetLang)
        if (candidate) call = retryCall
      } catch {
        reply = freeTalkFallback(targetLang)
      }
    }

    if (reply && wrongLanguage(reply)) {
      try {
        const retry = await chat(build(true), { temperature, maxTokens: 320 })
        const retryReply = stripAssistantOffers(clean(retry.text))
        if (retryReply && !wrongLanguage(retryReply)) {
          reply = retryReply
          call = retry
        } else {
          warning = libT('warnLanguageDrift')
        }
      } catch {
        warning = libT('warnLanguageDrift')
      }
    }
    if (!reply) {
      reply = TUTOR_FALLBACK[targetLang]
      warning = libT('warnLanguageDrift')
    }
    timings.llm_ms = Math.round(this.now() - tLlm)
    if (call.perf?.promptTokens) {
      const promptChars = messages.reduce((acc, m) => acc + m.content.length + 8, 0)
      charsPerToken.set(brain.modelId, promptChars / call.perf.promptTokens)
    }

    this.record({
      stage: 'tutor',
      llmKey: brain.modelKey,
      modelId: brain.modelId,
      device: brain.device,
      temperature,
      promptTokens: call.perf?.promptTokens ?? null,
      completionTokens: call.perf?.completionTokens ?? null,
      ttftMs: call.perf?.ttftMs ?? null,
      prefillTokS: call.perf?.prefillTokS ?? null,
      decodeTokS: call.perf?.decodeTokS ?? null,
      e2eMs: call.perf?.e2eMs ?? null,
      wallMs: timings.llm_ms,
      parse: 'plain',
      correctionsRaw: null,
      correctionsKept: null,
      turnNo: Math.floor(history.length / 2) + 1,
      schema: 'full',
    })

    // Translation is still useful for the UI; it never blocks the reply.
    let translation = ''
    let userTranslation = ''
    if (targetLang !== uiLang) {
      const tTr = this.now()
      try {
        const trCall = await chat(buildTranslateMessages(targetLang, uiLang, userText, reply), {
          temperature: LLM_TRANSLATION_TEMPERATURE,
        })
        const parsedTr = parseTranslationJson(trCall.text)
        const replyTr = parsedTr
          ? stripForeignParens(parsedTr.reply.trim(), uiLang)
          : stripForeignParens(parseSingleTranslation(trCall.text), uiLang)
        if (replyTr && translationOk(replyTr, uiLang) && translationSane(reply, replyTr, uiLang, false)) {
          translation = replyTr
        }
        const userTr = parsedTr ? stripForeignParens(parsedTr.user.trim(), uiLang) : ''
        if (userTr && translationOk(userTr, uiLang) && translationSane(userText, userTr, uiLang, false)) {
          userTranslation = userTr
        }
      } catch {
        /* keep the reply; the gray line is optional */
      }
      timings.translation_ms = Math.round(this.now() - tTr)
      this.record({
        stage: 'translation',
        llmKey: brain.modelKey,
        modelId: brain.modelId,
        device: brain.device,
        temperature: LLM_TRANSLATION_TEMPERATURE,
        promptTokens: null,
        completionTokens: null,
        ttftMs: null,
        prefillTokS: null,
        decodeTokS: null,
        e2eMs: null,
        wallMs: timings.translation_ms,
        parse: translation ? 'fallback' : 'fail',
        correctionsRaw: null,
        correctionsKept: null,
        turnNo: Math.floor(history.length / 2) + 1,
      })
    }

    const tTts = this.now()
    try {
      const prepared = await this.deps.speech.ensure(targetLang, opts.speech)
      warning = warning ?? prepared.warning
    } catch {
      warning = warning ?? libT('warnTtsUnavailable')
    }
    timings.tts_ms = Math.round(this.now() - tTts)

    this.deps.conversation.addUser(targetLang, userText, userTranslation)
    this.deps.conversation.addTutor(targetLang, reply, [], translation, '')
    this.deps.activity.bump()
    timings.total_ms = Math.round(this.now() - tTotal)

    this.record({
      stage: 'turn',
      llmKey: brain.modelKey,
      modelId: brain.modelId,
      device: brain.device,
      temperature,
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

    return {
      userText,
      userTranslation,
      reply,
      corrections: [],
      translation,
      followUp: '',
      followUpTranslation: '',
      suggestions: [],
      canSpeak: true,
      warning,
      timings,
    }
  }

  // ---------- Diary refinement (the "refined page" view) ----------

  async refineDiary(args: {
    lines: string[]
    level: Level
    targetLang: TargetLang
    uiLang: UiLang
    llmKey: string
  }): Promise<DiaryRefineResult> {
    const { level, targetLang, uiLang, llmKey } = args
    const brain = this.deps.brain
    if (brain.kind !== 'cloud' && (!brain.isReady() || brain.modelKey !== llmKey)) {
      throw new ModelsNotReadyError(libT('errModelsNotReady'))
    }
    const lines = args.lines.map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) throw new InvalidParameterError(libT('errNeedInput'))
    const chat = brain.chat

    const refineOnce = async (languageRetry: boolean): Promise<string> => {
      const call = await chat(buildDiaryRefineMessages(level, targetLang, lines, languageRetry), {
        temperature: 0.5,
      })
      let text = stripQuoteWrappers(stripThink(call.text.trim()))
      if (/^\s*\d+[.)]\s/m.test(text)) {
        text = text
          .split('\n')
          .map(l => l.replace(/^\s*\d+[.)]\s*/, '').trim())
          .filter(Boolean)
          .join(' ')
      }
      return text.length > 0 && text.length <= 4000 ? text : ''
    }

    let text = await refineOnce(false)
    if (!text || looksEnglishDrift(text, targetLang)) {
      const retry = await refineOnce(true)
      if (retry && !looksEnglishDrift(retry, targetLang)) text = retry
    }

    let facts: string[] = []
    try {
      const factsCall = await chat(buildDiaryFactsMessages(level, targetLang, lines), {
        temperature: 0.2,
        maxTokens: 300,
      })
      const raw = stripThink(factsCall.text)
      const sourceWords = new Set(lines.flatMap(l => l.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []))
      const isGrounded = (line: string): boolean => {
        const words = line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
        const content = words.filter(w => w.length > 3)
        if (content.length === 0) return true
        const known = content.filter(w => sourceWords.has(w)).length
        return known / content.length >= 0.4
      }
      facts = raw
        .split('\n')
        .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["«»„“]+|["«»„“]+$/g, '').trim())
        .filter(l => l.length > 0 && l.length <= 120 && l.toUpperCase() !== 'NONE')
        .filter(isGrounded)
        .slice(0, 12)
      if (targetLang !== 'en' && facts.length > 0 && facts.every(f => looksEnglishDrift(f, targetLang))) {
        facts = []
      }
    } catch {
      /* facts are an enhancement — the literary page still lands */
    }
    if (!text) throw new PipelineError(libT('errLlmFailed', { reason: libT('modelError') }))

    let translation = ''
    try {
      const trCall = await chat(buildSingleTranslateMessages(targetLang, uiLang, text), {
        temperature: LLM_TRANSLATION_TEMPERATURE,
      })
      const candidate = parseSingleTranslation(trCall.text)
      if (translationOk(candidate, uiLang) && translationSane(text, candidate, uiLang, false)) {
        translation = candidate
      }
    } catch {
      /* the refined page works without a translation */
    }
    return { text, facts, translation }
  }

  /** Speak a tutor line or a single word (called from the UI). */
  async speak(
    text: string,
    opts: {
      lang: TargetLang
      rate: number
      speech: SpeechSelection
      onFirstAudio?: (ms: number) => void
    },
  ): Promise<void> {
    await this.deps.speech.speak(text, {
      lang: opts.lang,
      rate: opts.rate,
      ...opts.speech,
      onFirstAudio: opts.onFirstAudio,
    })
  }

  cancelSpeech(): void {
    this.deps.speech.cancel()
  }
}

/** Auto-trim: drop oldest user+assistant pairs until the prompt fits the
 *  model's context budget. Prebuilt web-llm builds hard-cap at 4096 tokens,
 *  so a growing dialog would otherwise hit the wall mid-conversation. */
export function trimHistoryToFit(
  messages: LlmMessage[],
  promptBudget: number,
  modelId: string,
): { messages: LlmMessage[]; trimmedPairs: number } {
  let trimmedPairs = 0
  let out = messages
  while (estimateTokens(out, modelId) > promptBudget && out.length > 3) {
    // keep [0] = system; drop the next user+assistant pair
    out = [out[0], ...out.slice(3)]
    trimmedPairs++
  }
  return { messages: out, trimmedPairs }
}

export function estimateTokens(messages: LlmMessage[], modelId: string): number {
  const chars = messages.reduce((acc, m) => acc + m.content.length + 8, 0)
  return Math.ceil(chars / (charsPerToken.get(modelId) ?? DEFAULT_CHARS_PER_TOKEN))
}
