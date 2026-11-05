import { describe, expect, it } from 'vitest'
import { SCENARIOS } from '../scenarios'

describe('external scenario data', () => {
  it('has unique ids and valid bilingual titles', () => {
    const ids = new Set<string>()
    for (const scenario of SCENARIOS) {
      expect(scenario.id).toBeTruthy()
      expect(ids.has(scenario.id)).toBe(false)
      ids.add(scenario.id)
      expect(scenario.titleTr.ru.length).toBeGreaterThan(0)
      expect(scenario.titleTr.en.length).toBeGreaterThan(0)
    }
  })

  it('has non-empty guided steps with exactly three chips each', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.turns.length).toBeGreaterThan(0)
      for (const turn of scenario.turns) {
        expect(turn.question.trim().length).toBeGreaterThan(0)
        expect(turn.chips).toHaveLength(3)
        expect(turn.scaffold.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
