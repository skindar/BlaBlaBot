# A Browser Tab as a Language-Tutor Server: a WebLLM Field Benchmark

*Draft. All numbers below come from the in-app Bench tab on one machine —
reproduce them yourself at the end of the article. Raw export:
`docs/bench-results-2026-11-03.md`.*

---

Earlier this year I ran a Snapdragon 8s Gen 4 phone as an LLM server and logged
everything: decode speed, prefill walls, memory math, failures. This time there
is no phone, no Termux, no server at all. The question changed shape: **what
can a plain browser tab actually do as an inference box** — not on a synthetic
chat benchmark, but inside a real application that people open like any other
web page?

The application is BlaBlaBot, a voice language tutor that runs entirely in the
browser: WebLLM for the tutor LLM, whisper through transformers.js for speech
recognition, Phonon TTS compiled to WebAssembly for the voice, all weights
cached by the browser. You host it as static files. No backend, no API keys.

This is a benchmark log of that app: what the models cost, what they deliver,
where they fall apart, and what that means for building on small in-browser
models.

## The workload (why this is harder than a chat bench)

A synthetic benchmark asks a model to complete text. BlaBlaBot asks it to be a
component. Every user turn fires **two LLM calls**:

1. **Tutor call** — answer the student in the target language AND return
   strict JSON: `{reply, corrections[], suggestions[]}`, with corrections
   quoted verbatim from the student's message and explanations in the
   student's UI language. ~500-token system prompt, growing dialog history.
2. **Translation call** — a second, smaller request with a trivial schema:
   `{"user": "...", "reply": "..."}`.

Then a WASM speech model streams audio, an ONNX whisper transcribes the mic,
and an energy VAD gates silence. The LLM numbers below come from the real
prompts of the real app — the same code path a user triggers by talking.

That "two calls, one strict schema" shape is the interesting part. It is what
most real LLM applications look like. And it is exactly where small models
break — in a measurable, quantifiable way.

## Setup

- **Machine:** MacBook (Apple silicon, 16 GB unified memory), GPU adapter
  reports `apple / metal-3`
- **Browser:** Chromium 152 (Electron 44) — WebGPU stable
- **Stack:** web-llm 0.2.87, @huggingface/transformers 4.3.2 (whisper-base),
  phonon-tts 0.6.0 (WASM, WebGPU device)
- **Models (all q4f16_1-MLC, the WebLLM prebuilt builds):**

| Model | Tab memory (web-llm `vram_required_MB`) | Download |
|---|---|---|
| Qwen3-0.6B | ~0.8 GB | ~0.5 GB |
| gemma3-1b | ~0.7 GB | ~0.7 GB |
| Qwen3-1.7B | ~2.0 GB | ~1.0 GB |
| gemma-4-E2B | ~3.4 GB | ~2.6 GB |

The benchmark script: 8 fixed student sentences (A1→B1 German, deliberate
grammar traps), tutor + translation call per sentence, 2 dictionary lookups at
the end, temperature 0 for reproducibility. History accumulates across the 8
turns exactly like a real session, so prompt tokens grow turn by turn.

## The cold-start trap

The first visitor pays in gigabytes. Qwen3-1.7B is ~1.0 GB of weights; add
whisper-base (~80 MB) and the Phonon voice model (~75 MB). First load of the
full stack on a fast line:

| Load | Time | Files from |
|---|---|---|
| gemma-4-E2B | **66.6 s** | network (~2.6 GB, ≈40 MB/s sustained) |
| gemma3-1b | 20.4 s | network |
| Qwen3-0.6B | 13.3 s | network |
| Qwen3-1.7B (warm) | 3.3 s | browser Cache API |
| whisper-base (warm) | 1.4 s | cache |
| phonon-de (warm) | 1.3 s | cache |

The Cache API is the whole game: after the first visit everything loads from
disk in seconds and the app works offline. A "no-install" app that costs a
1-gigabyte tax once — distribute the tax across models, load the small ones
first, and the app is talking within seconds while the big model still
downloads.

## The numbers

Tutor stage, temperature 0, n=8 turns per model:

