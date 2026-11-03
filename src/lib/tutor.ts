// The scaffolded tutor turn (docs/tutor-methodology.md): the deterministic
// half of the conversation. The scenario owns the questions and the chips;
// the tiny model only writes one short reaction sentence — validated, with
// a curated template as the quality floor. The model can upgrade the
// reaction, never break the lesson.

import { chatBrain } from './brain'
import { contentStems, hasCyrillic, stripQuoteWrappers, stripThink } from './parse'
import {
  buildDiaryReactionMessages,
  buildReactionMessages,
  buildTutorAnswerMessages,
  type LlmMessage,
} from '../prompts'
import {
  FAREWELL_RE,
  GREETING_RE,
  INTRO_RE,
  INTRO_REACTION,
  NAME_QUESTION_RE,
  NEGATION_RE,
  TUTOR_FAREWELL,
  TUTOR_FAREWELL_TRANSLATION,
  TUTOR_TRANSITION_TR,
  TARGET_WH_RE,
  type TargetLang,
} from './langs'
import {
  nextScenario,
  selectTutorFacts,
  topTutorFact,
  transitionLine,
  type Scenario,
  type ScenarioTurn,
  type TrPair,
  type TutorSession,
} from './scenarios'
import type { Correction, Level, Suggestion } from '../types'

export type TutorMove = 'advance' | 'stay' | 'scaffold' | 'answer' | 'farewell'
/** How the reply was produced — the bench/quality metric */
export type TutorMethod = 'micro' | 'template' | 'scaffold' | 'farewell'

/** The deterministic tail of a reply with its fixed translations: the engine
 *  translates only the model-written reaction, the question comes from data. */
export interface TutorParts {
  reaction: string
  fixed: string
  fixedTr: TrPair
}

export interface TutorTurnResult {
  move: TutorMove
  method: TutorMethod
  reply: string
  suggestions: Suggestion[]
  /** updated session state to persist */
  session: TutorSession
  /** the prescribed question asked in this reply (null on farewell) */
  question: string | null
  /** deterministic composition of the reply (null → translate the whole line) */
  parts: TutorParts | null
}

// ---------- Deterministic helpers ----------

/** The turn whose question was asked last (null before the first question) */
function currentTurn(scenario: Scenario, session: TutorSession): ScenarioTurn | null {
  const i = session.nextIndex - 1
  return i >= 0 && i < scenario.turns.length ? scenario.turns[i] : null
}

/** Pick the re-ask variant that does NOT repeat the question just asked:
 *  [reask, question, scaffold] → first candidate with a known translation. */
function varyReask(
  turn: ScenarioTurn,
  lastQuestion: string | undefined,
): { text: string; tr: TrPair | null } {
  const candidates: Array<{ text: string; tr: TrPair | null }> = [
    { text: turn.reask ?? turn.question, tr: turn.reaskTr ?? turn.questionTr },
    { text: turn.question, tr: turn.questionTr },
    { text: turn.scaffold, tr: turn.scaffoldTr },
  ]
  const fresh = candidates.find(c => c.text !== lastQuestion)
  return fresh ?? candidates[0]
}

function turnChips(turn: ScenarioTurn | null): Suggestion[] {
  if (!turn) return []
  return turn.chips.map(text => ({ text, translation: '' }))
}

/** Deterministic reaction template by tone of the student's answer */
function templateReaction(lang: TargetLang, turn: ScenarioTurn | null, userText: string): string {
  const negative = NEGATION_RE[lang].test(userText)
  if (!turn) {
    return negative ? 'Alles gut!' : greetingFor(lang)
  }
  return negative ? turn.reactions.negative : turn.reactions.positive
}

function greetingFor(lang: TargetLang): string {
  return {
    de: 'Hallo! Schön, dass du da bist.',
    en: 'Hello! Great to see you.',
    fr: 'Bonjour ! Ravi de te voir.',
    es: '¡Hola! Me alegro de verte.',
    pt: 'Olá! Que bom ver você.',
  }[lang]
}

