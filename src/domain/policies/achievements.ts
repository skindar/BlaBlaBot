// Achievements: the evolution policy for the whole app (docs/achive-system.md).
//
// Four tiers, pure logic — everything is derived from StudentStats, so tests
// stay deterministic and the UI never invents unlock dates.
//   1. fragment — one micro-action (a lesson step, a diary page, first words)
//   2. skill    — a stable ability: requires all of its parents unlocked
//   3. mastery  — 2–3 skills of a branch merged and applied in real practice
//   4. legacy   — masteries of different branches + a real-life event
//
// Lineage: every non-fragment achievement carries `parents` — the click in the
// UI shows the whole build history ("из чего собрано").

import type { AchievementBranch, AchievementTier } from './achievementsBranches'

export interface StudentStats {
  /** distinct days with at least one user message or diary entry */
  activeDays: number
  /** consecutive activity days up to today (0 when no today activity) */
  streak: number
  /** total user messages across all languages */
  userMessages: number
  /** diary entries across all languages */
  diaryEntries: number
  /** flashcards saved */
  vocabTotal: number
  /** flashcards marked as known */
  vocabKnown: number
  /** scenario sessions that reached the free-talk phase */
  scenariosCompleted: number
}

export interface AchievementDef {
  id: string
  tier: AchievementTier
  branch: AchievementBranch
  icon: string
  title: string
  desc: string
  xp: number
  /** skill+: parents must be unlocked before this can unlock */
  parents: string[]
  /** fragment metric gate */
  metric?: { key: keyof StudentStats; target: number }
}

export interface AchievementProgress {
  def: AchievementDef
  unlocked: boolean
  /** YYYY-MM-DD of the first unlock (persisted by the repository) */
  date?: string
  /** 0..1 fragment progress towards the metric target */
  progress?: number
}

export interface AchievementCatalogEntry extends AchievementDef {
  label: string
}

const CATALOG: AchievementDef[] = [
  // ---------- fragments (metric-driven) ----------
  { id: 'first-words', tier: 'fragment', branch: 'deutsch', icon: '🌱', title: 'Первые слова', desc: 'Первый день практики в приложении', xp: 10, parents: [], metric: { key: 'activeDays', target: 1 } },
  { id: 'week-voice', tier: 'fragment', branch: 'deutsch', icon: '🔥', title: 'Неделя голоса', desc: 'Серия практики 3 дня и больше', xp: 25, parents: [], metric: { key: 'streak', target: 3 } },
  { id: 'ten-turns', tier: 'fragment', branch: 'deutsch', icon: '💬', title: '10 реплик', desc: '10 своих реплик в диалогах', xp: 10, parents: [], metric: { key: 'userMessages', target: 10 } },
  { id: 'fifty-turns', tier: 'fragment', branch: 'deutsch', icon: '💬', title: '50 реплик', desc: '50 своих реплик в диалогах', xp: 25, parents: [], metric: { key: 'userMessages', target: 50 } },
  { id: 'two-hundred-turns', tier: 'fragment', branch: 'deutsch', icon: '💬', title: '200 реплик', desc: '200 своих реплик в диалогах', xp: 25, parents: [], metric: { key: 'userMessages', target: 200 } },
  { id: 'diary-open', tier: 'fragment', branch: 'mind', icon: '📖', title: 'Дневник открыт', desc: 'Первая запись в дневнике', xp: 10, parents: [], metric: { key: 'diaryEntries', target: 1 } },
  { id: 'diary-five', tier: 'fragment', branch: 'mind', icon: '📖', title: '5 страниц дневника', desc: 'Пять записей в дневнике', xp: 25, parents: [], metric: { key: 'diaryEntries', target: 5 } },
  { id: 'vocab-ten', tier: 'fragment', branch: 'deutsch', icon: '🧩', title: 'Словарь 10', desc: '10 карточек в словаре', xp: 10, parents: [], metric: { key: 'vocabTotal', target: 10 } },
  { id: 'vocab-thirty', tier: 'fragment', branch: 'deutsch', icon: '🧩', title: 'Словарь 30', desc: '30 карточек в словаре', xp: 25, parents: [], metric: { key: 'vocabTotal', target: 30 } },
  { id: 'scenario-free', tier: 'fragment', branch: 'deutsch', icon: '🎬', title: 'Сценарий пройден', desc: 'Дошёл до свободной фазы в сценарии', xp: 25, parents: [], metric: { key: 'scenariosCompleted', target: 1 } },

  // ---------- skills (parents must be unlocked) ----------
  { id: 'skill-voice', tier: 'skill', branch: 'deutsch', icon: '🗣️', title: 'Голос: говорю регулярно', desc: 'Реплики копятся, серия не рвётся', xp: 150, parents: ['ten-turns', 'fifty-turns', 'week-voice'] },
  { id: 'skill-writer', tier: 'skill', branch: 'mind', icon: '✍️', title: 'Пишу сам', desc: 'Дневник стал привычкой', xp: 150, parents: ['diary-open', 'diary-five'] },
  { id: 'skill-vocab', tier: 'skill', branch: 'deutsch', icon: '🧠', title: 'Словарный запас A1', desc: '30 карточек, часть уже выучена', xp: 150, parents: ['vocab-ten', 'vocab-thirty'] },
  { id: 'skill-scenarios', tier: 'skill', branch: 'deutsch', icon: '🎬', title: 'Сценарии освоены', desc: '200 реплик и первый пройденный сценарий', xp: 150, parents: ['scenario-free', 'two-hundred-turns'] },

  // ---------- mastery ----------
  { id: 'mastery-a1', tier: 'mastery', branch: 'deutsch', icon: '🛡️', title: 'Разговорный немецкий A1', desc: 'Говорю, пишу и знаю слова — уровень A1 в тренажёре', xp: 400, parents: ['skill-voice', 'skill-vocab', 'skill-scenarios'] },
  { id: 'mastery-reflection', tier: 'mastery', branch: 'mind', icon: '🪞', title: 'Рефлексия на языке', desc: 'Думаю и пишу о своём дне на изучаемом языке', xp: 400, parents: ['skill-writer', 'skill-voice'] },

  // ---------- legacy ----------
  { id: 'legacy-tutor', tier: 'legacy', branch: 'deutsch', icon: '👑', title: 'BlaBlaBot — мой тренажёр', desc: 'Все мастерства собраны: приложение стало твоим личным тренажёром', xp: 1000, parents: ['mastery-a1', 'mastery-reflection'] },
]

