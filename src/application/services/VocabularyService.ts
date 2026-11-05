// Vocabulary lookup: LLM dictionary + offline deu-rus dictionary + store.
// Port of the old processVocab, now with injected ports.

import type { BrainPort, ClockPort, DictionaryPort, TelemetryPort, VocabularyRepository } from '../ports'
import { InvalidParameterError, LlmError, ModelsNotReadyError, PipelineError } from '../errors'
import type { TargetLang, UiLang, VocabLookupResult } from '../../domain/models'
import { langInfo } from '../../domain/policies/languages'
import { parseVocabJson } from '../../domain/policies/parse'
import { buildVocabMessages } from '../../domain/policies/prompts'
import { libT } from '../../shared/i18nStrings'

const LLM_VOCAB_TEMPERATURE = 0.3

export interface VocabOptions {
  llmKey: string
  targetLang: TargetLang
  uiLang: UiLang
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
    const cleaned = word.split(/\s+/).filter(Boolean).join(' ')
    if (!cleaned || cleaned.length > 80) throw new InvalidParameterError(libT('errVocabEmpty'))
    const brain = this.deps.brain
    const t0 = this.deps.clock.nowMs()
    let vocabCall
    try {
      vocabCall = await brain.chat(buildVocabMessages(opts.targetLang, opts.uiLang, cleaned), {
        temperature: LLM_VOCAB_TEMPERATURE,
      })
    } catch (err) {
      if (err instanceof LlmError) throw new PipelineError(err.message)
      throw new PipelineError(
        libT('errLlmFailed', { reason: err instanceof Error ? err.message : String(err) }),
      )
    }
    const data = parseVocabJson(vocabCall.text)
    if (data === null) throw new PipelineError(libT('errVocabFailed'))
    this.deps.telemetry.recordTurn({
      ts: this.deps.clock.nowMs(),
      stage: 'vocab',
      llmKey: brain.modelKey,
      modelId: brain.modelId,
      device: brain.device,
      temperature: LLM_VOCAB_TEMPERATURE,
      promptTokens: vocabCall.perf?.promptTokens ?? null,
      completionTokens: vocabCall.perf?.completionTokens ?? null,
      ttftMs: vocabCall.perf?.ttftMs ?? null,
      prefillTokS: vocabCall.perf?.prefillTokS ?? null,
      decodeTokS: vocabCall.perf?.decodeTokS ?? null,
      e2eMs: vocabCall.perf?.e2eMs ?? null,
      wallMs: this.deps.clock.nowMs() - t0,
      parse: 'json',
      correctionsRaw: null,
      correctionsKept: null,
      turnNo: null,
    })
    if (!data.exists) {
      const comment = data.comment || vocabNotRealDefaultComment()
      throw new InvalidParameterError(libT('errVocabNotReal', { word: cleaned, comment }))
    }
    const finalWord = data.word || cleaned
    const dictHit = langInfo(opts.targetLang).hasOfflineDict
      ? await this.deps.dictionary.lookup(finalWord)
      : { translations: [], pos: '' }
    const translation = dictHit.translations.length > 0 ? dictHit.translations.join(', ') : data.translation
    const partOfSpeech = dictHit.pos || data.part_of_speech
    const result = this.deps.vocab.add({
      lang: opts.targetLang,
      word: finalWord,
      translation,
      partOfSpeech,
      example: data.example,
      exampleTranslation: data.example_translation,
    })
    return { item: result.item, existed: result.existed }
  }
}

function vocabNotRealDefaultComment(): string {
  return libT('errVocabNotRealDefault')
}
