// Tutor E2E harness: drives the REAL processChat pipeline (LLM → corrections →
// translation → composition) with scripted A1–A2 learner turns, entirely in
// the browser. Served by vite dev as /tutor-e2e.html; the runner
// (scripts/run-tutor-e2e.mjs) collects window.__RESULTS.
//
// No ASR/TTS involvement: text input + system-voice tts settings (TTS is only
// "ensured", never spoken, so no model downloads beyond LLM + whisper).

import { llmEngine } from '../src/lib/llm'
import { asrEngine } from '../src/lib/asr'
import { processChat } from '../src/lib/engine'
import { conversation, diary } from '../src/lib/store'
import { setLibLang } from '../src/i18n'
import type { ChatResponse } from '../src/types'

interface Persona {
  id: string
  level: 'A1' | 'A2'
  extraPrompt: string
  /** 1-based turn numbers that contain a REAL grammar error (for the
   *  corrections precision/recall metric); all other turns must stay clean */
  errorTurns: number[]
  turns: string[]
}

/** Scripted learners with typical CEFR A1–A2 mistakes:
 *  article/case errors, verb-second violations, telegraphic answers,
 *  made-up words, and mid-dialog questions to the tutor. */
const PERSONAS: Persona[] = [
  {
    id: 'p1-quiet-a1',
    level: 'A1',
    extraPrompt: '',
    errorTurns: [],
    turns: [
      'Guten Tag.',
      'Ich heiße Sascha.',
      'Ich komme aus Russland.',
      'Ich wohne in Moskau.',
      'Ja, ich trinke Kaffee.',
      'Mit Milch.',
      'Und du? Was trinkst du morgens?',
      'Ich esse Brot mit Käse.',
    ],
  },
  {
    id: 'p2-chatty-a1',
    level: 'A1',
    extraPrompt: '',
    errorTurns: [2, 3, 4, 7],
    turns: [
      'Hallo! Mir geht es gut, danke.',
      'Ich habe Hobby Fußball.',
      'Ich spiele Fußball mit Freunde.',
      'Gestern ich spiele Fußball zwei Stunden.',
      'Ja, Fußball macht Spaß.',
      'Was machst du am Wochenende?',
      'Ich habe kein Zeit am Sonntag.',
      'Ok, tschüss!',
    ],
  },
  {
    id: 'p3-past-a2',
    level: 'A2',
    extraPrompt: '',
    errorTurns: [2, 4, 5, 7],
    turns: [
      'Hallo! Ich bin Maria. Wie geht es dir?',
      'Am Wochenende ich habe einen Film gesehen.',
      'Der Film war sehr gut und interessant.',
      'Ich bin ins Kino gegangen mit mein Freund.',
      'Wir haben Pizza gegessen danach.',
      'Und du? Was hast du am Wochenende gemacht?',
      'Nächste Woche ich besuche meine Eltern.',
      'Ja, gerne! Auf Wiedersehen.',
    ],
  },
]

const MODEL_KEY = new URLSearchParams(location.search).get('model') ?? 'gemma-3-1b'
const TURN_LIMIT = Number(new URLSearchParams(location.search).get('turns') ?? '0')
const PERSONA_LIMIT = Number(new URLSearchParams(location.search).get('personas') ?? '0')
const DIARY_MODE = new URLSearchParams(location.search).get('diary') === '1'

/** Diary-mode persona: the student narrates their day (A1-A2 mistakes) */
const DIARY_PERSONA: Persona = {
  id: 'd1-diary-a1',
  level: 'A1',
  extraPrompt: '',
  errorTurns: [2, 4],
  turns: [
    'Hallo! Ich will über mein Tag erzählen.',
    'Heute Morgen ich habe viel gearbeitet.',
    'Danach bin ich einkaufen gegangen.',
    'Abends habe ich einen Film gesehen mit mein Freund.',
    'Der Film war sehr lustig.',
    'Und du? Was hast du heute gemacht?',
    'Das war mein Tag. Tschüss!',
  ],
}

function log(...args: unknown[]): void {
  const el = document.getElementById('log')!
  el.textContent = `${args.join(' ')}\n` + el.textContent.slice(0, 4000)
  console.log(...args)
}

function pick(res: ChatResponse) {
  return {
    reply: res.reply,
    user_translation: res.user_translation,
    translation: res.translation,
    corrections: res.corrections,
    suggestions: res.suggestions,
    follow_up: res.follow_up,
    warning: res.warning,
    timings: res.timings,
  }
}

async function main(): Promise<void> {
  setLibLang('ru')
  log(`loading llm ${MODEL_KEY}…`)
  await llmEngine.ensure(MODEL_KEY, p => {
    log(`llm: ${p.text}`.slice(0, 160))
  })
  log('loading whisper-base…')
  await asrEngine.ensure('base', p => {
    log(`asr: ${p.text}`.slice(0, 160))
  })
  log('models ready')

  const results: unknown = { model: MODEL_KEY, diary: DIARY_MODE, personas: [] }
  const personas = DIARY_MODE ? [DIARY_PERSONA] : PERSONAS.slice(0, PERSONA_LIMIT || undefined)
  for (const persona of personas) {
    log(`— persona ${persona.id} (${persona.level})${DIARY_MODE ? ' DIARY' : ''} —`)
    conversation.reset('de')
    if (DIARY_MODE) diary.setState('de', { qIdx: 0 })
    const turns: unknown[] = []
    for (const text of persona.turns.slice(0, TURN_LIMIT || undefined)) {
      try {
        const res = await processChat({
          text,
          level: persona.level,
          targetLang: 'de',
          uiLang: 'ru',
          llmKey: MODEL_KEY,
          extraPrompt: persona.extraPrompt,
          diaryMode: DIARY_MODE,
          tts: { engine: 'system', voice: '', phononBase: '' },
        })
        turns.push({ user: text, ...pick(res) })
        log(`U: ${text}\nT: ${res.reply}`)
      } catch (err) {
        turns.push({ user: text, error: err instanceof Error ? err.message : String(err) })
        log(`U: ${text}\nERROR: ${err instanceof Error ? err.message : err}`)
      }
    }
    ;(results as { personas: unknown[] }).personas.push({
      persona: persona.id,
      level: persona.level,
      errorTurns: persona.errorTurns,
      turns,
    })
  }

  if (DIARY_MODE) {
    ;(results as { diaryEntries?: unknown }).diaryEntries = diary.list('de')
  }

  ;(window as unknown as Record<string, unknown>).__RESULTS = results
  document.title = 'E2E-DONE'
}

main().catch(err => {
  log('FAIL:', err instanceof Error ? err.stack : String(err))
  document.title = 'E2E-FAIL'
})