export const ACHIEVEMENTS: AchievementDef[] = CATALOG

export function achievementById(id: string): AchievementDef | null {
  return CATALOG.find(a => a.id === id) ?? null
}

export const BRANCH_LABELS: Record<AchievementBranch, string> = {
  deutsch: 'Deutsch',
  career: 'Career',
  creator: 'Creator',
  body: 'Body',
  mind: 'Mind',
  tools: 'Tools',
}

// ---------- pure evaluation ----------

function metricValue(stats: StudentStats, key: keyof StudentStats): number {
  const v = stats[key]
  return typeof v === 'number' ? v : 0
}

function parentsUnlocked(def: AchievementDef, unlockedIds: Set<string>): boolean {
  return def.parents.every(p => unlockedIds.has(p))
}

/** Pure evolution: which achievements are unlocked for these stats. Parent
 *  rules are evaluated iteratively so skills can unlock fragments→skills in
 *  one pass (fragments first, then skills, mastery, legacy — tier order). */
export function evaluateAchievements(
  stats: StudentStats,
  storedDates: Record<string, string> = {},
  todayKey?: string,
): AchievementProgress[] {
  const unlockedIds = new Set<string>()
  const result: AchievementProgress[] = []
  const tiers: AchievementTier[] = ['fragment', 'skill', 'mastery', 'legacy']
  for (const tier of tiers) {
    for (const def of CATALOG.filter(a => a.tier === tier)) {
      const stored = storedDates[def.id]
      let unlocked = Boolean(stored)
      let progress: number | undefined
      if (def.metric) {
        const value = metricValue(stats, def.metric.key)
        unlocked = unlocked || value >= def.metric.target
        progress = Math.min(1, value / def.metric.target)
      }
      if (def.parents.length > 0) {
        unlocked = unlocked || parentsUnlocked(def, unlockedIds)
      }
      if (unlocked) unlockedIds.add(def.id)
      const date = stored ?? (unlocked ? todayKey ?? new Date().toISOString().slice(0, 10) : undefined)
      result.push({ def, unlocked, date, progress })
    }
  }
  return result
}

/** XP sum over unlocked achievements. */
export function totalXp(progress: AchievementProgress[]): number {
  return progress.filter(p => p.unlocked).reduce((s, p) => s + p.def.xp, 0)
}

/** Next locked achievement the student is closest to (for the UI hint). */
export function closestGoal(progress: AchievementProgress[]): AchievementProgress | null {
  const locked = progress.filter(p => !p.unlocked)
  if (!locked.length) return null
  return locked.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0] ?? null
}
