// Narrow left sidebar: brand, level, voice picker, the "Let's talk
// about…" free-form topic/instructions field, compact model status and
// the settings button. All other settings live in SettingsModal.

import { useEffect, useState } from 'react'
import type { Level, ModelHealth, Settings, WebHealth, WebModelHealth } from '../types'
import { useI18n } from '../i18n'
import { langInfo, phononVoices, resolvePhononVoice } from '../lib/langs'
import { LlmEngine, llmModelByKey } from '../lib/llm'
import { ttsEngine } from '../lib/tts'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  health: WebHealth | null
  onOpenSettings: () => void
}

const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2']

function stateLabel(state: string | undefined, t: (k: string) => string): string {
  if (state === 'ready') return t('modelReady')
  if (state === 'loading') return t('modelLoading')
  if (state === 'error') return t('modelError')
  return t('modelIdle')
}

function dotClass(model: ModelHealth | undefined): string {
  if (model?.state === 'ready') return 'ready'
  if (model?.state === 'error') return 'offline'
  return 'loading'
}

/** Short model status line: "ready · WebGPU" / "loading… 42%" */
function modelStatus(model: WebModelHealth | undefined, t: (k: string) => string): string {
  if (!model) return stateLabel(undefined, t)
  if (model.state === 'ready') return model.progressText || t('modelReady')
  if (model.state === 'error') return model.error.slice(0, 80) || t('modelError')
  if (model.state === 'loading') {
    const pct = typeof model.progress === 'number' && model.progress > 0 ? ` ${Math.round(model.progress * 100)}%` : ''
    return `${t('modelLoading')}${pct}`
  }
  return stateLabel(model.state, t)
}

export function Sidebar({ settings, onChange, health, onOpenSettings }: Props) {
  const t = useI18n()
  const lang = settings.targetLang
  const info = langInfo(lang)
  const [systemVoices, setSystemVoices] = useState<Array<{ uri: string; label: string }>>([])
  const webgpuOk = LlmEngine.supported()

  useEffect(() => {
    if (settings.ttsEngine !== 'system') return
    let cancelled = false
    void ttsEngine.listVoices(lang).then(voices => {
      if (cancelled) return
      setSystemVoices(
        voices.map(v => ({
          uri: v.voiceURI,
          label: `${v.name} (${v.lang})${v.localService ? '' : ` · ${t('systemVoiceNet')}`}`,
        })),
      )
    })
    return () => {
      cancelled = true
    }
  }, [settings.ttsEngine, lang, health, t])

  const phononBase = settings.phononBases[lang] ?? info.phononBase
  const voice =
    settings.ttsEngine === 'phonon'
      ? resolvePhononVoice(lang, phononBase, settings.ttsVoices[lang])
      : settings.ttsVoices[lang] ?? ''
  const currentLlm = llmModelByKey(settings.llmModel)

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">💬</div>
        <div>
          <h1>{t('appName')}</h1>
          <p>
            {info.flag} {info.nativeName} · {settings.level}
          </p>
        </div>
      </div>

      <div className="group">
        <label htmlFor="level">{t('level')}</label>
        <select
          id="level"
          value={settings.level}
          onChange={e => onChange({ level: e.target.value as Level })}
        >
          {LEVELS.map(l => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="group">
        <label htmlFor="voice">{t('voiceLabel')}</label>
        {settings.ttsEngine === 'phonon' ? (
          <select
            id="voice"
            value={voice}
            onChange={e => onChange({ ttsVoices: { ...settings.ttsVoices, [lang]: e.target.value } })}
          >
            {phononVoices(lang, phononBase).map(v => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            id="voice"
            value={voice}
            onChange={e => onChange({ ttsVoices: { ...settings.ttsVoices, [lang]: e.target.value } })}
          >
            {systemVoices.length === 0 && <option value="">{t('noSystemVoiceForLang')}</option>}
            {systemVoices.map(v => (
              <option key={v.uri} value={v.uri}>
                {v.label}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="group topic-group">
        <label htmlFor="topic-extra">{t('talkAbout')}</label>
        {settings.diaryMode ? (
          <p className="hint-note">{t('diaryModeHint')}</p>
        ) : (
          <>
            <textarea
              id="topic-extra"
              rows={3}
              value={settings.extraPrompt}
              placeholder={t('topicPlaceholder')}
              onChange={e => onChange({ extraPrompt: e.target.value })}
            />
            <p className="hint-note">{t('topicHint')}</p>
          </>
        )}
      </div>

      <div className="group row diary-toggle">
        <input
          id="diary-mode"
          type="checkbox"
          checked={Boolean(settings.diaryMode)}
          onChange={e => onChange({ diaryMode: e.target.checked })}
        />
        <label htmlFor="diary-mode">📖 {t('diaryMode')}</label>
      </div>

      <div className="group models compact">
        <ul>
          <li title={`${t('asrRow')}: ${modelStatus(health?.models.asr, t)}`}>
            <span className={`dot ${dotClass(health?.models.asr)}`} />
            <span className="model-name">ASR</span>
          </li>
          <li title={`${currentLlm.label} (LLM): ${modelStatus(health?.models.llm, t)}`}>
            <span className={`dot ${dotClass(health?.models.llm)}`} />
            <span className="model-name llm-current">
              <span className="brain" aria-hidden="true">🧠</span>
              <span className="llm-label">{currentLlm.label}</span>
            </span>
          </li>
          <li title={`${t('ttsRow')}: ${modelStatus(health?.models.tts, t)}`}>
            <span className={`dot ${dotClass(health?.models.tts)}`} />
            <span className="model-name">TTS</span>
          </li>
        </ul>
        {!webgpuOk && <p className="offline-note">{t('webgpuNote')}</p>}
      </div>

      <button
        type="button"
        className="gear-btn"
        onClick={onOpenSettings}
        title={t('openSettings')}
        aria-label={t('openSettings')}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M12 2.8l1.2 2.3a7 7 0 0 1 2.3.96l2.5-.7 1.7 2.9-1.9 1.8a7 7 0 0 1 0 2.68l1.9 1.8-1.7 2.9-2.5-.7a7 7 0 0 1-2.3.96L12 21.2l-1.2-2.3a7 7 0 0 1-2.3-.96l-2.5.7-1.7-2.9 1.9-1.8a7 7 0 0 1 0-2.68L4.3 9.46 6 6.56l2.5.7a7 7 0 0 1 2.3-.96L12 2.8z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span>{t('openSettings')}</span>
      </button>
    </aside>
  )
}
