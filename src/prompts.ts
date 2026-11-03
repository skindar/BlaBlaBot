// Tutor/translator/dictionary prompts. Parameterized by the target language
// and the UI language: translations and error explanations use the UI language,
// while the conversation itself runs in the target language. Ported from backend/prompts + llm.py.

import { libT } from './i18n'
import { langInfo, langNameForPrompt, uiLangNameForPrompt, type TargetLang } from './lib/langs'
import type { Level } from './types'

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
Respond in natural conversational ${target}; ${info.informalAddress}.
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
Translate each into natural, simple ${explain}.
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

/** Port of build_tutor_messages from backend/models/llm.py */
export function buildTutorMessages(
  history: LlmMessage[],
  userText: string,
  level: Level,
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  extraInstructions = '',
): LlmMessage[] {
  let system = tutorSystemPrompt(level, targetLang, uiLang)
  const extra = extraInstructions.trim()
  if (extra) {
    system += `\n\nAdditional instructions from the student (follow them strictly):\n${extra.slice(0, 1000)}`
  }
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: userText }]
}

export function buildTranslateMessages(
  targetLang: TargetLang,
  uiLang: 'ru' | 'en',
  userText: string,
  reply: string,
): LlmMessage[] {
  return [
    { role: 'system', content: translateSystemPrompt(targetLang, uiLang) },
    { role: 'user', content: `USER: ${userText}\n\nTUTOR: ${reply}` },
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
