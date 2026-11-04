# Tutor brain: three tiers and the level engine (design)

Analysis of how the tutor's "brain" works today in its three runtime
configurations, and the design for phrase-based teaching with real CEFR
difficulty scaling (A1 → native). Companion to `tutor-methodology.md`.

## 1. How the three brains work today

All three share one deterministic spine in `engine.ts` / `tutor.ts` /
`scenarios.ts`: the scenario session (turns with prescribed questions, chips,
vocab, tutor facts), the relevance gate (advance / stay / scaffold / answer /
farewell), reply polishing (dedup, single question, TTS-clean), the
corrections filter, translation validation, history auto-trim and bench
metrics. What differs is how much of each reply the model writes.

### Tier A — Cloud brain (GLM-5.3-Flash via Custom URL)

- `chatBrain()` routes every call to the OpenAI-compatible endpoint
  (streamed, `thinking:{type:'disabled'}` on Z.AI hosts so the budget is not
  spent on hidden reasoning).
- Always the **full contract**: one JSON call returns reply + corrections +
  suggestions; the model's own question is kept (the prescribed one is only
  appended when the model asked nothing); `MEMORY RULE` grounding makes the
  conversation history the memory — verified: name asked once, never again;
  content-reactive replies.
- Level today: the string "at ${level} level" in the system prompt. Nothing
  else scales with it.
- Measured: 3–6 s per full turn, corrections arrive with Russian
  explanations, quality is conversation-grade.
- Limits: difficulty control is a hope, not a mechanism; B1+ has no data
  support; teaching is implicit (no target phrases, no recasting).

### Tier B — Full local (gemma-4-E2B, Qwen2.5-1.5B, WebGPU)

- Same full-tier path as the cloud, plus guards the cloud does not need:
  language-drift rescue retry, template floor for still-English replies.
- 12.9 tok/s on E2B → ~11 s per structured turn; strict-JSON compliance ~38 %
  at temperature 0 → corrections coverage is a lottery; the filter drops
  degenerate ones, so weak-model turns often ship without corrections.
- Context hard-capped at 4096 tokens (prebuilt web-llm builds) with the
  calibrated auto-trim — history survives as ~10–12 turns.
- Level today: same prompt string + `maxWordsFor` caps (A1 22 words).

### Tier C — Tiny (gemma3-1b, Qwen3-0.6B, Llama-3.2-1B)

- The model is a **reaction writer** (20–30 words) inside a deterministic
  scaffold: farewell/intro/greeting handled by data, the question comes from
  the scenario turn, chips come from data, corrections are separate
  per-sentence "fix the sentence" calls + a local word-diff with a
  same-stem guard (no name/person "fixes").
- 97 % strict-JSON compliance on the contracts it is given; 2–3 s per turn.
- Level today: word caps and the A1/A2 scenario banks. Reactions are short by
  construction, so overshoot is rare; richness is absent by construction.

### Honest gaps against the goal ("teach through common phrases, difficulty
from A1 to native")

1. **B1/B2 are a placebo**: the UI offers A1–B2 but scenario data has only
   A1/A2 bands; `scenarioLevelFor` maps B1/B2 → A2. No C1/native at all.
2. **No phrase syllabus**: chips hint at phrases, but no turn has a *target
   phrase*, the tutor never deliberately recasts the student's attempt, and
   taught phrases never re-enter later scenarios.
3. **No difficulty mechanism**: level is one prompt string; nothing measures
   whether the tutor's reply actually sits at the declared level; nothing
   adapts.
4. **Corrections quality is tier-dependent** (cloud: good; E2B: spotty;
   tiny: ~half of planted errors).

## 2. Design: one spine, three skins, a real level engine

Principle: everything pedagogical is data + deterministic code; the model
only ever writes prose inside the rules. The stronger the brain, the more
freedom it gets — never more responsibility.

### 2.1 Level scale and bands

- Internal scale 1–6 with half-steps: A1, A2, B1, B2, C1, Native. UI gains
  C1 and Native (Native = free-talk: scenario spine off, memory rule and
  corrections stay on).