| Model | Decode tok/s | TTFT ms | wall ms/turn | Strict JSON ok |
|---|---|---|---|---|
| Qwen3-0.6B | **49.9** | 630 | 5738 | **0%** |
| Qwen3-1.7B | 36.5 | 1341 | 2875 | 25% |
| gemma3-1b | 27.6 | 963 | 2244 | 13% |
| gemma-4-E2B | 12.9 | 3624 | 11486 | 38% |

Three things jump out.

**Decode speed is not the bottleneck — compliance is.** The 0.6B model decodes
at ~50 tok/s, the fastest of the pack, and turns in the *slowest* walls (5.7 s
per turn) because it never stops: 137–170 tokens per answer, most of it
rambling that the JSON parser then has to throw away. The 1.7B model answers
in 2.9 s at 36.5 tok/s. Raw tok/s says nothing about useful tokens per second;
wall time per structured answer says everything.

**TTFT scales with prompt and model size, and context growth is visible.**
Same model, same script, history accumulating:

| Turn | prompt tokens | TTFT ms | wall ms |
|---|---|---|---|
| 1 | 461 | 2018* | 4679 |
| 4 | 616 | 755 | 2098 |
| 8 | 846 | 1056 | 2354 |

\* first turn includes shader compilation.

Prefill cost grows linearly with the conversation — the same "the bottleneck
has moved to prefill" conclusion I hit on the phone. An in-tab tutor should
cap history aggressively (we keep 10 messages); a long-context tab app is an
oxymoron on this stack today.

