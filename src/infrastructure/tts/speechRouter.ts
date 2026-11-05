// Speech facade: one port over Phonon (streaming), Piper (Russian) and the
// browser's speechSynthesis. Routing rules are domain knowledge:
//   ru                       → Piper (Phonon has no Russian model)
//   phonon + de/en/fr/es/pt  → Phonon
//   system                   → speechSynthesis

import type { LoadProgress, SpeakOptions, SpeechLoadResult, SpeechPort, SpeechSelection, SystemVoice } from '../../application/ports'
import type { TargetLang } from '../../domain/models'
import { defaultPhononVoice, langInfo, PHONON_31M_EN_BASE, MULTILINGUAL_BASE } from '../../domain/policies/languages'
import { libT } from '../../shared/i18nStrings'
import { PIPER_VOICES, PiperEngine, piperVoiceOrDefault } from './piperTts'
import { PhononEngine, type PhononLoadProgress } from './phononTts'
import { TtsEngine } from './systemTts'

export class SpeechRouter implements SpeechPort {
  private lastLabel = '—'

  constructor(
    private readonly phonon: PhononEngine,
    private readonly system: TtsEngine,
    private readonly piper: PiperEngine,
  ) {}

  loadedLabel(): string {
    return this.lastLabel
  }

  async ensure(
    lang: TargetLang,
    selection: SpeechSelection,
    onProgress?: (p: LoadProgress) => void,
  ): Promise<SpeechLoadResult> {
    if (lang === 'ru') {
      try {
        onProgress?.({ progress: 0, text: libT('ttsWarming') })
        await this.piper.ensure()
        onProgress?.({ progress: 0.3, text: libT('ttsWarming') })
        // Voice download + ONNX graph build happen here, while the app is
        // still loading models — before the user can start a conversation.
        await this.piper.warmUp(piperVoiceOrDefault(lang, selection.voice))
        this.lastLabel = `Piper · ${piperVoiceOrDefault(lang, selection.voice)}`
        onProgress?.({ progress: 1, text: this.lastLabel })
        return { warning: null, label: this.lastLabel }
      } catch {
        return { warning: libT('warnPhononNotReady'), label: 'Piper' }
      }
    }
    if (selection.engine === 'phonon') {
      const base = selection.phononBase || langInfo(lang).phononBase
      try {
        await this.phonon.ensure(lang, base, selection.voice, (p: PhononLoadProgress) => {
          const frac = p.total ? p.loaded / p.total : 0
          const mb = p.total
            ? `${(p.loaded / 1048576).toFixed(0)}/${(p.total / 1048576).toFixed(0)} ${libT('fileMb')}`
            : `${(p.loaded / 1048576).toFixed(0)} ${libT('fileMb')}`
          onProgress?.({
            progress: frac,
            text: `${p.file} ${mb}${p.cached ? ` ${libT('fileCached')}` : ''}`,
          })
        })
        this.lastLabel = `${this.phonon.voiceLabel()} · ${selection.voice || defaultPhononVoice(lang)}`
        return { warning: null, label: this.lastLabel }
      } catch {
        return { warning: libT('warnPhononNotReady'), label: 'Phonon' }
      }
    }
    try {
      const voice = await this.system.ensure(selection.voice, lang)
      if (voice === null) {
        return { warning: libT('warnNoSystemVoice'), label: '—' }
      }
      this.lastLabel = this.system.voiceLabel()
      return { warning: null, label: this.lastLabel }
    } catch {
      return { warning: libT('warnTtsUnavailable'), label: '—' }
    }
  }

  async speak(text: string, opts: SpeakOptions): Promise<{ firstAudioMs: number | null }> {
    if (opts.lang === 'ru') {
      const result = await this.piper.speak(text, piperVoiceOrDefault('ru', opts.voice), opts.rate)
      opts.onFirstAudio?.(result.firstAudioMs)
      return { firstAudioMs: result.firstAudioMs }
    }
    if (opts.engine === 'phonon') {
      const result = await this.phonon.speak(text, opts.rate, opts.voice)
      opts.onFirstAudio?.(result.firstAudioMs)
      return { firstAudioMs: result.firstAudioMs }
    }
    await this.system.speak(text, opts.rate, opts.lang, {
      voiceUri: opts.voice,
      onFirstAudio: opts.onFirstAudio,
    })
    return { firstAudioMs: null }
  }

  cancel(): void {
    this.phonon.cancel()
    this.piper.cancel()
    this.system.cancel()
  }

  async listSystemVoices(lang: TargetLang): Promise<SystemVoice[]> {
    const voices = await this.system.listVoices(lang)
    return voices.map(v => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
    }))
  }
}

/** Default Phonon base for a language — duplicated here to keep the router
 *  free of the language catalog's voice-resolution details. */
export function isPhononLanguage(lang: TargetLang): boolean {
  return lang !== 'ru'
}

/** Exported for the diagnostics/bench screen: which public models are in use. */
export const SPEECH_SOURCES = { en: PHONON_31M_EN_BASE, fallback: MULTILINGUAL_BASE, piper: PIPER_VOICES }
