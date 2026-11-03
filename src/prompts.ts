// Tutor/translator/dictionary prompts. Parameterized by the target language
// and the UI language: translations and error explanations use the UI language,
// while the conversation itself runs in the target language. Ported from backend/prompts + llm.py.

import { libT } from './i18n'
import {
  langInfo,
  langNameForPrompt,
  uiLangNameForPrompt,
  type TargetLang,
} from './lib/langs'
import type { Scenario } from './lib/scenarios'
import type { Correction, Level } from './types'

export type ChatRole = 'system' | 'user' | 'assistant'
export interface LlmMessage {
  role: ChatRole
  content: string
}

export function tutorSystemPrompt(level: string, targetLang: TargetLang, uiLang: 'ru' | 'en'): string {
  const target = langNameForPrompt(targetLang)
  const explain = uiLangNameForPrompt(uiLang)
  const info = langInfo(targetLang)
  return `You are BlaBlaBot, a patient, friendly ${target} tutor for a student at ${level} level.
Respond ONLY in natural conversational ${target}${target === 'English' ? '' : ' — never in English'}; ${info.informalAddress}.
ALWAYS return strict JSON (no markdown, no code fences, no extra text):
{
  "reply": "2-4 sentences max, natural ${target}",
  "corrections": [{"original": "...", "corrected": "...", "explanation": "..."}],
  "suggestions": [{"text": "short ${target} phrase the user could say next", "translation": "its ${explain} translation"}]
}
Rules:
- reply is the ONLY answer: 2-4 sentences, spoken aloud by TTS; END it with ONE natural follow-up question so the conversation keeps going
- exactly ONE question per reply — the one inside reply; never produce questions outside it
- reply must follow the student's additional instructions strictly (topic, grammar focus, style)
- Keep reply SHORT (max 50 words)
- Match the user's complexity level
- Never break character, never mention being an AI
- corrections fix mistakes in the USER'S LAST message only; "original" must be copied EXACTLY from that message; "original" and "corrected" must be different strings; NEVER correct your own reply
- fix GRAMMAR, SPELLING, ARTICLES, CASES and WORD ORDER only; never REWRITE, complete or restructure the user's sentence; never suggest different words based on meaning or style
- if the user's phrase is telegraphic or stylistically unusual but has no real grammar error, corrections MUST be []
- if the user's last message has no mistakes, corrections MUST be [] — never output a correction that says there are no mistakes
- "explanation" MUST be in ${explain} (the student speaks ${explain}), maximum one short sentence
- Write correct ${target} yourself: right articles, cases, word order
- reply will be spoken by TTS, make it sound natural when spoken
- suggestions: exactly 3 SHORT natural ${target} phrases (2-6 words each) answering the follow-up question at the user's level, each with a short ${explain} translation`
}

export function translateSystemPrompt(targetLang: TargetLang, uiLang: 'ru' | 'en'): string {
  const target = langNameForPrompt(targetLang)
  const explain = uiLangNameForPrompt(uiLang)
  return `You are a ${target}-to-${explain} translator for a language student.
The user message contains two labeled ${target} texts: USER (what the student said) and TUTOR (the tutor's reply).
Translate each into natural, simple ${explain}. You are a translator, not a conversation partner: never answer the questions and never react to their content. Never swap the fields: USER translates into "user", TUTOR into "reply". Translate ALL of each text — do not drop sentences.
Return strict JSON only:
{"user": "${explain} translation of the USER text", "reply": "${explain} translation of the TUTOR text"}
No comments, no extra text.`
}

export function vocabSystemPrompt(targetLang: TargetLang, uiLang: 'ru' | 'en'): string {
  const target = langNameForPrompt(targetLang)
  const explain = uiLangNameForPrompt(uiLang)
  const info = langInfo(targetLang)
  const articleRule = info.usesArticles ? `, ${info.articleHint}` : ''
  // Important: no double quotes — the example lives inside a JSON sample in the prompt
  const posExample =
    uiLang === 'ru' ? '«сущ.», «глагол», «прилагательное»' : 'noun, verb, adjective'
  return `You are a strict ${target}-to-${explain} dictionary for a language student.
For the ${target} word or short phrase from the user return strict JSON (no markdown).

If it is a REAL ${target} word or common phrase:
{
  "exists": true,
  "word": "the corrected dictionary form${articleRule}",
  "translation": "short ${explain} translation, 1-3 words",
  "part_of_speech": "part of speech in ${explain}, e.g. ${posExample}",
  "example": "one short natural ${target} example sentence using the word",
  "example_translation": "${explain} translation of the example"
}

If it is NOT a real ${target} word (made-up, typo, misspelled, or not ${target} at all) NEVER invent a translation:
{
  "exists": false,
  "word": "the text as given",
  "comment": "short ${explain} explanation of what might be wrong or what the user meant"
}`
}

