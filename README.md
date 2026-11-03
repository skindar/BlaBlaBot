# BlaBlaBot — browser-based voice language tutor (no server)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Deploy](https://github.com/skindar/BlaBlaBot/actions/workflows/deploy.yml/badge.svg)](https://github.com/skindar/BlaBlaBot/actions/workflows/deploy.yml)

The same tutor experience as the native version (`../backend` + `../frontend`),
but **all ML runs inside the browser tab** — no Python server, no ffmpeg, no
Ollama. After the first download the models are cached by the browser
(Cache API) and the app works offline.

> The native MLX version is untouched: this directory is fully standalone,
> `../backend` and `../frontend` keep working as before.

## Stack

| Layer | Native version | Browser version |
|---|---|---|
| Tutor LLM | mlx-lm Qwen3-4B | **WebLLM** (`@mlc-ai/web-llm`) Gemma-3-1B-IT q4f16 (default), switchable in settings |
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

Target languages to learn: German, English, French, Spanish, Portuguese —
all five work out of the box (per-language TTS models/voices, per-language
history and vocabulary, per-language prompts; Whisper covers all five).
The offline dictionary is German→Russian only and loads as a lazy 2.2 MB
chunk on first use. UI language: Russian / English.

**Diary mode** (sidebar switch): the tutor becomes a supportive listener —
short reactions and listening questions only ("Und was war dann?"), never
correcting aloud, never changing the topic. Every line the student says is
logged to the Diary tab verbatim, with the UI-language translation and the
corrected version when there were grammar mistakes. See
`docs/tutor-methodology.md` for the conversation-tutor methodology.

## Google Drive sync (cards, chats, diary, activity calendar)

No server: Google Identity Services' implicit token flow + the Drive v3 REST
API with the narrow `drive.file` scope — the app can only see the files it
created itself. Every visitor signs in with **their own** Google account and
their data lands in **their own** Drive. Files are human-readable:
`cards.csv` (opens in Google Sheets), `diary.md`, `chat-<lang>.md`,
`activity.csv` — one OAuth client serves all users.

### One-time setup for the app owner

1. In [Google Cloud Console](https://console.cloud.google.com) create a
   project → *APIs & Services → OAuth consent screen*: **External**, app
   name "BlaBlaBot", add the `.../auth/drive.file` scope, then **Publish to
   production** (test mode caps users at 100; `drive.file` needs no
   verification badge).
2. *Credentials → Create credentials → OAuth client ID*, type
   **Web application**. Under *Authorized JavaScript origins* add both:
   - `http://localhost:5173` (local dev)
   - `https://<owner>.github.io` and/or your custom domain (GitHub Pages)
3. Put the Client ID into the build: copy `.env.example` to `.env` and set
   `VITE_GOOGLE_CLIENT_ID=...`. No client secret — the token flow is
   fully client-side.
4. Deploy. Any Gmail user can now press "Sign in with Google": the browser
   shows Google's consent, the app gets a `drive.file`-scoped token, and
   reads/writes only in that user's own `BlaBlaBot` folder. The Client ID
   is baked into the build — there is nothing to configure in the app.

### How sync behaves

With auto-sync on, every chat turn, flashcard change, diary entry and
activity bump is uploaded (debounced 2.5 s); on sign-in the app pulls the
Drive state and merges (vocabulary: union by uid, last-write-wins; diary:
union by uid; chat: the newer tail wins; activity: per-date maximum).
The access token lives in sessionStorage only. Old JSON-format files
(`vocab.json`, `history-<lang>.json`, `diary.json`) are still read once and
upgraded to the readable formats.

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

**First run:** the app downloads whisper-base (~80 MB), Gemma-3-1B-IT (~0.7 GB)
and the Phonon model (~75 MB) automatically; progress is visible in the model
status. Afterwards everything loads from the cache — no network needed.

## Speech: Phonon models and system voices

Two engines in the settings:

- **Phonon** — the same models the native version uses via Ollama, through the
  official [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) package
  (WASM/WebGPU, streaming 24 kHz, ~50–100 ms to first sound). Per target
  language:
  - **German** — phonon-40m-de with 13 voices (Annika, Anton, Henrik, Jette,
    Josefine, Jule, Leon, Lotta, Mats, Mika, Mirko, Nele, Svea). The model is
    self-hosted (local `public/models/` in dev, a GitHub Release in prod —
    see below). If the configured URL is unreachable, the app automatically
    falls back to the multilingual model with the same voices.
  - **English** — the public phonon-31m-en (Apache 2.0) + the
    gradium/phonon-voices catalog (25 voices).
  - **French/Spanish/Portuguese** — the public mirror of
    phonon-40m-multilingual (en/fr/de/es/pt) + the per-language catalog
    voices (fr 15, es 25, pt 12). The per-language gradium models are gated
    on HF, so they load only from a URL you host yourself (see below).
  All files come from public HF repos pinned to a commit; the voice catalog
  (gradium/phonon-voices, Apache 2.0) is one flat `voices/<id>.safetensors`
  set compatible with every model size. Only the selected voice is
  prefetched (~250 KB); the rest of the language's catalog loads on first
  use and is cached.
- **System voice** — the browser's speechSynthesis (0 MB). If no voice exists
  for the target language, the app reports it honestly instead of reading the
  text in the wrong language.

### Where the Phonon model files come from

The default bases cover every language without any setup: English loads
`gradium/phonon-31m-en` from HF directly, French/Spanish/Portuguese load the
public multilingual mirror (`empyrealworks/Phonon-40M-multilingual`, a
byte-for-byte copy of the gated gradium/phonon-40m-multilingual — weights
CC BY-NC 4.0), and German first tries its configured URL. A self-hosted
per-language model (better quality than the multilingual one) still works:
set the "Phonon model URL" in the settings to

- locally for dev: `/models/phonon-40m-de/` (default; files in
  `web/public/models/`, git-ignored);
- **GitHub Release** (for Pages hosting):
  `https://github.com/<owner>/<repo>/releases/download/<tag>/` — upload the
  files once as release assets with
  `./scripts/publish-phonon.sh owner/repo phonon-40m-de-v1`;
- any public (non-gated) HF repo: `hf://owner/repo`.

If the URL is unreachable, the app falls back to the multilingual model with
the language's catalog voices instead of failing. Files are cached in the
Cache API — no network on subsequent runs. The 40m weights are
CC BY-NC 4.0 (non-commercial); credit the source when redistributing.

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
- Curated model list (small → large): Gemma-3-1B-IT 🌐 (default),
  Llama-3.2-1B-Instruct, Qwen2.5-1.5B-Instruct, Gemma-4 E2B.
  The 1B models run the tiny-tier pipeline (2-key tutor schema + separate
  corrections/translation/suggestions calls).

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

## License

The application code is [MIT-licensed](./LICENSE). Two exceptions inside the
repository: `src/data/deu-rus.json` is derived from the
[FreeDict](https://freedict.org/) deu-rus dictionary (GPL-2.0+/CC BY-SA, see
LICENSE), and the repository ships no model weights — the LLM/ASR/TTS models
are downloaded by the visitor's browser and governed by their own licenses
(Gemma Terms of Use, Apache-2.0, CC BY-NC 4.0 — see the notes in LICENSE and
the Phonon section above).