- **Grammar ladder** (data, per language): which constructions each band may
  use — A1: Präsens, sein/haben, W-questions; A2: Perfekt, modal verbs,
  weil/denn; B1: würde/hätte/könnte, relative clauses, als/wenn; B2: Passiv,
  Genitiv, concessives; C1: Nominalstil, participial attributes, idioms.
  Goes into grounding as "allowed grammar / constructions above B1 are
  forbidden this turn" — the first real difficulty mechanism.
- **Frequency vocabulary** (data): rank-ordered word list per language
  (public frequency lists); band = rank window (A1 top ~600, A2 ~1500,
  B1 ~3000, B2 ~5000, C1+ unrestricted). Doubles as the difficulty meter
  below.

### 2.2 Phrase book and the teaching loop

- **Phrase book** (data): 30–60 functional phrases per band per language
  ("Ich heiße …", "Ich hätte gern …", "Könntest Sie mir sagen …", "Ich
  bezweifle, dass …"), each with a translation and a grammar tag.
- Every scenario turn gets a **target phrase**; the chip already on screen
  *is* the target phrase. The grounding tells the model: "this turn teaches
  the phrase X — reward any attempt at it, then use the correct form
  naturally in your reply" (**recasting**, the core feedback technique —
  tiny tier does it deterministically by prefixing the corrected chip).
- **Taught-phrase tracking**: a phrase the student used successfully goes to
  the flashcard deck (exists) and is mixed into later scenarios' chips
  (spaced re-entry, deterministic).

### 2.3 Difficulty guard (deterministic, all tiers)

A small CEFR estimator scores the tutor's *own* reply before it ships:
average sentence length, share of words outside the band's frequency window,
regex hits on higher-band constructions (Passiv, Konjunktiv II …). Overshoot
→ one "simplify to ${level}" retry (cloud/full) or the template floor
(tiny). This makes "difficulty scales with level" measurable and gives the
Bench a per-model `level_fit` metric. Undershoot is reported, not retried.

### 2.4 Adaptation (progression)

Deterministic tracker, identical for all tiers, per session: corrections per
turn, answer length, target-phrase hits, relevance-gate stays. EMA of
"ease"; 4+ clean turns → suggest a level-up (toast, user confirms); heavy
struggle → soften within the band (shorter questions, scaffolds — the
ladder already exists). The user's explicit setting always wins; the tracker
only suggests.

### 2.5 Per-tier roles after the change

| Component | Cloud | Full local (E2B) | Tiny (1B) |
|---|---|---|---|
| Turn plan | model-driven, scenario suggests | soft prescribed question + topic guard | 100 % data |
| Reaction prose | model, free within level rules | model + template floor | microReaction (20–30 words) |
| Target phrase / chips | model asked to feature it | chips from data | chips from data + deterministic recast |
| Corrections | model JSON | model JSON; empty → tiny-style fix calls | per-sentence fix + local diff |
| Level control | grammar ladder + difficulty guard retry | same + template floor | per-band data packs + word caps |
| Memory | history (1M) + memory rule | history (~10–12 turns, 4k) + **one-line student profile** in system | one-line student profile in system |
| Adaptation | deterministic tracker (shared) | same | same |

The **one-line student profile** (`Student: Valentin, from Ukraine, likes
jogging/reading`) is the bounded version of fact extraction worth keeping:
three regexes, one line, survives the local 4k trim and the scenario
rotation. No machinery beyond that.

### 2.6 Sequencing

1. **Level engine**: C1/Native in the UI, grammar ladder + frequency
   windows in grounding, difficulty guard + simplify-retry. (Biggest win,
   benefits every tier, fixes the B1/B2 placebo.)
2. **Phrase book**: target phrase per turn, recast rule, taught-phrase →
   flashcards wiring.
3. **Adaptation tracker** + level-up suggestions.
4. **Scenario packs** for A2/B1 (authored content; corrections coverage for
   E2B via the tiny-style fallback lands here too).
5. Tiny-tier per-band reaction templates (polish, last).