/** Single-text translation contract (tiny tier): one text in, bare line out.
 *  No JSON schema — the two-key translate call is exactly where 1B models
 *  break, while single-sentence translation they do reliably. */
export function buildSingleTranslateMessages(
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  text: string,
  /** retry after a rejected translation: force the model out of the
   *  "answer instead of translate" failure mode */
  strict = false,
): LlmMessage[] {
  const target = langNameForPrompt(targetLang)
  const explain = uiLangNameForPrompt(uiLang)
  const strictSuffix = strict
    ? `\nSTRICT RETRY: output ONLY the ${explain} translation of the text — nothing else. Never answer the text, never react to it. Translate ALL of it: every question stays a question, every number stays a number, no sentence is dropped.`
    : ''
  return [
    {
      role: 'system',
      content: `You are a ${target}-to-${explain} translator. Translate the ${target} text into natural, simple ${explain}. You are a translator, not a conversation partner: never answer the text, never react to it.
Rules:
- translate EVERY sentence of the text — never drop or shorten it
- never ADD anything that is not in the text: no names, no choices, no remarks in brackets
Output ONLY the translation — no comments, no quotes, no JSON.${strictSuffix}`,
    },
    { role: 'user', content: text },
  ]
}

/** Tiny-tier tutor contract: two keys instead of three nested structures.
 *  Measured on 1B-class models: compliance jumps from ~13% to ~75-88% when
 *  the output schema shrinks; corrections move to their own single-key call. */
export function tutorSystemPromptSimple(level: string, targetLang: TargetLang, uiLang: 'ru' | 'en'): string {
  const target = langNameForPrompt(targetLang)
  const explain = uiLangNameForPrompt(uiLang)
  const info = langInfo(targetLang)
  return `You are BlaBlaBot, a patient, friendly ${target} tutor for a student at ${level} level.
Respond ONLY in natural conversational ${target}${target === 'English' ? '' : ' — never in English'}; ${info.informalAddress}.
Return ONLY this JSON, nothing else:
{
  "reply": "2-3 short sentences in ${target}, ending with ONE question",
  "suggestions": [{"text": "short ${target} phrase", "translation": "${explain} translation"}]
}
Rules:
- reply: max 30 words, natural spoken ${target}, ends with exactly ONE follow-up question
- suggestions: exactly 3 short phrases (2-6 words) the student could answer with
- never mention being an AI, no extra text outside the JSON`
}

/** Tiny-tier corrections contract: one key, user's last message only, no history */
export function correctionsSystemPrompt(targetLang: TargetLang, uiLang: 'ru' | 'en'): string {
  const target = langNameForPrompt(targetLang)
  const explain = uiLangNameForPrompt(uiLang)
  const noMistakeExpl =
    uiLang === 'ru'
      ? 'у существительного Zeit женский род, нужна форма keine'
      : 'Zeit is feminine, the form is keine'
  return `You are a strict ${target} grammar checker for one beginner sentence.
Find GRAMMAR, SPELLING, ARTICLE, CASE and WORD ORDER mistakes in the user's sentence.
Mostly the sentence is already correct — then the answer is an empty list.
Never rewrite, complete or restructure the sentence; never suggest different words; never change the tense; never invert a correct sentence.
Return ONLY this JSON:
{"corrections": [{"original": "exact fragment from the sentence", "corrected": "fixed fragment", "explanation": "one short sentence in ${explain}"}]}
Rules for every correction:
- "original": a SHORT fragment (2-6 words) copied exactly from the sentence
- "corrected": the SAME fragment with only the wrong form fixed (article, ending, spelling, or the verb moved to position 2)
Example 1 — user sentence "Ich heiße Anna." (correct, nothing to fix):
{"corrections": []}
Example 2 — user sentence "Ich habe kein Zeit." (kein needs the ending -e):
{"corrections": [{"original": "kein Zeit", "corrected": "keine Zeit", "explanation": "${noMistakeExpl}"}]}`
}

