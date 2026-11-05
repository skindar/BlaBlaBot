# Russian TTS research (browser-first, October 2026)

Goal: another **fast Russian** engine for the browser app, without a server.

## TL;DR

1. **System `speechSynthesis` Russian voices** are the fastest possible option:
   0 MB download, instant start, quality depends on the OS. The app already has
   a system engine; Russian is just hard-routed to Piper today.
2. **MMS-TTS Russian** is the easiest *new local browser* engine: ONNX via
   Transformers.js, **38 MB q8**, 16 kHz. It is a clear add, but it is a
   different voice, not an upgrade over Piper, and the model is CC BY-NC 4.0.
3. **Kokoro RU** is the best quality/speed candidate: 82M params, **138 MB q8**,
   24 kHz, author reports **9.8x realtime on CPU**. It is *not* a drop-in: the
   Russian G2P (RUAccent stress + homographs + eSpeak IPA) lives in Python and
   must be ported to the browser.
4. **Silero** remains unsuitable: official models are PyTorch; the community
   ONNX port needs ~400 MB of models plus a Russian frontend port.
5. **RHVoice** and **eSpeak NG** are tiny/intelligible but robotic; RHVoice has
   no official WASM build, eSpeak NG has one.

## Comparison

| Engine | Browser-ready | Size | Speed | Quality | Russian stress | License |
|---|---|---|---|---|---|---|
| **Piper** (current) | yes, ONNX/CPU wasm | ~63 MB/voice | ~0.45 s first audio after warm-up; cached repeats 0 ms | good | eSpeak phonemizer; voice dependent | voices have their own licenses |
| **System TTS** | yes, `SpeechSynthesis` | 0 MB | instant | OS voice (Milena/Yuri on macOS, etc.) | OS-dependent | OS |
| **MMS-TTS Russian** | yes, Transformers.js | 38 MB q8 / 58 MB fp16 / 114 MB fp32 | Node here: ~1.1–1.5 s per short sentence; 16 kHz | intelligible VITS; likely flatter than Piper/Kokoro | no explicit stress layer | **CC BY-NC 4.0** |
| **Kokoro RU** | ONNX yes; G2P no | 138 MB q8 / 164 MB fp16 / 326 MB fp32 + voices | author: 9.8x realtime CPU; 24 kHz | best candidate; WER 2.50 vs Piper 4.38 in author's 79-word test | RUAccent + eSpeak, high quality | model OpenRAIL; code Apache-2.0; RUAccent MIT |
| **RHVoice** | no official WASM | small HMM voices | fast | intelligible, HMM/robotic | built-in Russian | GPLv2 |
| **eSpeak NG** | yes, npm WASM | few MB | instant | robotic/formant | built-in | GPLv3 |
| **Silero** | no (PyTorch) | ~400 MB ONNX port | fast in Python | good | accentor in model | CC BY-NC 4.0 |

## Details

### MMS-TTS Russian (easiest new local engine)

- `Xenova/mms-tts-rus` is the ONNX/Transformers.js build of
  `facebook/mms-tts-rus`; the model card explicitly shows the
  `pipeline('text-to-speech', ...)` API.
- Files: `model_quantized.onnx` **38.4 MB**, `model_fp16.onnx` 58.1 MB,
  `model.onnx` 114.3 MB; output **16 kHz**, one voice.
- Node benchmark on this Mac (q8): first load 18.2 s including download;
  `Привет! Как дела?` 1.1 s for 2.03 s audio; a 3.06 s sentence 1.48 s.
  Browser WASM/CPU will differ; warm-up is needed just like Piper.
- Pros: fits the existing `@huggingface/transformers` dependency; no new model
  runtime; one more voice; easy fallback.
- Cons: 16 kHz, no explicit Russian stress/homograph layer, CC BY-NC 4.0
  (non-commercial), likely less natural than Piper/Kokoro.

### Kokoro RU (best quality/speed, most work)

