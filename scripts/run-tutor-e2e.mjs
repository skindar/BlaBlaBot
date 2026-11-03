// Runner for the tutor E2E harness (scripts/tutor-e2e.ts + /tutor-e2e.html).
// Opens a HEADED Chromium (WebGPU needs a real GPU context) with a persistent
// profile so the 0.7 GB LLM download and whisper weights are cached between
// runs, plays all scripted learner turns through the real processChat
// pipeline, then saves the transcript and prints deterministic metrics.
//
// Usage:
//   npm run dev -- --port 5199 --strictPort   (in another terminal)
//   node scripts/run-tutor-e2e.mjs <out.json> [model-key]
//
// Requires playwright; the shared install from the playwright skill works:
//   PW_SKILL_DIR=... node scripts/run-tutor-e2e.mjs out.json

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// playwright comes from the playwright-skill install (not a project dependency)
const PW_DIR = process.env.PW_SKILL_DIR
  ? path.join(process.env.PW_SKILL_DIR, 'node_modules')
  : path.join(os.homedir(), '.agents/skills/playwright-skill/node_modules')
const { chromium } = await import(path.join(PW_DIR, 'playwright', 'index.mjs'))

// The installed browser build may differ from the one this playwright expects:
// use any installed chromium from the shared ms-playwright cache.
function findChromium() {
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  if (!fs.existsSync(cache)) return undefined
  const dirs = fs
    .readdirSync(cache)
    .filter(d => /^chromium-\d+$/.test(d))
    .sort()
    .reverse()
  for (const d of dirs) {
    for (const rel of [
      'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const p = path.join(cache, d, rel)
      if (fs.existsSync(p)) return p
    }
  }
  return undefined
}
const EXECUTABLE = findChromium()

const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'tutor-e2e.json')
const MODEL = process.argv[3] ?? 'gemma-3-1b'
const URL_BASE = process.env.E2E_URL ?? 'http://localhost:5199'
const PROFILE = process.env.E2E_PROFILE ?? path.join(os.tmpdir(), 'webllm-e2e-profile')

const ENGLISH_WORDS = new Set([
  'the', 'and', 'is', 'are', 'was', 'were', 'you', 'your', 'i', 'we', 'they',
  'he', 'she', 'it', 'this', 'that', 'what', 'which', 'who', 'when', 'where',
  'why', 'how', 'not', 'with', 'of', 'to', 'from', 'for', 'have', 'has', 'do',
  'does', 'would', 'could', 'should', 'can', 'very', 'really', 'just', 'yes',
])