export function looksEnglishDrift(text: string, targetLang: TargetLang): boolean {
  if (targetLang === 'en') return hasCyrillic(text)
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length === 0) return false
  const markers = words.filter(w =>
    [
      'the', 'and', 'is', 'are', 'was', 'you', 'your', 'i', 'we', 'they', 'he',
      'she', 'it', 'this', 'that', 'what', 'which', 'who', 'when', 'where',
      'why', 'how', 'not', 'with', 'of', 'to', 'from', 'for', 'have', 'has',
      'do', 'does', 'really', 'very', 'just', 'yes', 'okay',
    ].includes(w.replace(/'(s|ve|re|ll|d|m)$/, '')),
  ).length
  return markers / words.length >= 0.25
}

// ---------- Output polishing (deterministic validators) ----------

/** Make the text safe and clean for TTS: no markdown, no emoji, no quotes */
export function stripTtsJunk(text: string): string {
  return text
    .replace(/[*_`#>~]+/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')
    .replace(/["«»„“”]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([,.!?;:])\1+/g, '$1')
    .trim()
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** Exactly-one-question + length enforcement on the composed reply.
 *  If the reaction smuggled in extra questions, only the last one survives. */
export function polishReply(
  reply: string,
  opts: { maxWords: number; allowZeroQuestions?: boolean },
): string {
  let cleaned = stripTtsJunk(reply)
  // drop repeated sentences ("I am from London. I am from London. …") — a
  // template answer repeated inside the prescribed question happens on 1B
  const seenSentences = new Set<string>()
  cleaned = sentences(cleaned)
    .filter(s => {
      const key = s.toLowerCase().replace(/[.!?…]+$/, '').trim()
      if (!key || seenSentences.has(key)) return false
      seenSentences.add(key)
      return true
    })
    .join(' ')
  const parts = sentences(cleaned)
  const questions = parts.filter(s => s.includes('?'))
  if (questions.length > 1) {
    const lastQ = questions[questions.length - 1]
    const kept = parts.filter(s => !s.includes('?'))
    cleaned = [...kept, lastQ].join(' ')
  }
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length > opts.maxWords) {
    // drop middle declaratives, keep the first reaction and the final question
    const head = sentences(cleaned)
    const last = head[head.length - 1]
    const rest = head.slice(0, -1)
    const keep = Math.max(1, Math.ceil((opts.maxWords - last.split(/\s+/).length) / 6))
    cleaned = [...rest.slice(0, keep), last].join(' ')
  }
  return cleaned
}

// ---------- Micro-generation (the tiny model's job) ----------

function cleanMicroOutput(raw: string): string {
  const bare = stripQuoteWrappers(stripThink(raw.trim()))
  // the model may add a label or a second line — keep the first real line
  const line = bare
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)[0] ?? ''
  return stripTtsJunk(line.replace(/^(Reaction|Antwort|Answer|Réponse|Respuesta|Resposta)\s*:\s*/i, ''))
}

/** Word-option menus ("er/sie") are model uncertainty, never speech */
const SLASH_MENU_RE = /\p{L}\/\p{L}/u
/** The exclamation skeleton the 1B model falls into without few-shot:
 *  "Das ist schön, wie du kommst!" — killed outright; the floor praises. */
const MICRO_JUNK_RE: Partial<Record<TargetLang, RegExp>> = {
  de: /\bwie du\b/i,
  fr: /\bcomme tu\b/i,
  es: /\bcomo t[uú]\b/i,
  pt: /\bcomo voc[êe]\b/i,
}

function microValid(
  line: string,
  targetLang: TargetLang,
  maxWords: number,
  ctx: { relateTo: string[]; minWords: number } = { relateTo: [], minWords: 0 },
): boolean {
  const words = line.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > maxWords) return false
  if (line.includes('?')) return false
  if (looksEnglishDrift(line, targetLang)) return false
  if (SLASH_MENU_RE.test(line)) return false
  if (MICRO_JUNK_RE[targetLang]?.test(line)) return false
  // A sentence LONGER than minWords must relate to the student's answer, the
  // asked question or the scenario vocabulary — kills non-sequiturs
  // ("Das ist ein schöner Ort!" to an answer about time).
  if (ctx.relateTo.length > 0 && words.length > ctx.minWords) {
    const want = new Set<string>()
    for (const src of ctx.relateTo) for (const s of contentStems(src)) want.add(s)
    for (const s of contentStems(line)) if (want.has(s)) return true
    return false
  }
  return true
}

async function chatOnce(
  messages: LlmMessage[],
  temperature: number,
  maxTokens: number,
): Promise<string> {
  // one line out → stop at the first newline: without it the 1B model keeps
  // writing the next few-shot example all the way to max_tokens
  const call = await chatBrain(messages, { temperature, maxTokens, stop: ['\n'] })
  return call.text
}

/** ONE reaction sentence; two attempts, then the curated template floor.
 *  The floor comes from the turn being ASKED (its `reactions` field is the
 *  reaction to the student's previous answer). */
async function microReaction(
  targetLang: TargetLang,
  level: Level,
  scenario: Scenario,
  userText: string,
  previousQuestion: string | null,
  correction: Correction | null,
  extraPrompt: string,
  /** the turn whose question is about to be asked (floor source) */
  askedTurn: ScenarioTurn | null,
): Promise<{ line: string; method: TutorMethod }> {
  const floor = templateReaction(targetLang, askedTurn, userText)
  for (const strict of [false, true]) {
    try {
      const raw = await chatOnce(
        buildReactionMessages(targetLang, level, scenario, userText, previousQuestion, correction, extraPrompt, strict),
        0.4,
        80,
      )
      const line = cleanMicroOutput(raw)
      if (
        microValid(line, targetLang, 18, {
          relateTo: [userText, previousQuestion ?? '', scenario.vocab.join(' '), askedTurn?.question ?? ''].filter(
            Boolean,
          ),
          minWords: 4,
        })
      ) {
        return { line, method: 'micro' }
      }
    } catch {
      /* model call failed — try the strict retry, then the floor */
    }
  }
  return { line: floor, method: 'template' }
}

/** 1-2 short sentences answering the student's question; floor = the most
 *  topically relevant persona fact (selectTutorFacts already ranked them). */
async function microAnswer(
  targetLang: TargetLang,
  level: Level,
  userText: string,
  tutorFacts: string[],
  extraPrompt: string,
): Promise<{ line: string; method: TutorMethod }> {
  const floor = tutorFacts[0] ?? greetingFor(targetLang)
  for (const strict of [false, true]) {
    try {
      const raw = await chatOnce(
        buildTutorAnswerMessages(targetLang, level, userText, tutorFacts, extraPrompt, strict),
        0.4,
        96,
      )
      const line = cleanMicroOutput(raw)
      // no lenient bypass: a strict retry that still fails validation → floor
      if (microValid(line, targetLang, 24, { relateTo: [userText, ...tutorFacts], minWords: 5 })) {
        return { line, method: 'micro' }
      }
    } catch {
      /* fall through to the floor */
    }
  }
  return { line: floor, method: 'template' }
}

// ---------- The turn ----------

export interface TinyTutorArgs {
  userText: string
  level: Level
  targetLang: TargetLang
  extraPrompt: string
  scenario: Scenario
  session: TutorSession
  corrections: Correction[]
}

function maxWordsFor(level: Level): number {
  return level === 'A1' ? 22 : 32
}

/** The whole scaffolded turn for the tiny tier (and the question/grounding
 *  source for the full tier). Pure moves (scaffold/farewell) make no LLM call. */
export async function runTinyTutorTurn(args: TinyTutorArgs): Promise<TutorTurnResult> {
  const { userText, level, targetLang, extraPrompt, scenario, session, corrections } = args

  // 1. The student says goodbye — close politely, no new question
  if (FAREWELL_RE[targetLang].test(userText)) {
    return {
      move: 'farewell',
      method: 'farewell',
      reply: TUTOR_FAREWELL[targetLang],
      suggestions: [],
      session,
      question: null,
      parts: {
        reaction: '',
        fixed: TUTOR_FAREWELL[targetLang],
        fixedTr: TUTOR_FAREWELL_TRANSLATION[targetLang],
      },
    }
  }

  const userAsked = TARGET_WH_RE[targetLang].test(userText) || userText.includes('?')
  const turn = currentTurn(scenario, session)
  const wordCount = userText.trim().split(/\s+/).filter(Boolean).length

  // 1.4 The student introduced themselves — acknowledge the name and move on.
  //  "My name is Valentin, what is your name?" must never bounce back to
  //  "What is your name?": the name question counts as answered.
  const introMatch = INTRO_RE[targetLang].exec(userText)
  const nameQuestionActive =
    session.nextIndex === 0 || (turn !== null && NAME_QUESTION_RE.test(turn.question))
  if (introMatch && nameQuestionActive) {
    const studentName = introMatch[1]
    const reaction = INTRO_REACTION[targetLang].replace('{name}', studentName)
    const i = Math.max(session.nextIndex, 1)
    const nextTurn = i < scenario.turns.length ? scenario.turns[i] : null
    if (nextTurn) {
      return {
        move: 'advance',
        method: 'template',
        reply: polishReply(`${reaction} ${nextTurn.question}`, { maxWords: maxWordsFor(level) + 6 }),
        suggestions: turnChips(nextTurn),
        session: { ...session, nextIndex: i + 1, stayCount: 0, lastQuestion: nextTurn.question },
        question: nextTurn.question,
        parts: {
          reaction,
          fixed: nextTurn.question,
          fixedTr: nextTurn.questionTr,
        },
      }
    }
    // the intro scenario is exhausted — rotate with a transition
    const next = nextScenario(scenario)
    const question = next.turns[0].question
    return {
      move: 'advance',
      method: 'template',
      reply: polishReply(`${reaction} ${question}`, { maxWords: maxWordsFor(level) + 6 }),
      suggestions: turnChips(next.turns[0]),
      session: {
        scenarioId: next.id,
        nextIndex: 1,
        topicKey: session.topicKey,
        stayCount: 0,
        lastQuestion: question,
      },
      question,
      parts: {
        reaction,
        fixed: question,
        fixedTr: next.turns[0].questionTr,
      },
    }
  }

  // 1.5 Opening: a bare greeting before the first question — greet back
  //  warmly and ask the scenario's first question. Deterministic: a 1B model
  //  asked to "react to a greeting" produces non-sequiturs ("das Wochenende
  //  ist schön!"), the greeting itself is a fixed line.
  if (session.nextIndex === 0 && (GREETING_RE[targetLang].test(userText) || wordCount < 2)) {
    const first = scenario.turns[0]
    const greeting = greetingFor(targetLang)
    return {
      move: 'advance',
      method: 'template',
      reply: polishReply(`${greeting} ${first.question}`, { maxWords: maxWordsFor(level) + 6 }),
      suggestions: turnChips(first),
      session: { ...session, nextIndex: 1, lastQuestion: first.question },
      question: first.question,
      parts: { reaction: greeting, fixed: first.question, fixedTr: first.questionTr },
    }
  }

  // 2. The student asked the tutor something — answer briefly, return the ball
  if (userAsked) {
    // A persona fact that clearly answers the question is used AS-IS: the 1B
    // model ignores the fact list half the time and invents a persona
    // ("Ich heiße Max", "Ich trinke Wasser"); the bank is closed, generation
    // is not needed. The LLM only rewrites when no fact matches.
    const top = topTutorFact(targetLang, turn, userText)
    const answer =
      top && top.score >= 1
        ? { line: top.fact, method: 'template' as TutorMethod }
        : await microAnswer(targetLang, level, userText, selectTutorFacts(targetLang, turn, userText), extraPrompt)
    if (session.nextIndex === 0) {
      // nothing asked yet — answer and ask the scenario's first question
      const first = scenario.turns[0]
      const question = first.question
      return {
        move: 'answer',
        method: answer.method,
        reply: polishReply(`${answer.line} ${question}`, { maxWords: maxWordsFor(level) + 6 }),
        suggestions: turnChips(first),
        session: { ...session, nextIndex: 1, lastQuestion: question },
        question,
        parts: { reaction: answer.line, fixed: question, fixedTr: first.questionTr },
      }
    }
    const varied = varyReask(turn ?? scenario.turns[0], session.lastQuestion)
    return {
      move: 'answer',
      method: answer.method,
      reply: polishReply(`${answer.line} ${varied.text}`, { maxWords: maxWordsFor(level) + 6 }),
      suggestions: turnChips(turn),
      session: { ...session, lastQuestion: varied.text },
      question: varied.text,
      parts: varied.tr
        ? { reaction: answer.line, fixed: varied.text, fixedTr: varied.tr }
        : null,
    }
  }

  // 3. Telegraphic/empty answer — do not advance, descend the ladder
  if (wordCount < 2 && turn) {
    return {
      move: 'scaffold',
      method: 'scaffold',
      reply: polishReply(`${turn.reactions.short} ${turn.scaffold}`, { maxWords: maxWordsFor(level) + 8 }),
      suggestions: turnChips(turn),
      session: { ...session, lastQuestion: turn.scaffold },
      question: turn.scaffold,
      // the short reaction template has no fixed translation — whole line via LLM
      parts: null,
    }
  }

  // 4. A substantive answer — but is it about the question we asked? A
  //  substantive-yet-unrelated reply means the student skipped the question:
  //  react, gently re-ask and DO NOT advance (cap: force advance after 2
  //  consecutive stays so the lesson never stalls).
  const asked = currentTurn(scenario, session)?.question ?? null
  const userStems = [...contentStems(userText)]
  if (turn && userStems.length >= 2 && (session.stayCount ?? 0) < 2) {
    const relateTo = [turn.question, turn.scaffold, ...turn.chips, scenario.vocab.join(' ')]
    const want = new Set<string>()
    for (const src of relateTo) for (const s of contentStems(src)) want.add(s)
    const relevant = userStems.some(s => want.has(s))
    if (!relevant) {
      const reaction = await microReaction(
        targetLang,
        level,
        scenario,
        userText,
        asked,
        corrections[0] ?? null,
        extraPrompt,
        turn,
      )
      const varied = varyReask(turn, session.lastQuestion)
      return {
        move: 'stay',
        method: reaction.method,
        reply: polishReply(`${reaction.line} ${varied.text}`, { maxWords: maxWordsFor(level) + 6 }),
        suggestions: turnChips(turn),
        session: { ...session, stayCount: (session.stayCount ?? 0) + 1, lastQuestion: varied.text },
        question: varied.text,
        parts: varied.tr ? { reaction: reaction.line, fixed: varied.text, fixedTr: varied.tr } : null,
      }
    }
  }

  // 5. On-topic answer — react and advance the scenario
  const reaction = await microReaction(
    targetLang,
    level,
    scenario,
    userText,
    asked,
    corrections[0] ?? null,
    extraPrompt,
    // the floor comes from the turn being asked
    session.nextIndex < scenario.turns.length ? scenario.turns[session.nextIndex] : null,
  )
  let nextSession: TutorSession = { ...session, stayCount: 0 }
  let prefix = ''
  let prefixTr: { ru: string; en: string } | null = null
  let question: string
  let questionTr: TrPair
  let chips: Suggestion[]
  const i = session.nextIndex
  if (i < scenario.turns.length) {
    question = scenario.turns[i].question
    questionTr = scenario.turns[i].questionTr
    chips = turnChips(scenario.turns[i])
    nextSession = { ...session, nextIndex: i + 1, stayCount: 0, lastQuestion: question }
  } else {
    // scenario exhausted — rotate to the next one with a transition line
    const next = nextScenario(scenario)
    prefix = `${transitionLine(targetLang, next)} `
    question = next.turns[0].question
    questionTr = next.turns[0].questionTr
    chips = turnChips(next.turns[0])
    prefixTr = {
      ru: TUTOR_TRANSITION_TR.ru.replace('{topic}', next.titleTr.ru),
      en: TUTOR_TRANSITION_TR.en.replace('{topic}', next.titleTr.en),
    }
    nextSession = {
      scenarioId: next.id,
      nextIndex: 1,
      topicKey: session.topicKey,
      stayCount: 0,
      lastQuestion: question,
    }
  }
  const reply = polishReply(`${reaction.line} ${prefix}${question}`, { maxWords: maxWordsFor(level) + 10 })
  return {
    move: 'advance',
    method: reaction.method,
    reply,
    suggestions: chips,
    session: nextSession,
    question,
    parts: {
      reaction: reaction.line,
      fixed: `${prefix}${question}`,
      fixedTr: prefixTr
        ? { ru: `${prefixTr.ru} ${questionTr.ru}`, en: `${prefixTr.en} ${questionTr.en}` }
        : questionTr,
    },
  }
}

// ---------- Diary mode: the supportive listener ----------

/** Listening questions rotate in order — the diary tutor asks nothing else */
const DIARY_QUESTIONS: Record<TargetLang, Array<{ text: string; tr: TrPair }>> = {
  de: [
    { text: 'Und was war dann?', tr: { ru: 'И что было дальше?', en: 'And what happened next?' } },
    { text: 'Verstehe. Und was kam danach?', tr: { ru: 'Понятно. А что было после?', en: 'I see. And what came after that?' } },
    { text: 'Wie hast du dich gefühlt?', tr: { ru: 'Что ты почувствовал(а)?', en: 'How did you feel?' } },
    { text: 'Das klingt spannend! Was hast du dann gemacht?', tr: { ru: 'Звучит интересно! Что ты сделал(а) потом?', en: 'That sounds exciting! What did you do then?' } },
    { text: 'Wirklich? Erzähl mehr!', tr: { ru: 'Правда? Расскажи ещё!', en: 'Really? Tell me more!' } },
    { text: 'Und wie ist es weitergegangen?', tr: { ru: 'И как всё продолжилось?', en: 'And how did it go on?' } },
    { text: 'Was war das Beste an deinem Tag?', tr: { ru: 'Что было лучшим в этот день?', en: 'What was the best part of your day?' } },
  ],
  en: [
    { text: 'And what happened next?', tr: { ru: 'И что было дальше?', en: 'And what happened next?' } },
    { text: 'I see. And after that?', tr: { ru: 'Понятно. А потом?', en: 'I see. And after that?' } },
    { text: 'How did you feel?', tr: { ru: 'Что ты почувствовал(а)?', en: 'How did you feel?' } },
    { text: 'That sounds interesting! What did you do then?', tr: { ru: 'Звучит интересно! Что ты сделал(а) потом?', en: 'That sounds interesting! What did you do then?' } },
    { text: 'Really? Tell me more!', tr: { ru: 'Правда? Расскажи ещё!', en: 'Really? Tell me more!' } },
    { text: 'What was the best part of your day?', tr: { ru: 'Что было лучшим в этот день?', en: 'What was the best part of your day?' } },
  ],
  fr: [
    { text: 'Et après, qu’est-ce qui s’est passé ?', tr: { ru: 'А что было потом?', en: 'And what happened next?' } },
    { text: 'Je vois. Et ensuite ?', tr: { ru: 'Понятно. А дальше?', en: 'I see. And then?' } },
    { text: 'Comment tu t’es senti(e) ?', tr: { ru: 'Что ты почувствовал(а)?', en: 'How did you feel?' } },
    { text: 'Ça a l’air intéressant ! Et après ?', tr: { ru: 'Звучит интересно! А потом?', en: 'That sounds interesting! And then?' } },
    { text: 'Vraiment ? Raconte encore !', tr: { ru: 'Правда? Расскажи ещё!', en: 'Really? Tell me more!' } },
  ],
  es: [
    { text: '¿Y qué pasó después?', tr: { ru: 'А что было дальше?', en: 'And what happened next?' } },
    { text: 'Ya veo. ¿Y luego?', tr: { ru: 'Понятно. А потом?', en: 'I see. And then?' } },
    { text: '¿Cómo te sentiste?', tr: { ru: 'Что ты почувствовал(а)?', en: 'How did you feel?' } },
    { text: '¡Suena interesante! ¿Y qué hiciste entonces?', tr: { ru: 'Звучит интересно! И что ты сделал(а) тогда?', en: 'That sounds interesting! And what did you do then?' } },
    { text: '¿De verdad? ¡Cuenta más!', tr: { ru: 'Правда? Расскажи ещё!', en: 'Really? Tell me more!' } },
  ],
  pt: [
    { text: 'E o que aconteceu depois?', tr: { ru: 'А что было дальше?', en: 'And what happened next?' } },
    { text: 'Entendi. E depois?', tr: { ru: 'Понятно. А потом?', en: 'I see. And then?' } },
    { text: 'Como você se sentiu?', tr: { ru: 'Что ты почувствовал(а)?', en: 'How did you feel?' } },
    { text: 'Parece interessante! E o que você fez então?', tr: { ru: 'Звучит интересно! И что ты сделал(а) тогда?', en: 'That sounds interesting! And what did you do then?' } },
    { text: 'Sério? Conta mais!', tr: { ru: 'Правда? Расскажи ещё!', en: 'Really? Tell me more!' } },
  ],
}

const DIARY_OPENERS: Record<TargetLang, { text: string; tr: TrPair }> = {
  de: { text: 'Erzähl mir: Wie war dein Tag?', tr: { ru: 'Расскажи мне: как прошёл твой день?', en: 'Tell me: how was your day?' } },
  en: { text: 'Tell me: how was your day?', tr: { ru: 'Расскажи мне: как прошёл твой день?', en: 'Tell me: how was your day?' } },
  fr: { text: 'Raconte-moi : comment s’est passée ta journée ?', tr: { ru: 'Расскажи мне: как прошёл твой день?', en: 'Tell me: how was your day?' } },
  es: { text: 'Cuéntame: ¿cómo estuvo tu día?', tr: { ru: 'Расскажи мне: как прошёл твой день?', en: 'Tell me: how was your day?' } },
  pt: { text: 'Me conta: como foi o seu dia?', tr: { ru: 'Расскажи мне: как прошёл твой день?', en: 'Tell me: how was your day?' } },
}

/** Deterministic supportive floor reactions */
const DIARY_FLOOR: Record<TargetLang, string[]> = {
  de: ['Verstehe.', 'Alles klar!', 'Oh, interessant!', 'Danke fürs Erzählen!'],
  en: ['I see.', 'All right!', 'Oh, interesting!', 'Thanks for telling me!'],
  fr: ['Je vois.', 'D’accord !', 'Oh, intéressant !', 'Merci de me le raconter !'],
  es: ['Ya veo.', '¡Entendido!', '¡Qué interesante!', '¡Gracias por contarme!'],
  pt: ['Entendi.', 'Tudo bem!', 'Ah, interessante!', 'Obrigado por me contar!'],
}

/** Continuation chips: how the student goes on telling about their day */
const DIARY_CHIPS: Record<TargetLang, Array<{ text: string }>> = {
  de: [{ text: 'Und dann habe ich …' }, { text: 'Später …' }, { text: 'Das war mein Tag.' }],
  en: [{ text: 'And then I …' }, { text: 'Later …' }, { text: 'That was my day.' }],
  fr: [{ text: 'Et puis j’ai …' }, { text: 'Plus tard …' }, { text: 'Voilà ma journée.' }],
  es: [{ text: 'Y luego …' }, { text: 'Más tarde …' }, { text: 'Ese fue mi día.' }],
  pt: [{ text: 'E depois eu …' }, { text: 'Mais tarde …' }, { text: 'Esse foi o meu dia.' }],
}

export interface DiaryTurnArgs {
  userText: string
  level: Level
  targetLang: TargetLang
  extraPrompt: string
  /** listening-question rotation index (store.diary.state) */
  qIdx: number
  /** the very first diary turn opens with the "how was your day" question */
  opening: boolean
}

/** The diary-mode turn: a supportive listener that never corrects aloud,
 *  never changes the topic, and rotates listening questions from the bank. */
export async function runDiaryTurn(args: DiaryTurnArgs): Promise<TutorTurnResult> {
  const { userText, level, targetLang, extraPrompt, qIdx, opening } = args

  if (FAREWELL_RE[targetLang].test(userText)) {
    return {
      move: 'farewell',
      method: 'farewell',
      reply: TUTOR_FAREWELL[targetLang],
      suggestions: [],
      session: { scenarioId: 'diary', nextIndex: 0, topicKey: '' },
      question: null,
      parts: {
        reaction: '',
        fixed: TUTOR_FAREWELL[targetLang],
        fixedTr: TUTOR_FAREWELL_TRANSLATION[targetLang],
      },
    }
  }

  const bank = DIARY_QUESTIONS[targetLang]
  let question: { text: string; tr: TrPair }
  let nextQIdx: number
  if (opening) {
    question = DIARY_OPENERS[targetLang]
    nextQIdx = qIdx
  } else {
    question = bank[qIdx % bank.length]
    nextQIdx = (qIdx + 1) % bank.length
  }

  // The supportive reaction: model preferred, curated floor otherwise
  let reaction = { line: DIARY_FLOOR[targetLang][qIdx % DIARY_FLOOR[targetLang].length], method: 'template' as TutorMethod }
  if (!opening) {
    for (const strict of [false, true]) {
      try {
        const raw = await chatOnce(
          buildDiaryReactionMessages(targetLang, level, userText, extraPrompt, strict),
          0.4,
          64,
        )
        const line = cleanMicroOutput(raw)
        if (microValid(line, targetLang, 14, { relateTo: [userText], minWords: 4 })) {
          reaction = { line, method: 'micro' }
          break
        }
      } catch {
        /* the floor is fine */
      }
    }
  }

  const reply = polishReply(`${opening ? '' : `${reaction.line} `}${question.text}`, {
    maxWords: maxWordsFor(level) + 8,
  })
  return {
    move: 'answer',
    method: reaction.method,
    reply,
    suggestions: DIARY_CHIPS[targetLang].map(c => ({ text: c.text, translation: '' })),
    session: { scenarioId: 'diary', nextIndex: nextQIdx, topicKey: '' },
    question: question.text,
    parts: {
      reaction: opening ? '' : reaction.line,
      fixed: question.text,
      fixedTr: question.tr,
    },
  }
}

/** Question + grounding for the full tier (Gemma-4 E2B etc.): the same
 *  scenario progression, but the model writes the whole reply. */
export function prescribedQuestion(scenario: Scenario, session: TutorSession): string | null {
  const i = session.nextIndex
  if (i < scenario.turns.length) return scenario.turns[i].question
  return nextScenario(scenario).turns[0].question
}

/** Chips answering the prescribed question (canonical student answers) */
export function prescribedChips(scenario: Scenario, session: TutorSession): Suggestion[] {
  const i = session.nextIndex
  const turn = i < scenario.turns.length ? scenario.turns[i] : nextScenario(scenario).turns[0]
  return turn.chips.map(text => ({ text, translation: '' }))
}

/** The curated reaction template floor (full-tier English-drift rescue) */
export function templateFloor(
  lang: TargetLang,
  scenario: Scenario,
  session: TutorSession,
  userText: string,
): string {
  return templateReaction(lang, currentTurn(scenario, session), userText)
}

/** Force the prescribed question to be the reply's single question: replace
 *  the trailing question sentence, or append one when the model dropped it. */
export function ensurePrescribedQuestion(reply: string, question: string | null): string {
  if (!question) return reply
  const parts = sentences(reply)
  if (parts.length === 0) return question
  const lastQ = [...parts].reverse().find(s => s.includes('?'))
  if (!lastQ) return `${parts.join(' ')} ${question}`
  const idx = parts.lastIndexOf(lastQ)
  parts[idx] = question
  return parts.join(' ')
}

/** Session update after a full-tier turn asked the prescribed question */
export function advanceFullSession(scenario: Scenario, session: TutorSession): TutorSession {
  const i = session.nextIndex
  if (i < scenario.turns.length) return { ...session, nextIndex: i + 1 }
  const next = nextScenario(scenario)
  return { scenarioId: next.id, nextIndex: 1, topicKey: session.topicKey }
}