- `zaakirio/kokoro-ru`: 82M params, three voices (sveta/masha/dima), ONNX
  layout compatible with `onnx-community/Kokoro-82M-v1.0-ONNX` /
  `kokoro-js` / Transformers.js.
- q8 model 138 MB, fp16 164 MB, fp32 326 MB; 24 kHz. Author reports 9.8x
  realtime on a laptop CPU.
- The model is language-blind (phoneme IDs in, audio out); Russian G2P is
  `ru_g2p.py`: RUAccent (stress, ё, homographs) -> acute marks -> eSpeak-ng
  with custom `ru_dict` -> IPA normalization. That Python frontend is the
  blocker for a browser port.
- Author's WER: 2.50% vs Piper 4.38% (79 words; ASR intelligibility, not
  naturalness; Piper irina transcribed perfectly in their set). Caveats in the
  model card: darker timbre, fricative artifacts, 93.8% homographs.
- Verdict: best candidate if we accept a real G2P porting task; not a
  “one adapter” change.

### System Russian voices (zero download, zero new model)

- `speechSynthesis.getVoices()` on macOS exposes Russian voices (e.g. Milena,
  Yuri); Windows has Microsoft Irina/Pavel/Dariya; Linux depends on installed
  speech-dispatcher voices.
- Latency is essentially zero, no download, no extra memory. Quality and
  availability are OS-dependent.
- Today `SpeechRouter.ensure()` sends every `ru` request to Piper regardless of
  `ttsEngine`; exposing system RU is a small, low-risk change and the best
  “instant” option.

### RHVoice

- HMM-based, small voice models, Russian is its original language; good
  intelligibility, robotic compared with neural TTS.
- Official platforms: Windows/Linux/Android; no official WebAssembly build.
  Compiling the C++ engine + voices to WASM is possible but a separate project.
- GPLv2; check distribution implications.

### eSpeak NG

- `espeak-ng` npm package is the actual synthesizer compiled to JS + WASM;
  Russian is supported; few MB; instant; clearly robotic.
- GPLv3. Useful as an emergency fallback or as a G2P frontend, not as the
  primary voice.

### Silero

- Official `v4_ru`/`v5_*` models are TorchScript/PyTorch packages, not ONNX.
- Community ONNX projects export several models (acoustic, vocoder, ISTFT,
  stress, ngram); total is several hundred MB, and the Russian frontend
  (stress/homographs/SSML) is Python.
- CC BY-NC 4.0. Not a reasonable browser add-on here.

## Recommendation

| If the priority is… | Choose |
|---|---|
| lowest latency, no download | **System Russian voice** (small router change) |
| a new local browser voice with minimal work | **MMS-TTS Russian q8** (38 MB) |
| best naturalness per CPU cycle | **Kokoro RU q8** (138 MB, G2P port) |
| smallest/robotic fallback | eSpeak NG WASM |
| avoid new licenses/weight | keep **Piper** |

My recommendation: first expose **system Russian voices** (almost free), then
add **MMS-TTS Russian** as an optional local fallback. Do **Kokoro RU** only if
we are ready to port the G2P; that is the one with a real quality upside.

## Sources

- [Silero models](https://github.com/snakers4/silero-models#russian)
- [Silero ONNX community port](https://github.com/some1-in-here/silero-tts-onnx)
- [MMS-TTS Russian (Transformers.js)](https://huggingface.co/Xenova/mms-tts-rus)
- [facebook/mms-tts-rus](https://huggingface.co/facebook/mms-tts-rus)
- [Kokoro RU](https://huggingface.co/zaakirio/kokoro-ru)
- [Kokoro-82M ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
- [RUAccent](https://github.com/Den4ikAI/ruaccent)
- [RHVoice](https://github.com/RHVoice/RHVoice)
- [eSpeak NG (npm WASM)](https://www.npmjs.com/package/espeak-ng)
- [MDN SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
