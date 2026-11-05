# web2 — BlaBlaBot 2 (browser-native tutor)

## Architecture rules (enforce in review)

- Dependency direction: `domain ← application ← infrastructure → bootstrap`;
  `presentation` may import domain/application + `context.tsx`, never adapters.
- `src/domain` is framework-free and browser-free: no React, no WebLLM, no
  localStorage. It contains entities + deterministic policy only.
- `src/application` talks to ports (`src/application/ports.ts`), never to
  concrete adapters. New adapters implement a port and are wired in
  `src/bootstrap/container.ts`.
- The React tree reads dependencies through `useServices()` in
  `src/presentation/context.tsx`; no module-level singletons.
- UI strings live in `src/shared/i18nStrings.ts`; use `libT()` in non-React
  code and `useI18n()` in components.
- Storage keys are namespaced `blablabot2:*` (schema v2, clean start — do not
  add legacy migration without an explicit decision).
- Every change: `npm run typecheck && npm run test && npm run build`.

## Current context

- Done: full UI port + layered rewrite; 142 unit tests; typecheck/build green.
- Verified e2e in Chromium/Metal WebGPU: gemma-3-1b loads and produces a real
  tutor turn (translation + persisted history + bench metrics); the German →
  Russian switch loads Piper and synthesises speech (first audio ~3.8 s).
- Dev serves /onnx,/piper,/worker from node_modules with `application/wasm`
  (see vite.config.ts) — never copy them into public/ from configureServer.
- Fixed: tiny-tier loop (answer + "а ты?" now advances; mid-sentence wh-words
  are not questions), wrong-script/decoder-loop reactions, topic-change intent,
  and Piper ONNX OOM (single-thread runtime, cancellable playback).
- Added: StepFun dev CORS proxy + reasoning-token handling (low effort, 4096‑token floor, explicit empty-content error).
- Added: free-talk/actor mode (no scenarios, full history, plain text), Qwen
  sampling defaults, a temperature slider and a bounded TTS clip cache.
- Fixed: speech watchdog started before TTS synthesis and could cancel audio
  mid-sentence on a cold Piper line; it now reserves synthesis time.
- Added: Piper voice/ONNX warm-up during model loading (first audio ~447 ms
  instead of ~5.4 s; warm-up discards its WAV and never plays).
- Fixed: free-talk assistant-tone loop (“Как я могу помочь?”) with a Russian
  few-shot prompt + stripAssistantOffers repair/fallback.
- Fixed: Stop during recording now sends a take when the meter detected speech
  and discards silence; during processing/playback it cancels the pending turn.
  The generation token/manual-stop latch prevents late replies and hands-free
  reopen. Already displayed answers are kept.
- Added: B+D tutor rework: external scenario JSON, ScenarioSpec controller
  (guided steps, prescribed question/chips, phase), hybrid free phase after
  the last guided step for full-tier models, voice-name tutor persona.
- Added: universal free-talk prompt with the persona name taken from the
  selected TTS voice (Piper/Phonon/system), tested with Qwen 3B (`Ирина`).
- Added: hover × delete for chats (with confirmation; current chat clears).
- Added: chat archives (New conversation preserves the previous chat), provider
  profiles (URL + model only), and a stop guard that discards recordings with
  no confirmed speech.
- Remaining free-talk gaps: WebLLM 4k cap, top_k not exposed, no summary memory;
  1.5B still repeats questions in free talk (3B is the practical minimum).
- Next: live-mic ASR and an audible listen-through on a device with audio;
  optional ESLint setup; semantic relevance instead of 4-char stems; summary
  memory for long free-talk sessions.
