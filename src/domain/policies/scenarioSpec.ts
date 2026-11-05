// Scenario DSL + deterministic controller.
//
// The tutor's structure is data: a goal, an ordered list of guided steps and
// an optional free phase. The model may phrase a reply, but the controller
// decides which step is active, whether a prescribed question is allowed and
// when the lesson moves from guided practice to a free conversation.

import type { Suggestion } from '../models'
import type { Scenario, ScenarioTurn, TutorSession } from './scenarios'

export type TutorPhase = 'guided' | 'free'

export interface ScenarioStepSpec {
  id: string
  question: string
  chips: string[]
}

export interface ScenarioSpec {
  id: string
  lang: Scenario['lang']
  title: string
  goal: string
  vocab: string[]
  steps: ScenarioStepSpec[]
  /** after the last guided step: keep the topic, drop the prescribed question */
  freePhase: boolean
}

export interface TutorTurnPlan {
  phase: TutorPhase
  /** null in the free phase — the model picks its own follow-up */
  question: string | null
  chips: Suggestion[]
  nextSession: TutorSession
}

export function scenarioToSpec(scenario: Scenario): ScenarioSpec {
  return {
    id: scenario.id,
    lang: scenario.lang,
    title: scenario.title,
    goal: scenario.title,
    vocab: scenario.vocab,
    steps: scenario.turns.map((turn: ScenarioTurn, index: number) => ({
      id: `${scenario.id}-${index}`,
      question: turn.question,
      chips: (turn.chips as string[]).slice(),
    })),
    freePhase: true,
  }
}

/** The single deterministic decision point for a full-tier tutor turn. */
export function planTutorTurn(spec: ScenarioSpec, session: TutorSession): TutorTurnPlan {
  const index = Math.max(0, session.nextIndex)
  const guided = session.phase !== 'free' && index < spec.steps.length

  if (guided) {
    const step = spec.steps[index]
    const nextIndex = index + 1
    const nextPhase: TutorPhase =
      spec.freePhase && nextIndex >= spec.steps.length ? 'free' : 'guided'
    return {
      phase: 'guided',
      question: step.question,
      chips: step.chips.map(text => ({ text, translation: '' })),
      nextSession: { ...session, nextIndex, phase: nextPhase },
    }
  }

  return {
    phase: 'free',
    question: null,
    chips: [],
    nextSession: { ...session, phase: 'free' },
  }
}
