# Free-talk / actor mode

`Settings → Tutor → Conversation mode → Free talk (actor)` removes the
scenario engine completely:

- no scenario bank, no scripted question, no chips, no relevance gate;
- the model receives the real dialog history (last 50 messages, trimmed to the
  prompt budget) and answers in plain text;
- one optional follow-up question, no forced question, no corrections;
- translation still runs when the lesson language differs from the UI language;
- `extraPrompt` becomes the character/persona instruction
  (e.g. “Ты Анна, дружелюбная собеседница. Говори по-русски.”);
- the sampling temperature is exposed next to the mode (0.2–1.2, default 0.8).

This is the honest “model as-is” experiment. It is the only mode where a 1B
model is not helped by the deterministic scaffold.

## What the research says

- **System prompt is foundational; keep it short.** A lean, declarative system
  prompt (under ~300 tokens) with non-conflicting rules works better than a
  wall of instructions; long prompts bury rules and eat context
  ([RPFiend, system prompt for roleplay](https://rpfiend.com/how-to-write-a-system-prompt-for-ai-roleplay/)).
- **Use the chat template/roles; history is the memory.** System/user/assistant
  messages are templated by the model's chat format; there is no hidden memory
  ([HF chat templating](https://huggingface.co/docs/transformers/main/en/chat_templating)).
- **Few-shot examples help format, not reasoning.** Demonstrations steer the
  shape of the answer, but a 1B model still fails multi-step reasoning
  ([DAIR few-shot guide](https://www.promptingguide.ai/techniques/fewshot)).
- **Qwen2.5 explicitly improves this use case.** The model card advertises
  “more resilient to the diversity of system prompts, enhancing role-play
  implementation and condition-setting for chatbots”, better instruction
  following and structured output; native context 32k
  ([Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct)).
  In WebLLM the prebuilt build is capped at **4096 tokens**, so our prompt
  budget stays ~2.9k after reserving generation space.
- **Gemma has official system-instruction/prompt formatting docs**
  ([Gemma prompt structure](https://ai.google.dev/gemma/docs/core/prompt-structure?hl=en));
  WebLLM applies the chat template for us.
- **Iterate on prompts and test the model you actually ship**, not only a
  larger one ([web.dev, practical prompt engineering for smaller LLMs](https://web.dev/articles/practical-prompt-engineering?hl=en)).

## Measured in this app (2026-11, WebGPU/Metal, Russian, temperature 0.8)

| Model | Free-talk result |
|---|---|
| **Qwen2.5-1.5B** | Best tested (Qwen2.5-3B is also available in Settings and should be stronger; 2.5 GB VRAM). `Привет! Меня зовут Анна.` → `Привет! Меня зовут Anna. Как я могу помочь вам сегодня?`; next turn `Как меня зовут?` → `Ваше имя зовётся Анна.` — history is used. Minor grammar roughness. |
| **Gemma-3-1B-IT** | Plausible first turn, loses the thread by turn 2 (`Как меня зовут?` → `Как тебя зовут? Ты очень милый!`). |
| **Llama-3.2-1B-Instruct** | Not usable free-form in this setup: Cyrillic/Arabic/Latin gibberish, identical replies, ignores history. The app flags it with `warnLanguageDrift` instead of silently showing it as a good answer. |

The scenario mode exists precisely because the 1B models behave like the last
two rows. For free conversation, Qwen 1.5B is the smallest model we can
recommend from this test set.

## Is this optimal for Qwen2.5-1.5B?

Short answer: **it is a sound base, not “exactly the source defaults”.** What we
now match, and what is still missing:

| Item | Qwen2.5 source / recommendation | This app |
|---|---|---|
| temperature | `0.7` | `0.7` default; slider 0.2–1.2 |
| top_p | `0.8` | `0.8` by default for Qwen (not exposed in the UI) |
| repetition_penalty | `1.1` | `1.1` by default for Qwen |
| top_k | `20` | **not exposed by WebLLM's chat API** |
| chat template | system/user/assistant roles | WebLLM applies the Qwen template |
| context | native 32k | WebLLM prebuilt build is capped at **4096**; prompt budget ~2.9k |
| memory | history + summary/window | history is passed and oldest pairs are dropped; **no summary yet** |
| system prompt | lean (<300 tokens), no conflicts | one universal persona (name from the selected TTS voice) + language + length + memory rules |
| few-shot | helps format | none in free talk (deliberately lean; scenario mode has its own) |

Sources: [Qwen2.5-1.5B generation_config](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/raw/main/generation_config.json)
(`temperature 0.7`, `top_p 0.8`, `top_k 20`, `repetition_penalty 1.1`),
[Qwen2.5 model card](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct),
[HF chat templating](https://huggingface.co/docs/transformers/main/en/chat_templating),
[RPFiend on system prompts](https://rpfiend.com/how-to-write-a-system-prompt-for-ai-roleplay/).

What would make it *actually* optimal: a WebLLM build with the native context
window, `top_k` support, a summary/long-term memory layer, and per-model prompt
presets. Those are the next steps below.

## Cloud brain note

For StepFun `step-3.7-flash` in free talk: the API streams reasoning separately
(`delta.reasoning`), and the client must use `reasoning_effort: low` with
enough `max_tokens` (4096+). Otherwise reasoning eats the budget and `content`
is empty. Dev uses a same-origin Vite proxy because StepFun has no CORS.

## Prompt Lab result: the “How can I help?” loop

The exact failure was Qwen answering as a support agent even in friend mode.
I ran four-turn conversations through the raw WebGPU brain (`brain.chat`, no
app prompt) for five prompt variants:

| Prompt | Qwen2.5-1.5B | Qwen2.5-3B |
|---|---|---|
| old English persona | 2/4 replies with “Как я могу помочь?” | — |
| strong English “not an assistant” | 0/4 banned, but answers were odd/rude | 0/4, one rude “А тебе какое дело?” |
| strong Russian negative | 2/4 banned | — |
| Russian few-shot example | 2/4 banned | **0/4, most natural** |
| Russian friend + assistant prefill | — | 0/4, odd replies |

No prompt alone fixed 1.5B. The production design is therefore:

1. the universal friend prompt with the selected voice's name (see `buildFreeTalkMessages`);
2. deterministic `stripAssistantOffers()` — the customer-support sentence is
   removed, the natural part of the reply survives;
3. if nothing is left, one repair attempt, then a target-language fallback;
4. the same sanitizer runs before language validation and persistence.

App-level verification on the user's four-turn dialogue: **0 banned phrases**
on both Qwen2.5-1.5B and Qwen2.5-3B. 1.5B is still rough (“Извините за
недоразумение”), 3B is noticeably more coherent; 3B is recommended for free
talk.

A replay of the full user transcript (7 turns, including ASR errors) after the
role-anchor prompt, sanitizer and duplicate-reply guard:

- 1.5B: 0 assistant offers, 0 role mirroring (“я тоже изучаю”), but still
  repeats questions (“А когда ты его начинал?”) and gives one awkward
  “Ничего, только что-то вроде смены настроения”.
- 3B: 0 assistant offers, natural replies, remembers the topic; still repeats
  “Круто! А давно ты его учишь?” a few times.

Conclusion: the assistant-tone loop is fixed deterministically; the remaining
repetition is a 1.5B capability limit, not a prompt bug. Semantic repetition
guard / summary memory is the next step.

## Practical settings for experiments

- Start with Qwen2.5-1.5B; 1B models are for scenario mode.
- Keep the persona in `extraPrompt` short (1–3 sentences, no contradictions).
- Ask one thing at a time; small models lose multi-part questions.
- 3–6 recent turns are usually enough; longer history mostly adds noise at 1B.
- Temperature 0.7–0.9 for chat; lower for factual answers. The UI slider writes
  `freeTalkTemperature` into settings.
- Use “New dialog” between experiments so the previous history does not leak.

## Next steps (not implemented)

- Semantic memory/summary instead of dropping the oldest pairs.
- Per-model prompt presets (Qwen/Gemma/Llama framing differs).
- A free-talk benchmark (coherence, language adherence, memory recall) next to
  the existing latency Bench tab.
