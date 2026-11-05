import { describe, expect, it } from 'vitest'
import { SCENARIOS, newSession } from '../scenarios'
import { planTutorTurn, scenarioToSpec } from '../scenarioSpec'

const scenario = SCENARIOS.find(s => s.id === 'de-a1-kennenlernen')!
const spec = scenarioToSpec(scenario)

describe('scenario controller', () => {
  it('plans the first guided question with its chips', () => {
    const plan = planTutorTurn(spec, newSession(scenario, 'kennenlernen'))
    expect(plan.phase).toBe('guided')
    expect(plan.question).toBe(scenario.turns[0].question)
    expect(plan.chips.map(c => c.text)).toEqual(scenario.turns[0].chips)
    expect(plan.nextSession.nextIndex).toBe(1)
    expect(plan.nextSession.phase).toBe('guided')
  })

  it('switches to the free phase after the last guided step', () => {
    const lastGuided = { ...newSession(scenario, 'kennenlernen'), nextIndex: scenario.turns.length - 1 }
    const plan = planTutorTurn(spec, lastGuided)
    expect(plan.phase).toBe('guided')
    expect(plan.nextSession.phase).toBe('free')
    expect(plan.nextSession.nextIndex).toBe(scenario.turns.length)
  })

  it('never prescribes a question in the free phase', () => {
    const free = { ...newSession(scenario, 'kennenlernen'), nextIndex: scenario.turns.length, phase: 'free' as const }
    const plan = planTutorTurn(spec, free)
    expect(plan.phase).toBe('free')
    expect(plan.question).toBeNull()
    expect(plan.chips).toEqual([])
    expect(plan.nextSession.phase).toBe('free')
  })
})
