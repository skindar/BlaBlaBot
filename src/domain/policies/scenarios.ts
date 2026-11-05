// Scenario bank + session state for the scaffolded tutor (docs/tutor-methodology.md).
//
// The scenario is the deterministic half of the tutor: curated questions in a
// pedagogical order, an easier scaffold variant per question, deterministic
// reaction templates (the quality floor when the tiny model's micro-generation
// fails validation) and model-answer chips. The LLM only ever *upgrades* the
// reaction — it can never break the lesson structure.
//
// A1–A2 content note: every question is one short sentence in Present/Perfekt,
// one communicative function per turn, and the chips are the canonical answers
// the level expects ("Ich heiße …", "Ich komme aus …").

import type { Level } from '../models'
import { contentStems } from './parse'
import { TUTOR_TRANSITION, type TargetLang } from './languages'
import scenarioData from './scenarios.json'

/** Fixed UI-language translations of the deterministic reply parts */
export interface TrPair {
  ru: string
  en: string
}

export interface ScenarioTurn {
  /** canonical question the tutor asks at this step */
  question: string
  questionTr: TrPair
  /** easier variant with a choice — for short/empty answers */
  scaffold: string
  scaffoldTr: TrPair
  /** short re-ask variant, used after answering the student's own question */
  reask?: string
  reaskTr?: TrPair
  /** deterministic reaction templates by tone (the quality floor) */
  reactions: { positive: string; negative: string; short: string }
  /** canonical student answers for the chips */
  chips: [string, string, string]
  /** the tutor's own facts, for "und du?" questions */
  tutorFacts: string[]
}

export interface Scenario {
  id: string
  lang: TargetLang
  level: 'A1' | 'A2'
  title: string
  titleTr: TrPair
  /** keywords to match the sidebar topic field (lowercase) */
  keywords: string[]
  vocab: string[]
  turns: ScenarioTurn[]
}

export const SCENARIOS: Scenario[] = scenarioData as unknown as Scenario[]

// ---------- Scenario selection ----------

function scenarioLevelFor(level: Level): 'A1' | 'A2' {
  return level === 'A1' ? 'A1' : 'A2'
}

/** Pick the scenario for a language: keyword match against the sidebar topic
 *  first, then the level default. */
export function selectScenario(lang: TargetLang, level: Level, topic: string, topicId?: string): Scenario {
  const wanted = scenarioLevelFor(level)
  const bank = SCENARIOS.filter(s => s.lang === lang)
  // an explicit scenario id always wins — the topic picker stores ids, and a
  // title like "Small talk" must never collide with another scenario's
  // keywords (Kennenlernen used to catch it and the topic snapped back)
  if (topicId) {
    const byId = bank.find(s => s.id === topicId)
    if (byId) return byId
  }
  const t = topic.trim().toLowerCase()
  if (t) {
    const hit = bank.find(s => s.keywords.some(k => t.includes(k)))
    if (hit) return hit
  }
  return (
    bank.find(s => s.level === wanted) ??
    bank.find(s => s.level === 'A1') ??
    bank[0]
  )
}

export function scenarioById(id: string): Scenario | null {
  return SCENARIOS.find(s => s.id === id) ?? null
}

/** The next scenario of the language (round-robin) when the current one ends */
export function nextScenario(current: Scenario): Scenario {
  const bank = SCENARIOS.filter(s => s.lang === current.lang)
  if (bank.length <= 1) return current
  const idx = bank.findIndex(s => s.id === current.id)
  return bank[(idx + 1) % bank.length]
}

export function transitionLine(lang: TargetLang, next: Scenario): string {
  return TUTOR_TRANSITION[lang].replace('{topic}', next.title)
}

/** The tutor persona across ALL topics of the language — the answer bank for
 *  "und du?" questions. Must stay in sync with the per-turn tutorFacts. */