/** Dedicated suggestions call (fallback when the tutor reply carried no
 *  usable suggestions): a single-key contract tiny models can keep. */
export function buildSuggestionsMessages(level: Level, targetLang: TargetLang, tutorReply: string): LlmMessage[] {
  const target = langNameForPrompt(targetLang)
  return [
    {
      role: 'system',
      content: `You write reply hints for a ${target} language student at ${level} level.
The TUTOR message below is the tutor's last reply, which usually ends with a question.
Suggest exactly 3 SHORT natural ${target} mini-sentences (2-6 words each, at the student's level) the student could answer with. Each phrase must be a COMPLETE mini-sentence — single words and fragments are forbidden.
Never answer the tutor yourself. Return ONLY a JSON array of strings: ["phrase 1", "phrase 2", "phrase 3"]`,
    },
    { role: 'user', content: `TUTOR: ${tutorReply}` },
  ]
}

/** Scenario grounding for the full-tier tutor prompt: the topic, its
 *  vocabulary and the exact question the reply must end with (the same
 *  question the tiny-tier scaffold would ask — keeps the lesson on script). */
export function scenarioGrounding(
  scenario: Scenario,
  question: string | null,
): string {
  let block = `\nSCENARIO: you are guiding the student through the topic "${scenario.title}".`
  if (scenario.vocab.length > 0) {
    block += `\nPreferred vocabulary: ${scenario.vocab.slice(0, 12).join(', ')}.`
  }
  if (question) {
    block += `\nIMPORTANT: end your reply with EXACTLY this question: "${question}"`
  }
  return block
}

/** Port of build_tutor_messages from backend/models/llm.py */
export function buildTutorMessages(
  history: LlmMessage[],
  userText: string,
  level: Level,
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  extraInstructions = '',
  /** retry after the reply drifted into English: hard language rule */
  languageRetry = false,
  /** scenario grounding (docs/tutor-methodology.md) */
  scenario?: { block: string },
): LlmMessage[] {
  let system = tutorSystemPrompt(level, targetLang, uiLang)
  const extra = extraInstructions.trim()
  if (extra) {
    system += `\n\nAdditional instructions from the student (follow them strictly):\n${extra.slice(0, 1000)}`
  }
  if (scenario) system += scenario.block
  if (languageRetry && langNameForPrompt(targetLang) !== 'English') {
    system += `\n\nCRITICAL LANGUAGE RULE: your reply must be in ${langNameForPrompt(targetLang)} ONLY — every single word. English replies are forbidden.`
  }
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: userText }]
}

export function buildTranslateMessages(
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  userText: string,
  reply: string,
  /** retry after a rejected translation: force the model out of the
   *  "answer instead of translate" / "swap the fields" failure modes */
  strict = false,
): LlmMessage[] {
  const strictSuffix = strict
    ? `\nSTRICT RETRY: your task is ONLY to translate the two texts — never answer them, never react to them. USER translates into "user", TUTOR into "reply" — never swap the fields. Translate ALL of each text: every question stays a question, every number stays a number, no sentence is dropped.`
    : ''
  return [
    { role: 'system', content: translateSystemPrompt(targetLang, uiLang) + strictSuffix },
    { role: 'user', content: `USER: ${userText}\n\nTUTOR: ${reply}` },
  ]
}

/** Tiny-tier tutor messages (2-key schema, corrections excluded) */
export function buildTutorMessagesSimple(
  history: LlmMessage[],
  userText: string,
  level: Level,
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  extraInstructions = '',
  /** retry after the reply drifted into English: hard language rule */
  languageRetry = false,
): LlmMessage[] {
  let system = tutorSystemPromptSimple(level, targetLang, uiLang)
  const extra = extraInstructions.trim()
  if (extra) {
    system += `\n\nAdditional instructions from the student (follow them strictly):\n${extra.slice(0, 1000)}`
  }
  if (languageRetry && langNameForPrompt(targetLang) !== 'English') {
    system += `\n\nCRITICAL LANGUAGE RULE: your reply must be in ${langNameForPrompt(targetLang)} ONLY — every single word. English replies are forbidden.`
  }
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: userText }]
}

/** Tiny-tier corrections messages: single-key call on the last user message */
export function buildCorrectionsMessages(
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  userText: string,
): LlmMessage[] {
  return [
    { role: 'system', content: correctionsSystemPrompt(targetLang, uiLang) },
    { role: 'user', content: userText },
  ]
}