**The 4B-class model is not a tutor in a tab.** gemma-4-E2B loads (3.4 GB of
the tab's memory budget on a 16 GB machine — it fits), answers with the best
JSON rate (38%) — and takes 11.5 s per turn at 12.9 tok/s. For comparison, the
same model family runs at roughly 3× that speed through native MLX on the
same silicon. WebGPU gives you portability; you pay for it in prefill and
decode.

## Strict JSON is where small models fall apart

The same models, same temperature, same turn — but the *translation* call with
its trivial two-key schema:

| Model | Tutor schema ok | Translation schema ok |
|---|---|---|
| Qwen3-0.6B | 0% | 12% |
| gemma3-1b | 13% | **88%** |
| Qwen3-1.7B | 25% | **75%** |
| gemma-4-E2B | 38% | **100%** |

gemma3-1b goes from 13% to 88% compliance when the output contract shrinks.
Same weights, same prompt language, same tab. **The model does not follow your
format; it follows formats it can hold in its head.** If your schema has three
nested arrays with verbatim quoting rules, a 1B model will fail it most of the
time — and will happily nail `{"user": ..., "reply": ...}`.

And the failures are spectacular. Here is Qwen3-0.6B, temperature 0, answering
a perfectly normal A2 sentence:

```
<think>

```json
{
  "reply": "Danach hast du genug Kaffee getrunken? ...",
  "corrections": [{"original": "Gestern habe ich einen Film gesehen ...",
  "suggestions": [{"text": "du hast heute Film gesehen und danach Kaf…
```

The model puts its answer *inside the think block*, never closes the object,
and hits the token ceiling. Strip `<think>` and nothing remains.

This is why BlaBlaBot's parser is three layers deep (strict JSON → brace
balancing and quote repair → regex field extraction → plain-text apology), and
why the app — not the model — owns the tutoring methodology: scenarios,
progression, and success tracking are deterministic code. **The model is the
actor; the app is the methodologist.** A 1.7B actor inside a rigid structure
delivers a usable tutor. The same model asked to freestyle a lesson plan does
not.

One more honest wrinkle: temperature 0 is not automatically better for
compliance — anecdotally the same 1.7B produced clean JSON at both 0 and 0.7
on the same sentence, and the /no_think soft switch leaves an empty
`<think></think>` shell in the output that the parser must strip. Determinism
does not buy you correctness on small models; the parser does.

## The full round trip, web vs native MLX

The same app exists as a native macOS version (MLX, Qwen3-4B, whisper-turbo,
Phonon via Ollama). Ballpark of one user turn, text path, on the same class of
machine:

| Stage | Native (MLX) | Browser tab (WebLLM) |
|---|---|---|
| LLM tutor reply | ~1.5–6 s (4B, ~18–40 tok/s) | 2.9 s (1.7B) / 11.5 s (E2B) |
| Translation call | separate ~1 s | 1.8 s |
| TTS to first sound | ~0.9 s (Phonon via Ollama) | **0.08 s** (Phonon WASM, streaming) |
| Full turn | ~3–5 s | ~5.6 s measured |

The surprising entry: the WASM Phonon streams its first audio chunk in ~80 ms
— faster than the native path through Ollama's HTTP API, because there is no
HTTP, no server, no process boundary. Speech synthesis in a worker with
WebGPU generation beats a localhost round-trip.

## The failure log, in order

In the spirit of the phone article, everything that broke on the way:

1. **Vite's default worker format is `iife`** — phonon-tts ships a module
   worker with dynamic imports; the build fails with "UMD and IIFE output
   formats are not supported for code-splitting builds". Fix: `worker:
   { format: 'es' }`.
2. **Vite's dependency prebundler breaks the worker URL** — in dev,
   `optimizeDeps` rewrites `new URL('./worker.js', import.meta.url)` so it
   points inside the prebundled chunk that doesn't exist. The worker dies with
   "could not start". Fix: `optimizeDeps: { exclude: ['phonon-tts'] }`.
3. **`enable_thinking: false` does not reliably stop Qwen3 thinking** in
   web-llm 0.2.87 — the flag is accepted, `<think>` arrives anyway, eating
   your token budget (one 26-second "translation" was mostly think-block).
   Fix: append `/no_think` to the system prompt (as the native MLX version
   always did) AND strip think blocks in the parser. Belt and suspenders.
4. **The good TTS models are gated on Hugging Face** — a visitor's browser
   cannot download gradium/phonon-40m-de without a token. Fix: host the files
   yourself as GitHub Release assets (script included in the repo) and point
   the app at the URL; the browser caches them after the first load.
5. **WebGPU is still a Chrome-world** — Firefox (most platforms) and older
   Safari don't have it; WebLLM has no CPU fallback. The app detects and says
   so; whisper does fall back to WASM and merely gets slow.

## Conclusions

- **A tab is a real inference box for ≤2B models.** 1.7B q4 at ~36 tok/s with
  ~1.3 s TTFT sustains a conversational tutor with two calls per turn inside
  ~5.6 s end-to-end, offline, for anyone who can open a link.
- **4B is the ceiling, and it's not a comfortable one.** 3.4 GB of tab memory,
  12.9 tok/s, 11.5 s per structured answer. Possible ≠ pleasant.
- **Benchmark wall-per-structured-answer, not tokens per second.** The
  fastest-decoding model in the test was the least usable one.
- **Schema size is the real difficulty scale for small models.** 13% → 88%
  compliance from the same weights by shrinking the output contract. Design
  your calls accordingly: one tiny schema per call beats one clever schema.
- **Own the methodology in code.** Roles, scenarios, correction filters,
  progress tracking — deterministic. Let the model act, not plan.
- **Streaming WASM TTS is a quiet superpower**: first audio in ~80 ms beats
  the native server route.

Use cases that fit a tab today: tutors, drill partners, form-fillers,
translators, structured extraction with tolerant parsing — anything with
short prompts, short answers, and an app-shaped spine. Not long-context
reasoning, not open-ended B2 conversation.

## Reproduce it yourself

The benchmark is a button in the app: open the **Bench** tab, tick the models,
press *Run benchmark*. It loads each model, runs the fixed 8-turn script
through the production prompts, and records TTFT / decode tok/s / token
counts / JSON parse outcomes for every call. *Copy Markdown* produces the
tables above; *Copy JSON* the raw log. Same hardware, same browser — your
numbers will differ; that is rather the point.

---

*BlaBlaBot is a static web app: WebLLM for the tutor, transformers.js for
whisper, phonon-tts for the voice, everything cached and offline after first
load. Weights under their own licenses (Qwen Apache-2.0, Gemma Gemma Terms,
Phonon CC BY-NC 4.0).*
