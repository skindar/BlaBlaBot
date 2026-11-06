# Russian ASR research (browser, November 2026)

Goal: a speech recognizer for the browser that is faster and/or more accurate
than Whisper tiny/base, without adding a server.

## What is implemented now

`Settings → Recognition engine`:

| Engine | Download | Where it runs | Browser support | Notes |
|---|---|---|---|---|
| **Whisper tiny/base/small** | 40/80/250 MB | ONNX Runtime Web (WebGPU/WASM) | all modern browsers | private/offline, current default |
| **System (Web Speech API)** | **0 MB** | browser/platform service; Chrome/Edge usually cloud-backed | Chrome/Edge; Safari limited; Firefox no | fastest start, usually strong Russian, but network/privacy provider-dependent |

The system engine is selected with `asrEngine: 'system'`. In that mode the app
does **not** download Whisper: the recorder runs in parallel for VAD and the
live transcript is submitted as the turn. If Web Speech is unsupported, the
option is disabled and Whisper remains.

### System ASR caveats

- It is a **live microphone** API; it cannot transcribe an arbitrary audio blob.
- Chrome/Edge commonly send audio to a cloud recognition service; check privacy
  requirements before using it for sensitive conversations.
- Firefox doesn't implement `SpeechRecognition`; Safari's implementation is
  limited. The app falls back to Whisper.
- Recognition quality depends on the OS/browser provider, not on our model.

## Other browser-capable options (not added yet)

| Option | Size | Russian | Browser fit | Verdict |
|---|---|---|---|---|
| **Vosk small Russian** (`vosk-model-small-ru-0.22`) | ~45 MB | yes | WASM, streaming, offline | viable lightweight fallback; lower accuracy than Whisper base on conversational speech |
| **GigaAM v3 Russian via sherpa-onnx** | ~225 MB int8 | yes, Russian-first | WASM/ONNX, offline | strong Russian accuracy candidate; integration + model size are the cost |
| **T-one Russian streaming via sherpa-onnx** | ~144 MB | yes | streaming ONNX, offline | good real-time candidate; same integration cost |
| **NVIDIA Parakeet TDT 0.6B v3** | ~600M params | yes (25 languages incl. ru) | ONNX/server; too heavy for a browser tab next to WebLLM | not a browser add-on now |
| **Moonshine** | small | English-focused | ONNX/WASM | not a Russian replacement |
| **Whisper small** (already in catalog) | ~250 MB | yes | same Transformers.js path | easiest accuracy upgrade, slower/heavier |

## Recommendation

- For **zero download + fastest start**, the system Web Speech engine is the
  practical winner on Chrome/Edge.
- For **offline/private**, keep Whisper; choose `small` when accuracy matters.
- The next serious Russian-first offline upgrade is **GigaAM v3 via
  sherpa-onnx** (or T-one for streaming), but it is a separate model/runtime
  integration (~150–225 MB), not a drop-in catalog entry like Whisper.

## Sources

- [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [Vosk models](https://alphacephei.com/vosk/models)
- [GigaAM](https://github.com/salute-developers/GigaAM)
- [T-one](https://github.com/voicekit-team/T-one)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [Transformers.js Whisper](https://huggingface.co/onnx-community/whisper-base)