export function buildVocabMessages(
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  word: string,
): LlmMessage[] {
  return [
    { role: 'system', content: vocabSystemPrompt(targetLang, uiLang) },
    { role: 'user', content: word },
  ]
}

/** "no such word" comment in the UI language */
export function vocabNotRealDefaultComment(): string {
  return libT('errVocabNotRealDefault')
}

// ---------- Scaffolded tutor (docs/tutor-methodology.md) ----------
// Tiny-tier micro-generation: bare-line contracts only. The scenario asks the
// questions and supplies the chips; the model just writes one short sentence.

/** Reaction few-shot: without examples the 1B model falls into high-frequency
 *  exclamation skeletons ("Das ist schön, wie du kommst!"). The examples sit
 *  on topics DIFFERENT from the live turn and demonstrate the target shape:
 *  echo ONE concrete thing from the student's answer, then a short opinion. */
const REACTION_FEWSHOT: Record<TargetLang, LlmMessage[]> = {
  de: [
    {
      role: 'user',
      content:
        'Topic: Frühstück. Topic vocabulary: das Frühstück, der Kaffee, das Brötchen, der Käse.\n' +
        'You just asked: "Was isst du zum Frühstück?"\n' +
        'The student answered: "Ich esse ein Brötchen mit Käse."\n' +
        'Your one-sentence reaction:',
    },
    { role: 'assistant', content: 'Ein Brötchen mit Käse klingt lecker!' },
    {
      role: 'user',
      content:
        'Topic: Mein Hobby. Topic vocabulary: das Hobby, spielen, gern, das Wochenende.\n' +
        'You just asked: "Wie oft machst du das?"\n' +
        'The student answered: "Ich spiele zwei Stunde Fußball."\n' +
        'The student wrote "zwei Stunde"; the correct form is "zwei Stunden" — use the correct form naturally in your sentence.\n' +
        'Your one-sentence reaction:',
    },
    { role: 'assistant', content: 'Wow, zwei Stunden Fußball sind toll!' },
  ],
  en: [
    {
      role: 'user',
      content:
        'Topic: Breakfast. Topic vocabulary: breakfast, coffee, bread, cheese.\n' +
        'You just asked: "What do you have for breakfast?"\n' +
        'The student answered: "I eat bread with cheese."\n' +
        'Your one-sentence reaction:',
    },
    { role: 'assistant', content: 'Bread with cheese sounds tasty!' },
    {
      role: 'user',
      content:
        'Topic: My hobby. Topic vocabulary: hobby, play, weekend.\n' +
        'You just asked: "How often do you play?"\n' +
        'The student answered: "I play football two hour."\n' +
        'The student wrote "two hour"; the correct form is "two hours" — use the correct form naturally in your sentence.\n' +
        'Your one-sentence reaction:',
    },
    { role: 'assistant', content: 'Wow, two hours of football is great!' },
  ],
  fr: [
    {
      role: 'user',
      content:
        'Topic : Le petit déjeuner. Topic vocabulary : le petit déjeuner, le café, le pain, le fromage.\n' +
        'You just asked: "Qu’est-ce que tu manges au petit déjeuner ?"\n' +
        'The student answered: "Je mange du pain avec du fromage."\n' +
        'Your one-sentence reaction:',
    },
    { role: 'assistant', content: 'Du pain avec du fromage, ça a l’air bon !' },
  ],
  es: [
    {
      role: 'user',
      content:
        'Topic: El desayuno. Topic vocabulary: el desayuno, el café, el pan, el queso.\n' +
        'You just asked: "¿Qué desayunas?"\n' +
        'The student answered: "Como pan con queso."\n' +
        'Your one-sentence reaction:',
    },
    { role: 'assistant', content: '¡Pan con queso suena delicioso!' },
  ],
  pt: [
    {
      role: 'user',
      content:
        'Topic: O café da manhã. Topic vocabulary: o café da manhã, o pão, o queijo, o leite.\n' +
        'You just asked: "O que você come no café da manhã?"\n' +
        'The student answered: "Eu como pão com queijo."\n' +
        'Your one-sentence reaction:',
    },
    { role: 'assistant', content: 'Pão com queijo parece uma delícia!' },
  ],
}

