# BlaBlaBot — browser-based voice language tutor (no server)

The same tutor experience as the native version (`../backend` + `../frontend`),
but **all ML runs inside the browser tab** — no Python server, no ffmpeg, no
Ollama. After the first download the models are cached by the browser
(Cache API) and the app works offline.

> The native MLX version is untouched: this directory is fully standalone,
> `../backend` and `../frontend` keep working as before.

## Stack

| Layer | Native version | Browser version |
|---|---|---|
| Tutor LLM | mlx-lm Qwen3-4B | **WebLLM** (`@mlc-ai/web-llm`) Qwen3-1.7B q4f16 (default), switchable in settings |
| ASR | mlx-whisper large-v3-turbo | **transformers.js** (`@huggingface/transformers`) whisper tiny/base/small, WebGPU (WASM fallback) |
| TTS | Ollama Phonon | **phonon-tts** (official WASM port of the same gradium Phonon models, q8 ~75 MB, WebGPU/CPU, streaming) + system voices as a fallback |
| Translation | second LLM call | same: second LLM call (temp 0.2) + UI-language checks |
| History/vocab | SQLite | localStorage (`gt-web-*`) + offline deu-rus dictionary (26k words, bundled) |

The backend logic is ported 1:1: the robust JSON reply parser
(`src/lib/parse.ts` ← `backend/models/llm.py`), the energy VAD
(`src/lib/audio.ts` ← `backend/models/asr.py`), correction filtering, the
pipeline with per-stage timings (`src/lib/engine.ts` ←
`backend/services/pipeline.py`), fuzzy vocabulary dedup. Qwen3 "thinking" is
disabled with the request flag + `/no_think` (as the native version did);
`<think>` blocks are stripped by the parser regardless.

Target languages to learn: German, English, French, Spanish, Portuguese.
UI language: Russian / English.

## Running

```bash
cd web
npm install
npm run dev          # http://localhost:5174
```

Production build (plain static files — hostable anywhere / GitHub Pages):

```bash
npm run build        # → web/dist/
npm run preview      # local preview of the build
```

**First run:** the app downloads whisper-base (~80 MB), Qwen3-1.7B (~1 GB)
and the Phonon model (~75 MB) automatically; progress is visible in the model
status. Afterwards everything loads from the cache — no network needed.

## Speech: Phonon models and system voices

Two engines in the settings:

- **Phonon** — the same models the native version uses via Ollama, through the
  official [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) package
  (WASM/WebGPU, streaming 24 kHz, ~50–100 ms to first sound).
  German: phonon-40m-de with 13 voices (Annika, Anton, Henrik, Jette,
  Josefine, Jule, Leon, Lotta, Mats, Mika, Mirko, Nele, Svea).
  English: the public phonon-31m-en (Apache 2.0) + the gradium/phonon-voices
  catalog. French/Spanish/Portuguese: phonon-40m-XX (gated on HF).
- **System voice** — the browser's speechSynthesis (0 MB). If no voice exists
  for the target language, the app reports it honestly instead of reading the
  text in the wrong language.

### Where the Phonon model files come from

The HF repos are **gated**, so a visitor's browser cannot download them
directly, and the model is not stored in git either. Instead the app fetches
the files from a configurable URL ("Phonon model URL" in the settings):

- locally for dev: `/models/phonon-40m-de/` (default; files in
  `web/public/models/`, git-ignored);
- **GitHub Release** (for Pages hosting):
  `https://github.com/<owner>/<repo>/releases/download/<tag>/` — upload the
  files once as release assets with
  `./scripts/publish-phonon.sh owner/repo phonon-40m-de-v1`;
- a public (non-gated) HF mirror: `hf://owner/repo`.

Files are cached in the Cache API — no network on subsequent runs.
The German weights are CC BY-NC 4.0 (non-commercial); credit the source when
redistributing.

## Hosting on GitHub Pages

```bash
cd web
npm run build                            # static site in web/dist
./scripts/publish-phonon.sh owner/repo   # TTS model files → release assets
```

Then: Settings → Pages → deploy the branch/folder containing `dist` (or a
GitHub Action with `actions/upload-pages-artifact`). After deploy, set the
model URL in the app to
`https://github.com/<owner>/<repo>/releases/download/phonon-40m-de-v1/`.
LLM/ASR models download from Hugging Face on their own (not gated).

## e2e measurements (Mac, Electron/Chromium 152, WebGPU)

Chip-suggested turn (text path, no ASR): LLM 3.8 s · translation 1.8 s ·
TTS (Phonon, to first sound) 81 ms · total 5.6 s.
Phonon directly: Annika — 53 ms to first sound, Henrik — 72 ms.
The microphone path is identical to the native version (the VAD drops
silence — verified).

## Differences from the native version

- "Replay" speaks the text with the selected TTS engine (no wav files).
- Model picker includes a live download progress per model; sizes come from
  webllm's `vram_required_MB` (the honest tab-memory cost).
- One LLM in memory; switching reloads it (first switch also downloads).
- Known quirk of Qwen3-1.7B: occasional junk characters in chip translations
  (model-level); Qwen3-4B or Gemma-4 E2B in the picker are noticeably cleaner.

## Structure

```
web/
├── src/
│   ├── App.tsx               UI orchestration (adapted from frontend/src/App.tsx)
│   ├── i18n.tsx              RU/EN string catalog + React context
│   ├── components/           UI components (sidebar, settings modal, onboarding, chat, flashcards)
│   ├── hooks/useRecorder.ts  push-to-talk → webm Blob
│   ├── hooks/useEngine.ts    model lifecycle → HealthInfo + progress
│   ├── prompts.ts            prompts ported from backend/prompts + backend/models/llm.py
│   ├── lib/parse.ts          robust JSON parser + correction filter (port)
│   ├── lib/audio.ts          decodeAudioData → 16 kHz + energy VAD (port of asr.py)
│   ├── lib/asr.ts            transformers.js whisper (WebGPU→WASM fallback)
│   ├── lib/llm.ts            WebLLM: model load/switch, /no_think
│   ├── lib/langs.ts          per-target-language config (models, voices, codes)
│   ├── lib/tts.ts            system voices: picking, speak()
│   ├── lib/ttsPhonon.ts      Phonon via phonon-tts: streaming playback, voices
│   ├── lib/store.ts          localStorage: history, vocabulary, deu-rus dictionary
│   ├── lib/engine.ts         pipeline port: timings, errors, serial lock
│   └── data/deu-rus.json     copy of backend/data/deu-rus.json
└── dist/                     production build (npm run build)
```
