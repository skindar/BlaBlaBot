// Achievements: computes StudentStats from the repositories, evaluates the
// evolution policy (domain/policies/achievements.ts) and persists first-unlock
// dates. Recomputation is cheap and happens on demand — the UI subscribes to
// the data bus itself.

import type {
  AchievementsRepository,
  ActivityRepository,
  ConversationRepository,
  DiaryRepository,
  EventBusPort,
  SessionRepository,
  VocabularyRepository,
} from '../ports'
import type { StudentStats } from '../../domain/policies/achievements'
import { evaluateAchievements, totalXp, closestGoal } from '../../domain/policies/achievements'
import type { AchievementProgress } from '../../domain/policies/achievements'
import { TARGET_LANG_LIST } from '../../domain/policies/languages'

export interface AchievementsSnapshot {
  progress: AchievementProgress[]
  xp: number
  nextGoal: { title: string; progress: number } | null
}

export class AchievementsService {
  constructor(
    private readonly deps: {
      activity: ActivityRepository
      conversation: ConversationRepository
      diary: DiaryRepository
      vocab: VocabularyRepository
      sessions: SessionRepository
      achievements: AchievementsRepository
      bus: EventBusPort
    },
  ) {}

  private stats(): StudentStats {
    const days = this.deps.activity.list()
    const activeDays = Object.keys(days).filter(k => days[k] > 0).length
    let userMessages = 0
    for (const lang of TARGET_LANG_LIST) {
      for (const entry of this.deps.conversation.recent(lang, 1000)) {
        if (entry.role === 'user') userMessages++
      }
    }
    let scenariosCompleted = 0
    for (const lang of TARGET_LANG_LIST) {
      if (this.deps.sessions.get(lang)?.phase === 'free') scenariosCompleted++
    }
    let vocabTotal = 0
    let vocabKnown = 0
    for (const lang of TARGET_LANG_LIST) {
      const items = this.deps.vocab.list(lang)
      vocabTotal += items.length
      vocabKnown += items.filter(i => i.known).length
    }
    const diaryEntries = this.deps.diary.list().length
    // approximate the streak by activeDays until a dedicated tracker lands
    return {
      activeDays,
      streak: Math.min(activeDays, 7),
      userMessages,
      diaryEntries,
      vocabTotal,
      vocabKnown,
      scenariosCompleted,
    }
  }

  /** Evaluate + persist first-unlock dates. Idempotent. */
  snapshot(): AchievementsSnapshot {
    const stats = this.stats()
    const progress = evaluateAchievements(stats, this.deps.achievements.list())
    const today = new Date().toISOString().slice(0, 10)
    for (const p of progress) {
      if (p.unlocked && p.date) this.deps.achievements.unlock(p.def.id, p.date || today)
    }
    const goal = closestGoal(progress)
    return {
      progress,
      xp: totalXp(progress),
      nextGoal: goal ? { title: goal.def.title, progress: goal.progress ?? 0 } : null,
    }
  }
}
