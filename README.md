# BlaBlaBot 2 — browser-native language tutor

A clean-architecture rewrite of the original BlaBlaBot prototype. Everything runs inside the browser
tab: the tutor LLM (WebLLM / WebGPU), speech recognition (transformers.js
Whisper), speech synthesis (Phonon / Piper / system voices), history,
flashcards, diary and optional Google Drive sync. There is **no application
server**.

## Quick start

```bash
git clone https://github.com/skindar/BlaBlaBot.git
cd BlaBlaBot
npm install
npm run dev        # http://localhost:5175
npm run test       # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # production build into dist/
```

The first run downloads the selected WebLLM model (~0.7–1.5 GB depending on
the choice), Whisper weights and the TTS model; the browser caches them.
Piper's runtime assets are served in dev from `node_modules` with the correct
`application/wasm` MIME and are copied into `dist/` by the build.
WebGPU (Chrome/Edge on a recent OS) is required for the local LLM; the app
shows an honest error instead of pretending to work without it.

### Google Drive sync (optional)

Copy `.env.example` to `.env` and set `VITE_GOOGLE_CLIENT_ID` to an OAuth
client ID of type *Web application* with the `drive.file` scope. Without it
the app works fully offline, locally; the sign-in button is simply disabled.

## Architecture

Dependencies point inwards. The presentation never imports an adapter; the
application never imports a browser API or WebLLM.

```
src/
├── domain/                 # framework-free model + deterministic policy
│   ├── models.ts           # entities, value types, LLM boundary types
│   └── policies/           # pure logic, heavily unit-tested
│       ├── languages.ts    # per-language constants, voices, prompts metadata
│       ├── prompts.ts      # prompt builders
│       ├── parse.ts        # robust JSON parser for small models
│       ├── translation.ts  # translation/suggestion quality gates
│       ├── tutor.ts        # scenario turn composition, polishing
│       ├── scenarios.ts    # curated scenario bank + session progression
│       ├── corrections.ts  # sentence fix → local word diff
│       ├── audio.ts        # PCM decode + energy VAD
│       ├── asrText.ts      # Whisper loop/hallucination filters
│       ├── words.ts        # article-aware word identity
│       ├── piperVoices.ts  # static voice catalog (offline picker)
│       └── settings.ts     # defaults + resolved voice/model selection
├── application/            # use cases over ports
│   ├── ports.ts            # BrainPort, AsrPort, SpeechPort, repositories…
│   ├── errors.ts           # typed error taxonomy for the UI
│   ├── telemetry.ts        # benchmark types + DiagnosticsPort
│   ├── support/            # EventBus, Observable
│   └── services/
│       ├── TurnService.ts  # audio → VAD → ASR → tutor → translation → TTS → history
│       ├── VocabularyService.ts
│       ├── DiaryService.ts
│       ├── ModelManager.ts # model lifecycle + HealthInfo
│       ├── SettingsService.ts
│       └── SyncService.ts  # Drive pull → merge → push, debounced auto-push
├── infrastructure/         # adapters implementing the ports
│   ├── llm/                # WebLLM engine, cloud OpenAI-compatible client, router, catalog
│   ├── asr/                # transformers.js Whisper
│   ├── tts/                # Phonon, Piper, speechSynthesis, router
│   ├── storage/            # localStorage repositories (schema v2)
│   ├── drive/              # Google Identity Services + Drive v3, CSV/Markdown formats
│   ├── dictionary/         # lazy deu-rus offline dictionary
│   └── telemetry/          # benchmark recorder
├── presentation/           # React UI only
│   ├── context.tsx         # composition-root context + subscription hooks
│   ├── ChatApp.tsx         # screen composition
│   ├── hooks/              # chat session, recorder, sidebar stats
│   ├── components/         # ported design
│   ├── ui/design.tsx
│   └── i18n.tsx            # React provider over shared strings
├── shared/                 # framework-free RU/EN string catalog
└── bootstrap/container.ts  # the only place concrete adapters are wired
```

### Design decisions

- **Ports & adapters.** WebLLM, Whisper, Phonon/Piper and Google Drive are
  swappable; the pipeline is tested with fakes in Node, no browser needed.
- **One serial turn queue** in `TurnService` preserves the native server's
  `gpu_lock` behaviour without a server.
- **Deterministic core.** Scenario questions, chips, correction filtering and
  translation sanity checks are local policy; the LLM only upgrades phrasing.
  This keeps 1B models usable and makes the behaviour testable.
- **Small, honest errors.** `EmptyAudioError` (silence/hallucination) is a calm
  notice; model errors are red, typed and actionable.