/** One-sentence reaction to the student's last answer (bare line, no JSON) */
export function buildReactionMessages(
  targetLang: TargetLang,
  level: string,
  scenario: Scenario,
  userText: string,
  /** the question the answer belongs to (null on the very first turn) */
  previousQuestion: string | null,
  /** correction of the user's mistake — the reaction recasts it naturally */
  correction: Correction | null,
  extraPrompt: string,
  strict = false,
): LlmMessage[] {
  const target = langNameForPrompt(targetLang)
  const info = langInfo(targetLang)
  const strictSuffix = strict
    ? `\nRETRY: output ONLY one short ${target} sentence — no English, no question mark, no quotes, no emoji.`
    : ''
  return [
    {
      role: 'system',
      content: `You are a friendly ${target} tutor for a beginner (${level}).
Write ONE short sentence reacting to the student's last answer.
How: pick ONE concrete thing the student said (a place, a food, an activity, a name) and say a short opinion about it.
Rules:
- natural spoken ${target}, maximum 12 words, only ${level} vocabulary
- ${info.informalAddress}
- NO question, NO English${target === 'English' ? '' : ', no other language'}
- never write word options with "/" — always choose one word
- output ONLY the sentence — no quotes, no emoji, no markdown${strictSuffix}`,
    },
    ...REACTION_FEWSHOT[targetLang],
    {
      role: 'user',
      content: `Topic: ${scenario.title}. Topic vocabulary: ${scenario.vocab.slice(0, 12).join(', ')}.${
        previousQuestion ? `\nYou just asked: "${previousQuestion}"` : ''
      }
The student answered: "${userText}"${
        correction
          ? `\nThe student wrote "${correction.original}"; the correct form is "${correction.corrected}" — use the correct form naturally in your sentence.`
          : ''
      }${
        extraPrompt ? `\nExtra instructions from the student: ${extraPrompt}` : ''
      }
Your one-sentence reaction:`,
    },
  ]
}

/** Diary mode: ONE short supportive reaction to what the student told about
 *  their day — no questions, no new topics, never talk about yourself. */
export function buildDiaryReactionMessages(
  targetLang: TargetLang,
  level: string,
  userText: string,
  extraPrompt: string,
  strict = false,
): LlmMessage[] {
  const target = langNameForPrompt(targetLang)
  const info = langInfo(targetLang)
  const strictSuffix = strict
    ? `\nRETRY: output ONLY one short warm ${target} sentence — no question, no English, no "I".`
    : ''
  return [
    {
      role: 'system',
      content: `You are a friendly ${target} tutor. The student is telling you about their day.
Write ONE very short warm reaction to what they said.
Rules:
- maximum 10 words, only ${level} vocabulary; ${info.informalAddress}
- only react to WHAT the student told (empathy, interest, surprise)
- NO question, NO advice, NO new topic, never talk about yourself ("I" is forbidden)
- output ONLY the sentence — no quotes, no emoji${strictSuffix}`,
    },
    {
      role: 'user',
      content: `The student says: "${userText}"${
        extraPrompt ? `\nExtra instructions from the student: ${extraPrompt}` : ''
      }
Your one-sentence reaction:`,
    },
  ]
}

/** The tutor answers the student's question briefly, in first person (bare line) */
export function buildTutorAnswerMessages(
  targetLang: TargetLang,
  level: string,
  userText: string,
  tutorFacts: string[],
  extraPrompt: string,
  strict = false,
): LlmMessage[] {
  const target = langNameForPrompt(targetLang)
  const info = langInfo(targetLang)
  const strictSuffix = strict
    ? `\nRETRY: output ONLY 1-2 short ${target} sentences about yourself — no English, no question at the end.`
    : ''
  return [
    {
      role: 'system',
      content: `You are a friendly ${target} tutor for a beginner (${level}).
The student asked you a personal question. Answer it briefly as the tutor, using ONLY the numbered facts below — never invent new facts.
Rules:
- 1-2 very short sentences, first person, only ${level} vocabulary
- pick the fact that answers the question and stay close to its words
- natural spoken ${target}; ${info.informalAddress}
- do NOT ask a question back, do NOT switch to English
- output ONLY your answer — no quotes, no emoji${strictSuffix}`,
    },
    {
      role: 'user',
      content: `Facts about you (the tutor):\n${tutorFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')}${
        extraPrompt ? `\nExtra instructions from the student: ${extraPrompt}` : ''
      }
The student asks: "${userText}"
Your short answer:`,
    },
  ]
}
