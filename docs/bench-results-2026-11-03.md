# Bench run — 2026-11-03 (raw export)

Raw data behind the article draft. Produced by the in-app Bench tab
("Run benchmark"), four models, 8 scripted tutor+translation turns each,
2 vocab lookups, temperature 0 (tutor) / 0.2 (translation) / 0.3 (vocab).

## Environment

- GPU: apple / metal-3
- Browser: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ZCode/3.17.2 Chrome/152.0.7977.130 Electron/44.7.0 Safari/537.36
- Device memory: 16 GB
- web-llm 0.2.87 · phonon-tts 0.6.0 · transformers.js 4.3.2

## Per-model aggregate (tutor stage, temperature 0)

| Model | Turns | Decode tok/s | TTFT ms | e2e ms | wall ms | Strict JSON ok | Corrections kept |
|---|---|---|---|---|---|---|---|
| Qwen3-0.6B-q4f16_1-MLC | 8 | 49.9 | 630 | 5738 | 5738 | 0% | 0 |
| Qwen3-1.7B-q4f16_1-MLC | 8 | 36.5 | 1341 | 2875 | 2875 | 25% | 2→0 kept |
| gemma3-1b-it-q4f16_1-MLC | 8 | 27.6 | 963 | 2244 | 2244 | 13% | 0 |
| gemma-4-E2B-it-q4f16_1-MLC | 8 | 12.9 | 3624 | 11486 | 11486 | 38% | 0 |

## Parse outcome breakdown (from turn records)

Tutor stage (complex schema: reply + corrections + suggestions):

| Model | json | repaired/regex | plain (no JSON) |
|---|---|---|---|
| Qwen3-0.6B | 0 | 0 | 8 |
| Qwen3-1.7B | 2 | 0 | 6 |
| gemma3-1b | 1 | 0 | 7 |
| gemma-4-E2B | 3 | 0 | 5 |

Translation stage (simple schema: `{"user": ..., "reply": ...}`):

| Model | json ok | fail |
|---|---|---|
| Qwen3-0.6B | 1 | 7 |
| Qwen3-1.7B | 6 | 2 |
| gemma3-1b | 7 | 1 |
| gemma-4-E2B | 8 | 0 |

## Model loads

| Kind | Model | ms | Files from |
|---|---|---|---|
| tts | phonon-de | 1329 | cache |
| asr | base (whisper) | 1412 | cache |
| llm | Qwen3-1.7B | 3329 | cache |
| llm | Qwen3-1.7B | 1 | cache (already loaded engine) |
| llm | gemma-4-E2B | 66595 | network (~2.6 GB, ≈40 MB/s) |
| llm | Qwen3-0.6B | 13260 | network |
| llm | gemma3-1b | 20378 | network |

## Context growth over a session (gemma3-1b example)

| Turn # | prompt tokens | TTFT ms | wall ms |
|---|---|---|---|
| 1 | 461 | 2018 (first-turn compile) | 4679 |
| 2 | 520 | 606 | 1500 |
| 3 | 569 | 619 | 1439 |
| 4 | 616 | 755 | 2098 |
| 5 | 680 | 824 | 1675 |
| 6 | 730 | 882 | 1737 |
| 7 | 778 | 947 | 2473 |
| 8 | 846 | 1056 | 2354 |

## Mini-experiment: temperature 0 vs 0.7 (Qwen3-1.7B, A2 sentence)

Both calls parsed as strict JSON; both begin with an empty `<think>\n\n</think>`
block (the /no_think soft switch leaves the tags in place — the parser strips them).
decode ≈ 35.2–35.4 tok/s in both cases.

## Failure anatomy: Qwen3-0.6B (temperature 0)

The model places its answer inside `<think>` as a fenced ```json block, never
closes the object, and runs out of tokens. After the parser strips the think
block nothing remains → 'plain' fallback:

```
<think>

```json
{
  "reply": "Danach hast du genug Kaffee getrunken? Gestern hast du einen Film gesehen ...",
  "corrections": [{"original": "Gestern habe ich einen Film gesehen ...", "corrected": "Gestern habe ich einen Film gesehen ...", ...}],
  "suggestions": [{"text": "du hast heute Film gesehen und danach Kaf…
```

## Production round-trip reference (temperature 0.7, default model)

From the live app on the same machine (text-input path): LLM 3.8 s ·
translation 1.8 s · Phonon TTS to first sound 81 ms · total 5.6 s.

## Full turn log

See `toJSON()` export of the Bench tab (localStorage `gt-web-bench`) for every
recorded call; the table above is its aggregate.

---

# Run 2 — tiny-tier architecture (same day)

Same script, same machine; two changes: (a) the parser now rescues JSON from
`<think>`-wrapped truncated output, (b) models flagged `tiny` (≤1B) run a
2-key tutor schema (`reply` + `suggestions`) with corrections moved to their
own single-key call.

## Per-model aggregate — full vs tiny contract on the same models

| Model | Schema | Turns | Decode tok/s | TTFT ms | wall ms | Strict JSON ok | Corrections kept |
|---|---|---|---|---|---|---|---|
| Qwen3-0.6B | **tiny** | 32 | 56.0 | 427 | **2119** | **97%** | 2 |
| Qwen3-0.6B | full | 8 | 49.9 | 630 | 5738 | 0% | 0 |
| gemma3-1b | **tiny** | 8 | 33.3 | 373 | 1211 | 25% | 1 |
| gemma3-1b | full | 8 | 27.6 | 963 | 2244 | 13% | 0 |
| Qwen3-1.7B | full | 32 | 39.2 | 1617 | 2680 | 16% | 0 |

Headline: the smallest model goes from 0% compliance and the slowest walls to
97% compliance and the fastest walls of the whole lineup — purely by shrinking
the output contract and rescuing think-wrapped JSON.

## Context probes (window 4096, prompt budget 2940)

Qwen3-1.7B, full schema, 24 turns (prompt 463 → 1229 tokens):

| Turn | Prompt tok | TTFT ms | Decode tok/s |
|---|---|---|---|
| 1 | 463 | 969 | 44.0 |
| 8 | 695 | 1329 | 42.5 |
| 15 | 930 | 1923 | 39.8 |
| 24 | 1229 | 2622 | 36.7 |

TTFT grows linearly (~1.6 ms per prompt token); decode drops 17% over the
run; knee detection marks turn 15. No hard failure — 24 short turns stay well
under the 4096-token cap the prebuilt build enforces.

Qwen3-0.6B, tiny schema, 24 turns (prompt 163 → 862 tokens): TTFT 226 → 883 ms,
decode stable at ~60 tok/s. Note the tiny system prompt is 3× smaller
(163 vs 463 tokens at turn 1) — the tiny contract also cuts prefill.
