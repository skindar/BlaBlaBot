// Vocabulary lookup: the user explicitly selected a word in the language being
// studied. The app therefore trusts that word: it only needs a translation
// into the UI language. No "is this a real word", no lemma replacement and no
// cross-language guessing — those caused English cards for French/Spanish input.

import type { BrainPort, ClockPort, DictionaryPort, TelemetryPort, VocabularyRepository } from '../ports'
import { InvalidParameterError, LlmError, ModelsNotReadyError, PipelineError } from '../errors'
import type { LlmReply, TargetLang, UiLang, VocabLookupResult } from '../../domain/models'
import { langInfo } from '../../domain/policies/languages'
import { parseVocabTranslation } from '../../domain/policies/parse'
import { parseSingleTranslation, translationOk } from '../../domain/policies/translation'
import { buildVocabTranslationMessages } from '../../domain/policies/prompts'
import { libT } from '../../shared/i18nStrings'

const LLM_VOCAB_TEMPERATURE = 0.2

export interface VocabOptions {
  llmKey: string
  targetLang: TargetLang
  uiLang: UiLang
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export class VocabularyService {
  constructor(
    private readonly deps: {
      brain: BrainPort
      vocab: VocabularyRepository
      dictionary: DictionaryPort
      telemetry: TelemetryPort
      clock: ClockPort
    },
  ) {}

  private ensureReady(llmKey: string): void {
    const brain = this.deps.brain
    if (brain.kind !== 'cloud' && (!brain.isReady() || brain.modelKey !== llmKey)) {
      throw new ModelsNotReadyError(libT('errModelsNotReady'))
    }
  }

  async lookup(word: string, opts: VocabOptions): Promise<VocabLookupResult> {
    this.ensureReady(opts.llmKey)
    const cleaned = word
      .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ')
    if (!cleaned || cleaned.length > 80) throw new InvalidParameterError(libT('errVocabEmpty'))

    const brain = this.deps.brain
    const t0 = this.deps.clock.nowMs()
    const dictHit =
      opts.uiLang === 'ru' && langInfo(opts.targetLang).hasOfflineDict
        ? await this.deps.dictionary.lookup(cleaned)
        : { translations: [], pos: '' }

    let translation = dictHit.translations.length > 0 ? dictHit.translations.join(', ') : ''
    let partOfSpeech = dictHit.pos
    let example = ''
    let exampleTranslation = ''
    const lastPerf: { value: LlmReply['perf'] | null } = { value: null }

    const isValidTranslation = (candidate: string): boolean => {
      const line = candidate.trim()
      if (!line || !translationOk(line, opts.uiLang)) return false
      // For a different UI language the source word is not a translation.
      if (opts.uiLang !== opts.targetLang && normalize(line) === normalize(cleaned)) return false
      // Small models sometimes answer with an explanation instead of a gloss:
      // "how to say something in English", "это слово означает...".
      const words = line.split(/\s+/).filter(Boolean)
      if (words.length > 8) return false
      const meta =
        opts.uiLang === 'en'
          ? /\b(how to say|in english|translation|translate|means|meaning|the word|phrase)\b/i
          : /(как сказать|по-английски|перевод|перевести|означает|значение|это слово|фраз)/i
      return !meta.test(line)
    }

    const stripMetaGloss = (line: string): string => {
      const meta =
        opts.uiLang === 'en'
          ? /\b(?:how to say|to say|in english|translation|translate|means|meaning|the word|phrase)\b/i
          : /(?:как сказать|по-английски|перевод|перевести|означает|значение|это слово|фраз)/i
      return line.split(meta)[0].trim()
    }

    const translate = async (strict: boolean): Promise<boolean> => {
      const call = await brain.chat(
        buildVocabTranslationMessages(opts.targetLang, opts.uiLang, cleaned, strict),
        { temperature: strict ? 0 : LLM_VOCAB_TEMPERATURE, maxTokens: 160 },
      )
      lastPerf.value = call.perf
      const parsed = parseVocabTranslation(call.text)
      if (parsed) {
        const gloss = stripMetaGloss(parsed.translation)
        if (gloss && isValidTranslation(gloss)) {
          translation = gloss
          partOfSpeech = parsed.partOfSpeech
          example = parsed.example
          exampleTranslation = parsed.exampleTranslation
          return true
        }
      }
      // Tolerate a bare line if the model ignored the JSON request.
      const bare = stripMetaGloss(parseSingleTranslation(call.text).trim())
      if (bare && isValidTranslation(bare)) {
        translation = bare
        return true
      }
      return false
    }

    if (!translation) {
      try {
        if (!(await translate(false))) await translate(true)
      } catch (err) {
        if (err instanceof LlmError) throw new PipelineError(err.message)
        throw new PipelineError(
          libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }),
        )
      }
    }

    if (!isValidTranslation(translation)) throw new PipelineError(libT('errVocabFailed'))

    this.deps.telemetry.recordTurn({
      ts: this.deps.clock.nowMs(),
      stage: 'vocab',
      llmKey: brain.modelKey,
      modelId: brain.modelId,
      device: brain.device,
      temperature: LLM_VOCAB_TEMPERATURE,
      promptTokens: lastPerf.value?.promptTokens ?? null,
      completionTokens: lastPerf.value?.completionTokens ?? null,
      ttftMs: lastPerf.value?.ttftMs ?? null,
      prefillTokS: lastPerf.value?.prefillTokS ?? null,
      decodeTokS: lastPerf.value?.decodeTokS ?? null,
      e2eMs: lastPerf.value?.e2eMs ?? null,
      wallMs: this.deps.clock.nowMs() - t0,
      parse: 'json',
      correctionsRaw: null,
      correctionsKept: null,
      turnNo: null,
    })

    const result = this.deps.vocab.add({
      lang: opts.targetLang,
      word: cleaned,
      translation,
      partOfSpeech,
      example,
      exampleTranslation,
    })
    return { item: result.item, existed: result.existed }
  }
}