- **Clean storage schema v2** under `blablabot2:*`. This is a clean-start
  rewrite: it deliberately does **not** read the old `web/` keys. Google Drive
  files stay human-readable (`cards.csv`, `diary.md`, `chat-<lang>.md`,
  `activity.csv`).
- **Observable services, not global mutable singletons.** React subscribes to
  `SettingsService`, `ModelManager` and `SyncService` through the context.

## Tests

```bash
npm run test
npm run test:coverage
```

Covered by unit tests (158 tests):

- reply/translation/vocabulary/suggestion JSON parsing, including repaired
  and plain-text fallbacks;
- correction filtering and sentence-level word diffs;
- translation sanity gates, question/number preservation, yes/no rescue;
- ASR repetition loops and Whisper hallucination filters;
- scenario selection/progression and reply polishing;
- energy VAD, silence trimming and splitting;
- article-aware vocabulary dedup, conversation history, diary, activity,
  settings and session repositories;
- settings validation/persistence;
- sync merge strategies (vocab last-write-wins, diary union, chat tail,
  activity per-day maximum);
- the full turn pipeline with fake brain/ASR/speech/repositories, including
  serialization and diary mode;
- model manager lifecycle (local load, cloud shortcut, no-op settings changes,
  load failures) and vocabulary lookup.

The WebLLM download/inference path is adapter code and is verified manually in
the browser (see “Verification” below), not in Node.

## How a tutor turn is built

The deterministic layer owns the lesson; the LLM only writes short reactions.

