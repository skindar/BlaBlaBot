// Model lifecycle of the browser version: load ASR → LLM → TTS
// (system voices or Phonon); state shaped as HealthInfo for
// StatusBar/Sidebar/SettingsModal — like the native /api/health, plus progress.

import { useCallback, useEffect, useRef, useState } from 'react'
import { libT } from '../i18n'
import { recordLoad } from '../lib/bench'
import { defaultPhononVoice, langInfo, type TargetLang } from '../lib/langs'
import { asrEngine } from '../lib/asr'
import { llmEngine, llmModelByKey } from '../lib/llm'
import { ttsEngine } from '../lib/tts'
import { phononEngine } from '../lib/ttsPhonon'
import type { TtsEngineKind, WebHealth, WebModelHealth } from '../types'

type ModelKey = 'asr' | 'llm' | 'tts'

interface EngineState {
  models: Record<ModelKey, WebModelHealth>
  llmCurrent: string | null
}

const IDLE: WebModelHealth = { state: 'idle', error: '', load_ms: 0 }

export interface UseEngineArgs {
  targetLang: TargetLang
  llmKey: string
  asrKey: string
  ttsKind: TtsEngineKind
  ttsVoice: string
  phononBase: string
}

export function useEngine({ targetLang, llmKey, asrKey, ttsKind, ttsVoice, phononBase }: UseEngineArgs): WebHealth {
  const [state, setState] = useState<EngineState>(() => ({
    models: { asr: { ...IDLE }, llm: { ...IDLE }, tts: { ...IDLE } },
    llmCurrent: null,
  }))
  const loadRunRef = useRef(0)

  const patch = useCallback((key: ModelKey, partial: Partial<WebModelHealth>) => {
    setState(prev => ({
      ...prev,
      models: { ...prev.models, [key]: { ...prev.models[key], ...partial } },
    }))
  }, [])

  useEffect(() => {
    ++loadRunRef.current
    let cancelled = false

    async function loadTts() {
      if (ttsKind === 'phonon') {
        const base = phononBase || langInfo(targetLang).phononBase
        patch('tts', { state: 'loading', error: '', progress: 0, progressText: libT('modelLoading') })
        const t = performance.now()
        let sawNetwork = false
        try {
          await phononEngine.ensure(targetLang, base, ttsVoice, p => {
            if (cancelled) return
            if (!p.cached) sawNetwork = true
            const frac = p.total ? p.loaded / p.total : 0
            const mb = p.total
              ? `${(p.loaded / 1048576).toFixed(0)}/${(p.total / 1048576).toFixed(0)} ${libT('fileMb')}`
              : `${(p.loaded / 1048576).toFixed(0)} ${libT('fileMb')}`
            patch('tts', { progress: frac, progressText: `${p.file} ${mb}${p.cached ? ` ${libT('fileCached')}` : ''}` })
          })
          if (cancelled) return
          recordLoad({
            kind: 'tts',
            model: `phonon-${targetLang}`,
            ms: Math.round(performance.now() - t),
            source: sawNetwork ? 'network' : 'cache',
          })
          patch('tts', {
            state: 'ready',
            load_ms: Math.round(performance.now() - t),
            progress: 1,
            progressText: `${phononEngine.voiceLabel()} · ${ttsVoice || defaultPhononVoice(targetLang)}`,
          })
        } catch (err) {
          if (cancelled) return
          const reason = err instanceof Error ? err.message : String(err)
          patch('tts', {
            state: 'error',
            load_ms: Math.round(performance.now() - t),
            error: reason,
            progressText: reason.slice(0, 80),
          })
        }
      } else {
        patch('tts', { state: 'loading', error: '', progressText: libT('modelLoading') })
        const t = performance.now()
        try {
          const voice = await ttsEngine.ensure(ttsVoice, targetLang)
          if (cancelled) return
          if (voice === null) {
            patch('tts', {
              state: 'error',
              load_ms: Math.round(performance.now() - t),
              error: libT('noSystemVoiceForLang'),
              progressText: libT('noVoicesFound'),
            })
          } else {
            patch('tts', {
              state: 'ready',
              load_ms: Math.round(performance.now() - t),
              progressText: ttsEngine.voiceLabel(),
            })
          }
        } catch (err) {
          if (cancelled) return
          patch('tts', {
            state: 'error',
            load_ms: Math.round(performance.now() - t),
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    async function loadAsr() {
      patch('asr', { state: 'loading', error: '', progress: 0, progressText: libT('modelLoading') })
      const t = performance.now()
      let sawNetwork = false
      try {
        await asrEngine.ensure(asrKey, p => {
          if (!cancelled) patch('asr', { progress: p.progress, progressText: p.text })
          // transformers.js progress texts mention progress% only while downloading
          if (/%/.test(p.text)) sawNetwork = true
        })
        if (cancelled) return
        recordLoad({
          kind: 'asr',
          model: asrEngine.loadedKey ?? asrKey,
          ms: Math.round(performance.now() - t),
          source: sawNetwork ? 'network' : 'cache',
        })
        patch('asr', {
          state: 'ready',
          load_ms: Math.round(performance.now() - t),
          progress: 1,
          progressText: asrEngine.device === 'webgpu' ? 'WebGPU' : 'WASM',
        })
      } catch (err) {
        if (cancelled) return
        patch('asr', {
          state: 'error',
          load_ms: Math.round(performance.now() - t),
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    async function loadLlm() {
      patch('llm', { state: 'loading', error: '', progress: 0, progressText: libT('modelLoading') })
      const t = performance.now()
      let sawNetwork = false
      try {
        await llmEngine.ensure(llmKey, p => {
          if (!cancelled) patch('llm', { progress: p.progress, progressText: p.text })
          // webllm progress texts contain "Fetching"/percentages only while downloading
          if (/fetch|%/.test(p.text) && !/cache/i.test(p.text)) sawNetwork = true
        })
        if (cancelled) return
        recordLoad({
          kind: 'llm',
          model: llmModelByKey(llmKey).modelId,
          ms: Math.round(performance.now() - t),
          source: sawNetwork ? 'network' : 'cache',
        })
        setState(prev => ({ ...prev, llmCurrent: llmKey }))
        patch('llm', {
          state: 'ready',
          load_ms: Math.round(performance.now() - t),
          progress: 1,
          progressText: llmModelByKey(llmKey).label,
        })
      } catch (err) {
        if (cancelled) return
        setState(prev => ({ ...prev, llmCurrent: null }))
        patch('llm', {
          state: 'error',
          load_ms: Math.round(performance.now() - t),
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    async function load() {
      await loadTts()
      await loadAsr()
      await loadLlm()
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [targetLang, llmKey, asrKey, ttsKind, ttsVoice, phononBase, patch])

  const llmReady = state.models.llm.state === 'ready'
  const asrReady = state.models.asr.state === 'ready'
  const anyError = state.models.llm.state === 'error' || state.models.asr.state === 'error'

  return {
    status: llmReady && asrReady ? 'ready' : anyError ? 'error' : 'loading',
    ready: llmReady && asrReady,
    models: state.models,
    llm_current: state.llmCurrent ?? undefined,
    uptime_s: 0,
  }
}
