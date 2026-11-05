import { describe, expect, it } from 'vitest'
import { evaluateAchievements, totalXp, closestGoal } from '../achievements'
import type { StudentStats } from '../achievements'

const stats = (over: Partial<StudentStats> = {}): StudentStats => ({
  activeDays: 0,
  streak: 0,
  userMessages: 0,
  diaryEntries: 0,
  vocabTotal: 0,
  vocabKnown: 0,
  scenariosCompleted: 0,
  ...over,
})

describe('evaluateAchievements', () => {
  it('fragments unlock by metric', () => {
    const res = evaluateAchievements(stats({ userMessages: 10 }))
    const ten = res.find(p => p.def.id === 'ten-turns')
    expect(ten?.unlocked).toBe(true)
    expect(ten?.date).toBeDefined()
  })

  it('skills need their parents', () => {
    // 50 сообщений есть, но серии 3 дня нет → «Голос» закрыт
    const res = evaluateAchievements(stats({ userMessages: 50 }))
    const voice = res.find(p => p.def.id === 'skill-voice')
    expect(voice?.unlocked).toBe(false)
    expect(voice?.def.parents).toContain('week-voice')
  })

  it('skills unlock when all parents are unlocked', () => {
    const res = evaluateAchievements(stats({ userMessages: 50, streak: 3 }))
    const voice = res.find(p => p.def.id === 'skill-voice')
    expect(voice?.unlocked).toBe(true)
  })

  it('mastery requires skills, legacy requires masteries', () => {
    const res = evaluateAchievements(
      stats({ userMessages: 200, streak: 3, diaryEntries: 5, vocabTotal: 30 }),
    )
    const mastery = res.find(p => p.def.id === 'mastery-a1')
    // skill-writer (5 дневников) не собран → мастерство A1 закрыто
    expect(mastery?.unlocked).toBe(false)
    const legacy = res.find(p => p.def.id === 'legacy-tutor')
    expect(legacy?.unlocked).toBe(false)
  })

  it('mastery unlocks when skills are complete', () => {
    const forced = evaluateAchievements(
      stats({ userMessages: 200, streak: 3, diaryEntries: 5, vocabTotal: 30, scenariosCompleted: 1 }),
      { 'skill-writer': '2026-11-01' },
    )
    const reflection = forced.find(p => p.def.id === 'mastery-reflection')
    expect(reflection?.unlocked).toBe(true)
    const a1 = forced.find(p => p.def.id === 'mastery-a1')
    expect(a1?.unlocked).toBe(true)
    const legacy = forced.find(p => p.def.id === 'legacy-tutor')
    // обе мастерства открыты → легенда открыта (итеративный проход по тирам)
    expect(legacy?.unlocked).toBe(true)
  })

  it('without the free-phase scenario mastery-a1 stays locked', () => {
    const res = evaluateAchievements(
      stats({ userMessages: 200, streak: 3, diaryEntries: 5, vocabTotal: 30 }),
    )
    const a1 = res.find(p => p.def.id === 'mastery-a1')
    expect(a1?.unlocked).toBe(false)
  })

  it('progress is fraction of target', () => {
    const res = evaluateAchievements(stats({ userMessages: 25 }))
    const fifty = res.find(p => p.def.id === 'fifty-turns')
    expect(fifty?.progress).toBeCloseTo(0.5)
  })

  it('xp counts only unlocked', () => {
    const empty = totalXp(evaluateAchievements(stats()))
    expect(empty).toBe(0)
    const some = totalXp(evaluateAchievements(stats({ userMessages: 10, activeDays: 1 })))
    expect(some).toBeGreaterThan(0)
  })

  it('closestGoal picks a locked achievement', () => {
    const goal = closestGoal(evaluateAchievements(stats({ userMessages: 25 })))
    expect(goal).not.toBeNull()
    expect(goal?.unlocked).toBe(false)
  })
})