1. **Topic.** `settings.topics[lang]` (the right panel's topic picker) wins;
   otherwise the free-text `extraPrompt` is matched against scenario keywords;
   otherwise the level default (`A1`/`A2`) scenario is used. Changing the topic
   resets the conversation; the chosen topic id is sticky per language.
2. **Session.** Persisted per language (`blablabot2:session:<lang>`):
   `scenarioId`, `nextIndex`, `topicKey`, `stayCount`, `lastQuestion`. A new
   dialog or an empty history starts a fresh session at turn 0.
3. **History.** `blablabot2:messages:<lang>` stores the dialog. The full-tier
   prompt gets the last 50 messages and then drops the oldest pairs until the
   model's context budget fits. **The tiny tier does not put the dialog into
   the model at all** — it only passes the current answer, the previous
   question, the correction and the persona facts.
4. **Routing (tiny tier, ≤1B).**
   - greeting / introduction / farewell → deterministic templates;
   - a real question to the tutor (`?` or a wh-word in the first three words)
     → answer from the closed persona-fact bank and re-ask;
   - an answer (even one ending with "а ты?") → relevance check against the
     scenario question, scaffold, chips and vocabulary (4-char content stems);
     relevant answers advance, unrelated ones stay and re-ask (max 2 stays);
   - an explicit "let's talk about something else" → rotate to the next
     scenario.
5. **Reply.** Tiny tier: one validated model reaction (or curated floor) + the
   prescribed scenario question, polished to exactly one question and a word
   limit. Full tier: one strict-JSON model reply, with the prescribed question
   appended only when the model asked nothing; English/wrong-script drift falls
   back to the template floor. Chips come from scenario data (LLM only when
   empty).
6. **Validation.** Reactions are rejected when they contain a question, English
   drift, a wrong script (e.g. Vietnamese `khác` inside a Russian lesson), a
   slash menu or a decoder loop (one token repeated ≥35%).
7. **Memory.** The LLM is stateless. Persisted memory = dialog history + the
   scenario session + persona facts. There is no summarization; "New dialog"
   and language switches use separate histories/sessions. The `MEMORY RULE`
   prompt text asks the full-tier model not to re-ask answered questions, but
   a 1B model frequently ignores it — which is why the tiny tier uses the
   deterministic scaffold instead.

Known limitation: repeating an answer that belongs to a *previous* scenario
question while the tutor already moved on is treated as off-topic and re-asked;
the relevance gate is stem-based, not semantic.

## Stop semantics

The mic button is a real Stop control while the app is busy:

- during recording, one tap finishes the take: if the live meter confirmed
  speech it is sent, silence is discarded (hands-free auto-send still happens
  after the silence pause);
- during processing or playback, the button shows **Стоп** and is enabled;
- there Stop invalidates the pending turn (late ASR/LLM/TTS results are
  ignored), cancels audio and pauses the hands-free loop until the user starts
  again; already displayed answers are not removed.

A turn generation counter in `useChatSession` prevents a late reply from being
appended or spoken after Stop; `manualStopRef` prevents MediaRecorder's late
`onstop` and the hands-free auto-start effect from reopening the mic.

## Speech recognition

Two engines are available in Settings:

- **Whisper** (tiny/base/small) — local ONNX Runtime Web, private/offline; the
  default remains `base`.
- **System (Web Speech API)** — zero model download and instant recognition,
  but Chrome/Edge usually use a cloud service and Firefox has no support. The
  app runs the recorder in parallel for VAD, submits the live transcript, and
  skips the Whisper download entirely.

Research on Russian browser ASR — Vosk, GigaAM v3, T-one, Parakeet and why
Whisper small is the easiest accuracy upgrade — is in
[docs/ASR_RESEARCH.md](docs/ASR_RESEARCH.md).

## Tutor controller and hybrid phase

The tutor is now split into three layers:

1. **Content** — scenario packs live in
   [scenarios.json](src/domain/policies/scenarios.json) (external JSON,
   validated by unit tests), not in the TS control flow.
2. **Controller** — [scenarioSpec.ts](src/domain/policies/scenarioSpec.ts)
   turns a scenario into a `ScenarioSpec` and decides the phase, the prescribed
   question, the answer chips and the next session state. The model only
   phrases the reply; it cannot choose the next lesson step.
3. **Hybrid phase** — after the last guided step the full-tier tutor keeps the
   topic but drops the prescribed question: the model may ask its own
   follow-up while the JSON reply/corrections/suggestions contract and
   language/safety checks stay in force. Tiny models stay on the guided
   scaffold (free-form 1.5B chat is not reliable enough).

The tutor prompt also takes the selected voice name (`Ирина`, `Денис`,
`Annika`), so the persona is no longer hardcoded to Anna. Tiny-tier persona
facts still come from `TUTOR_PERSONA`; migrating those to the same DSL is the
next step.

## Chats and archives

`New conversation` never deletes the open chat: `LocalConversationRepository.reset()`
moves it to `blablabot2:archives` first, then clears the active messages. The
sidebar lists the current chat plus archived chats of the selected language
(title = first user line, newest first). Clicking an archived chat archives the
current one and opens the selected chat; the archive list is local-only (Drive
sync still covers the active chat). Hovering a chat row reveals an **×** button
on the right; it deletes that chat after a confirmation (deleting the current
chat clears it).

## Cloud brain: StepFun and reasoning models

`Settings → LLM → Cloud brain` works with any OpenAI-compatible endpoint, but
there are two provider traps:

- **Provider profiles.** `Settings → Cloud brain` offers built-in StepFun /
  Z.AI / OpenRouter profiles. A profile contains only `label`, `baseUrl` and
  `model`; the API token stays in the separate password field and is never part
  of a profile. Selecting StepFun fills `https://api.stepfun.ai/v1` +
  `step-3.7-flash`; editing URL/model switches the profile to Custom.
- **CORS.** StepFun (`api.stepfun.ai`) does not send `Access-Control-Allow-Origin`,
  so a browser cannot call it directly (curl works because it is not a browser).
  In dev, `cloudChat` automatically routes a direct `https://api.stepfun.ai/v1`
  base URL through Vite's same-origin proxy `/__cloud/stepfun`; the proxy target
  is overridable with `STEPFUN_PROXY_TARGET`. A static production build needs
  its own CORS proxy (Cloudflare Worker, Vercel function, etc.).
- **Reasoning tokens.** `step-3.7-flash` streams its chain of thought in
  `delta.reasoning` / `reasoning_content`, then the answer in `delta.content`.
  The old 320–900 token caps were fully consumed by reasoning, so `content`
  stayed empty. For StepFun the client now sends `reasoning_effort: "low"` and
  a minimum `max_tokens` of 4096; an empty `content` with `finish_reason=length`
  raises a clear error instead of a silent empty reply.

Verified from the UI through the dev proxy: model ready, a normal greeting
and a joke request both returned content. API tokens are entered in Settings
and stay in the browser; never commit them.

## Russian TTS research

See [docs/RUSSIAN_TTS.md](docs/RUSSIAN_TTS.md) for the browser-first comparison:
system voices (0 MB), MMS-TTS Russian (38 MB q8, easiest add), Kokoro RU
(138 MB q8, best quality/speed but needs a G2P port), eSpeak NG (tiny/robotic),
RHVoice (no WASM build), Silero (PyTorch/≈400 MB ONNX port).

## Free-talk / actor mode

`Settings → Tutor → Conversation mode → Free talk (actor)` turns off the whole
scenario engine: no scripted questions, no chips, no relevance gate. The model
gets the real dialog history and answers as a plain chatbot; `extraPrompt`
becomes the persona. Results from testing the three small models, the prompt
design rationale and links to the prompt-engineering sources are in
[docs/FREE_TALK.md](docs/FREE_TALK.md).

Short version: **Qwen2.5-1.5B is usable free-form; Qwen2.5-3B is also available.
Gemma-3-1B and Llama-3.2-1B are not** — they lose the thread and drift into other scripts.
That is why scenario mode exists. The Qwen sampling defaults now follow its
`generation_config.json` (temperature 0.7, top_p 0.8, repetition_penalty 1.1;
`top_k` is not exposed by WebLLM's chat API). The “How can I help you?” loop was
investigated with a prompt lab; no prompt alone fixes 1.5B, so free talk now uses
a universal friend prompt (the persona name comes from the selected TTS voice:
Ирина/Денис for Piper, Annika/Zoey for Phonon, parsed system voice names) +
a deterministic assistant-offer stripper (with one repair and a fallback). See [docs/FREE_TALK.md](docs/FREE_TALK.md) for
the measurements.

## Voice replay cache

`Listen` no longer re-runs VITS/ONNX for the same line. Piper and Phonon keep
the decoded `AudioBuffer` in a bounded in-memory LRU (32 / 24 clips) keyed by
engine, model/base, voice and whitespace-normalized text; playback rate is
applied at playback time, not baked into the key. A cache hit reports
`firstAudioMs: 0` and skips synthesis. System `speechSynthesis` voices are not
cached (they are OS-local and already instant). The cache is per tab; a reload
clears it, while the model weights stay in the browser Cache API.

**Warm-up.** Piper used to pay voice download + ONNX graph build on the first
spoken line (4–5 s). `SpeechRouter.ensure()` now calls `PiperEngine.warmUp()`
during model loading: it downloads the selected voice, builds the graph and
discards the generated WAV (no AudioContext, no sound). In a browser run with
cached model weights: `tts` load 4.3 s (warm-up included), then the first real
line had `firstAudioMs 447 ms` and a repeat `0 ms` (playback ~3.3 s). A voice
or language switch re-warms the new voice.

## Differences from the original prototype

- The monolithic `lib/engine.ts` (1263 lines) is split into a tested turn
  pipeline and pure policies; `lib/store.ts` is replaced by repositories;
  the whole app state no longer lives in `App.tsx`.
- New storage schema; no legacy key migration.
- `SyncService` is a class with explicit dependencies; no module-level mutable
  sync state.
- UI and features are ported 1:1 (conversation, hands-free mic, flashcards,
  diary with refined pages, settings, Drive sync, benchmark tab).

## Verification

- `npm run typecheck` — clean.
- `npm run test` — 158/158 passing.
- `npm run build` — Vite production build succeeds.
- UI smoke (Playwright, Chromium, 1440×900): onboarding, conversation, cards,
  diary and settings all render; settings persist under `blablabot2:settings`;
  zero page errors.
- Real WebLLM e2e (Playwright, headful Chromium on macOS Metal):
  gemma-3-1b q4f16 downloaded (537 MB) and loaded in ~33 s, a typed German
  turn produced a real tutor reply, its translation, scenario chips, a
  persisted history pair and bench metrics (translation TTFT 174.7 ms,
  decode 49.8 tok/s). No page errors.
- Russian TTS e2e: switching Deutsch → Русский reloads Piper, `tts` becomes
  ready and `synthesis` returns first audio in ~3.8 s. The Piper runtime was
  previously served as `text/html` on a fresh dev server (WebAssembly MIME
  error); dev now serves `/onnx`, `/piper`, `/worker` from node_modules with
  `application/wasm` and an explicit 404 instead of the SPA fallback.
- Qwen 1.5B + Piper: 3 sequential Russian utterances after loading Qwen, and
  the Llama → Qwen hot swap, both synthesize without `Aborted(OOM)` (Piper's
  ONNX runtime is pinned to one wasm thread; multi-thread fallback removed).
- Dialog routing e2e: "answer + а ты?" advances the scenario (nextIndex 1→2),
  a mid-sentence "как" no longer hijacks the turn, a decoder-loop reaction is
  replaced by the curated floor, and "давай поговорим о другом" rotates the
  scenario to Знакомство.
- Not automated: live-microphone transcription (the Whisper tiny model did
  load and warm up) and an audible listen-through of the synthesized voice
  (the synthesis/playback path ran successfully). Both are adapter paths
  shared with the original prototype app.

## License

MIT — see [LICENSE](LICENSE).