export const TUTOR_PERSONA: Record<TargetLang, string[]> = {
  de: [
    'Ich heiße Anna und bin Deutschlehrerin.',
    'Ich komme aus Deutschland, aus Berlin.',
    'Ich wohne in Berlin.',
    'Ich trinke morgens immer Kaffee mit Milch und ein bisschen Zucker.',
    'Ich esse gern ein Brötchen mit Käse.',
    'Ich frühstücke jeden Tag.',
    'Ich koche gern und gehe gern im Park spazieren.',
    'Ich höre gern Musik und lese Bücher.',
    'Am Wochenende war ich im Park und habe ein Buch gelesen.',
    'Nächstes Wochenende besuche ich meine Schwester.',
  ],
  en: [
    'My name is Anna and I am an English tutor.',
    'I come from London.',
    'I always have tea and toast for breakfast.',
    'I like music and long walks.',
    'At the weekend I read books in the park.',
  ],
  fr: [
    'Je m’appelle Anna et je suis ta prof de français.',
    'Je viens de Paris.',
    'Je bois toujours un café le matin.',
    'J’aime la musique et me promener.',
  ],
  es: [
    'Me llamo Ana y soy tu profesora de español.',
    'Soy de Madrid.',
    'Siempre desayuno café con leche y tostadas.',
    'Me gusta la música y caminar.',
  ],
  pt: [
    'Eu me chamo Ana e sou sua professora de português.',
    'Eu sou de São Paulo.',
    'Eu sempre tomo café com leite de manhã.',
    'Eu gosto de música e de caminhar.',
  ],
  ru: [
    'Меня зовут Анна, я преподаватель русского языка.',
    'Я из России, из Москвы.',
    'Я живу в Москве.',
    'Утром я всегда пью кофе с молоком и немного сахара.',
    'Я люблю бутерброд с сыром.',
    'Я завтракаю каждый день.',
    'Я люблю готовить и гулять в парке.',
    'Я читаю книги и слушаю музыку.',
    'Я была в кино на выходных.',
    'Моё любимое время года — осень.',
  ],
}

/** Top-3 persona facts for the student's question: score = shared content
 *  stems (contentStems); the current turn's own facts get +0.5 so a bare
 *  "Und du?" still echoes the live question's answer. */
export function selectTutorFacts(
  lang: TargetLang,
  turn: ScenarioTurn | null,
  userText: string,
): string[] {
  const q = contentStems(userText)
  const pool: Array<{ fact: string; score: number }> = []
  for (const fact of TUTOR_PERSONA[lang]) {
    let score = 0
    for (const s of contentStems(fact)) if (q.has(s)) score++
    pool.push({ fact, score })
  }
  if (turn) {
    for (const f of turn.tutorFacts) {
      let score = 0.5
      for (const s of contentStems(f)) if (q.has(s)) score++
      pool.push({ fact: f, score })
    }
  }
  const seen = new Set<string>()
  return pool
    .sort((a, b) => b.score - a.score)
    .filter(p => (seen.has(p.fact) ? false : seen.add(p.fact)))
    .slice(0, 3)
    .map(p => p.fact)
}

/** Top-ranked persona fact with its relevance score (see selectTutorFacts). */
export function topTutorFact(
  lang: TargetLang,
  turn: ScenarioTurn | null,
  userText: string,
): { fact: string; score: number } | null {
  const q = contentStems(userText)
  let best: { fact: string; score: number } | null = null
  const consider = (fact: string, base: number) => {
    let score = base
    for (const s of contentStems(fact)) if (q.has(s)) score++
    if (!best || score > best.score) best = { fact, score }
  }
  if (turn) for (const f of turn.tutorFacts) consider(f, 0.5)
  for (const fact of TUTOR_PERSONA[lang]) consider(fact, 0)
  return best
}

// ---------- Session state (persisted per language alongside the dialog) ----------

export interface TutorSession {
  scenarioId: string
  /** index of the scenario turn whose question will be asked NEXT */
  nextIndex: number
  /** the extraPrompt value the scenario was selected for — re-select on change */
  topicKey: string
  /** consecutive relevance-gate stays (advance is forced after 2) */
  stayCount?: number
  /** the last question the tutor asked (re-asks pick a different variant) */
  lastQuestion?: string
  /** guided scenario turns first, then a controlled free phase on the same topic */
  phase?: 'guided' | 'free'
}

export function newSession(scenario: Scenario, topicKey: string): TutorSession {
  return { scenarioId: scenario.id, nextIndex: 0, topicKey, phase: 'guided' }
}