function looksEnglish(text) {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length === 0) return false
  const markers = words.filter(w => ENGLISH_WORDS.has(w.replace(/'(s|ve|re|ll|d|m)$/, ''))).length
  return markers / words.length >= 0.25
}

function metrics(transcript) {
  const perPersona = []
  const totals = { turns: 0, errors: 0, oneQuestion: 0, questions: 0, englishDrift: 0, over34w: 0, emptyReply: 0, corrTurns: 0, corrections: 0, chipTurns: 0, fallbackUsed: 0, llmMs: 0, trMs: 0, repeatedQuestions: 0, errorTurnsTotal: 0, errorTurnsCaught: 0, falsePositives: 0 }
  for (const p of transcript.personas) {
    const m = { persona: p.persona, turns: 0, errors: 0, oneQuestion: 0, questions: 0, englishDrift: 0, over34w: 0, emptyReply: 0, corrTurns: 0, corrections: 0, chipTurns: 0, fallbackUsed: 0, llmMs: 0, trMs: 0, repeatedQuestions: 0, errorTurnsTotal: 0, errorTurnsCaught: 0, falsePositives: 0 }
    const asked = []
    for (const t of p.turns) {
      m.turns++
      if (t.error) { m.errors++; continue }
      const turnNo = m.turns
      const hasCorrections = (t.corrections ?? []).length > 0
      if (hasCorrections) { m.corrTurns++; m.corrections += t.corrections.length }
      // corrections precision/recall against the persona ground truth
      if ((p.errorTurns ?? []).includes(turnNo)) {
        m.errorTurnsTotal = (m.errorTurnsTotal ?? 0) + 1
        if (hasCorrections) m.errorTurnsCaught = (m.errorTurnsCaught ?? 0) + 1
      } else if (hasCorrections) {
        m.falsePositives = (m.falsePositives ?? 0) + 1
      }
      const q = (t.reply.match(/\?/g) ?? []).length
      const farewell = /tschüss|bis bald!|see you soon|à bientôt|¡hasta pronto|até logo/i.test(t.reply)
      m.questions += q
      if (q === 1 || (q === 0 && farewell)) m.oneQuestion++
      const w = t.reply.trim().split(/\s+/).length
      if (w > 34) m.over34w++
      if (!t.reply.trim()) m.emptyReply++
      if (looksEnglish(t.reply)) m.englishDrift++
      if ((t.corrections ?? []).length > 0) { m.corrTurns++; m.corrections += t.corrections.length }
      if ((t.suggestions ?? []).length > 0) m.chipTurns++
      const key = (t.reply.toLowerCase().match(/[a-zäöüß][^.!?]*\?/g) ?? []).join(' ').trim()
      if (key && asked.includes(key)) m.repeatedQuestions++
      if (key) asked.push(key)
      if (/tschü|auf wiedersehen|entschuldigung, das habe ich nicht verstanden/i.test(t.reply)) m.fallbackUsed++
      m.llmMs += t.timings?.llm_ms ?? 0
      m.trMs += t.timings?.translation_ms ?? 0
    }
    perPersona.push(m)
    for (const k of Object.keys(totals)) totals[k] += m[k] ?? 0
  }
  const ok = totals.turns - totals.errors
  const pct = x => (ok > 0 ? Math.round((100 * x) / ok) : 0)
  return {
    model: transcript.model,
    turns: totals.turns,
    errors: totals.errors,
    oneQuestionPct: pct(totals.oneQuestion),
    avgQuestionsPerReply: +(totals.questions / Math.max(1, ok)).toFixed(2),
    englishDrift: totals.englishDrift,
    over34Words: totals.over34w,
    emptyReplies: totals.emptyReply,
    repeatedQuestions: totals.repeatedQuestions,
    correctionsTurns: totals.corrTurns,
    correctionsTotal: totals.corrections,
    correctionsRecall: totals.errorTurnsTotal > 0 ? +(100 * totals.errorTurnsCaught / totals.errorTurnsTotal).toFixed(0) : null,
    correctionsFalsePositives: totals.falsePositives,
    chipTurns: totals.chipTurns,
    parseFallbackReplies: totals.fallbackUsed,
    avgLlmMs: Math.round(totals.llmMs / Math.max(1, ok)),
    avgTranslationMs: Math.round(totals.trMs / Math.max(1, ok)),
    perPersona,
  }
}

const browser = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  executablePath: EXECUTABLE,
  viewport: { width: 1280, height: 900 },
  args: ['--autoplay-policy=no-user-gesture-required'],
})

try {
  const page = browser.pages()[0] ?? (await browser.newPage())
  page.on('console', msg => {
    const text = msg.text()
    if (msg.type() === 'error' && !/favicon|404|Failed to load resource/.test(text)) {
      console.log('[page-error]', text.slice(0, 300))
    }
  })
  console.log(`opening ${URL_BASE}/tutor-e2e.html?model=${MODEL} …`)
  const q = new URLSearchParams({ model: MODEL })
  const turns = process.argv[4]
  const personas = process.argv[5]
  if (turns) q.set('turns', turns)
  if (personas) q.set('personas', personas)
  if (process.env.E2E_DIARY === '1' || process.argv[6] === 'diary') q.set('diary', '1')
  await page.goto(`${URL_BASE}/tutor-e2e.html?${q}`)
  // stream the harness status while it runs: the log element keeps the
  // newest line first, so the head of the text is the live status
  const done = page.waitForFunction(() => document.title === 'E2E-DONE' || document.title === 'E2E-FAIL', null, {
    timeout: 25 * 60_000,
    polling: 2000,
  })
  const statusTimer = setInterval(async () => {
    try {
      const text = await page.locator('#log').textContent()
      if (text) console.log('[status]', text.slice(0, 160).replace(/\n/g, ' | '))
    } catch {
      /* page closed */
    }
  }, 15_000)
  try {
    await done
  } finally {
    clearInterval(statusTimer)
  }
  const title = await page.title()
  if (title !== 'E2E-DONE') {
    const text = await page.locator('#log').textContent()
    console.error('HARNESS FAILED:\n', text?.slice(0, 3000))
    process.exitCode = 1
  }
  const transcript = await page.evaluate(() => window.__RESULTS)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(transcript, null, 2))
  const m = metrics(transcript)
  fs.writeFileSync(OUT.replace(/\.json$/, '') + '-metrics.json', JSON.stringify(m, null, 2))
  console.log('METRICS', JSON.stringify(m, null, 2))
  console.log('transcript →', OUT)
} finally {
  await browser.close()
}
