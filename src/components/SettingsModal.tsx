// Settings modal: every app setting in one place —
// general, speech, models, tutor. The conversation topic and extra
// tutor context live in the Sidebar ("Let's talk about…").

import { useEffect, useState } from 'react'
import type { Level, ModelHealth, Settings, ThemeMode, WebHealth, WebModelHealth } from '../types'
import type { UiLang } from '../i18n'
import { useI18n } from '../i18n'
import { TARGET_LANG_LIST, langInfo, phononVoices, resolvePhononVoice } from '../lib/langs'
import { ASR_MODELS, DEFAULT_ASR_KEY } from '../lib/asr'
import { LlmEngine, availableLlmModels, llmModelByKey } from '../lib/llm'
import { ttsEngine } from '../lib/tts'
import {
  configureSync,
  doSignOut,
  getSyncStatus,
  signIn as doSignIn,
  subscribeSync,
  syncNow,
} from '../lib/sync'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  health: WebHealth | null
  onClose: () => void
  onReset: () => void
}

const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2']

function dotClass(model: ModelHealth | undefined): string {
  if (model?.state === 'ready') return 'ready'
  if (model?.state === 'error') return 'offline'
  return 'loading'
}

/** Google Drive sign-in + sync controls (the sync module holds the state) */
function SyncControls({
  settings,
  onChange,
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}) {
  const t = useI18n()
  const [sync, setSync] = useState(getSyncStatus())

  useEffect(() => subscribeSync(setSync), [])
  useEffect(() => {
    configureSync({ clientId: settings.googleClientId, autoSync: settings.driveAutoSync })
  }, [settings.googleClientId, settings.driveAutoSync])

  const signIn = () => {
    void doSignIn().catch(() => undefined)
  }

  return (
    <>
      <div className="group row">
        <input
          id="set-drive-autosync"
          type="checkbox"
          checked={settings.driveAutoSync}
          disabled={!sync.signedIn}
          onChange={e => onChange({ driveAutoSync: e.target.checked })}
        />
        <label htmlFor="set-drive-autosync">{t('syncAuto')}</label>
      </div>
      {sync.signedIn ? (
        <div className="group sync-status">
          <span className="sync-line">
            {sync.syncing
              ? t('syncSyncing')
              : t('syncSignedInAs', { email: sync.email ?? '' })}
          </span>
          <button type="button" className="card-btn" onClick={() => void syncNow()} disabled={sync.syncing}>
            {t('syncNow')}
          </button>
          <button type="button" className="reset-btn" onClick={doSignOut}>
            {t('syncSignOut')}
          </button>
        </div>
      ) : (
        <div className="group sync-status">
          <button
            type="button"
            className="card-btn primary"
            onClick={signIn}
            disabled={!settings.googleClientId || sync.syncing}
          >
            {t('syncSignIn')}
          </button>
        </div>
      )}
      {sync.error && <p className="offline-note">{t('syncError', { error: sync.error })}</p>}
    </>
  )
}

function modelStatus(model: WebModelHealth | undefined, t: (k: string) => string): string {
  if (!model) return t('modelIdle')
  if (model.state === 'ready') return model.progressText || t('modelReady')
  if (model.state === 'error') return model.error.slice(0, 120) || t('modelError')
  if (model.state === 'loading') {
    const pct = typeof model.progress === 'number' && model.progress > 0 ? ` ${Math.round(model.progress * 100)}%` : ''
    return `${t('modelLoading')}${pct}`
  }
  return t('modelIdle')
}

export function SettingsModal({ settings, onChange, health, onClose, onReset }: Props) {
  const t = useI18n()
  const lang = settings.targetLang
  const info = langInfo(lang)
  const llmOptions = availableLlmModels()
  const currentLlm = llmModelByKey(settings.llmModel)
  const webgpuOk = LlmEngine.supported()
  const [systemVoices, setSystemVoices] = useState<Array<{ uri: string; label: string }>>([])

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

  const setVoice = (v: string) => onChange({ ttsVoices: { ...settings.ttsVoices, [lang]: v } })
  const phononBase = settings.phononBases[lang] ?? info.phononBase
  const voice =
    settings.ttsEngine === 'phonon'
      ? resolvePhononVoice(lang, phononBase, settings.ttsVoices[lang])
      : settings.ttsVoices[lang] ?? ''

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label={t('settingsTitle')}>
        <div className="modal-head">
          <h2>{t('settingsTitle')}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </div>

        {/* ---------- General ---------- */}
        <section className="settings-section">
          <h3>{t('sectionGeneral')}</h3>
          <div className="settings-grid">
            <div className="group">
              <label htmlFor="set-ui-lang">{t('interfaceLang')}</label>
              <select
                id="set-ui-lang"
                value={settings.uiLang}
                onChange={e => onChange({ uiLang: e.target.value as UiLang })}
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="group">
              <label htmlFor="set-target-lang">{t('studyLang')}</label>
              <select
                id="set-target-lang"
                value={lang}
                onChange={e => onChange({ targetLang: e.target.value as Settings['targetLang'] })}
              >
                {TARGET_LANG_LIST.map(code => {
                  const li = langInfo(code)
                  return (
                    <option key={code} value={code}>
                      {li.flag} {li.nativeName}
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="group">
              <label htmlFor="set-theme">{t('theme')}</label>
              <select
                id="set-theme"
                value={settings.theme}
                onChange={e => onChange({ theme: e.target.value as ThemeMode })}
              >
                <option value="system">{t('themeSystem')}</option>
                <option value="light">{t('themeLight')}</option>
                <option value="dark">{t('themeDark')}</option>
              </select>
            </div>
            <div className="group">
              <label htmlFor="set-level">{t('level')}</label>
              <select
                id="set-level"
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
          </div>
          <div className="group row">
            <input
              id="set-translation"
              type="checkbox"
              checked={settings.showTranslation}
              onChange={e => onChange({ showTranslation: e.target.checked })}
            />
            <label htmlFor="set-translation">{t('showTranslation')}</label>
          </div>
          <div className="group row">
            <input
              id="set-bench"
              type="checkbox"
              checked={Boolean(settings.showBench)}
              onChange={e => onChange({ showBench: e.target.checked })}
            />
            <label htmlFor="set-bench">{t('showBenchTab')}</label>
          </div>
        </section>

        {/* ---------- Speech ---------- */}
        <section className="settings-section">
          <h3>{t('sectionSpeech')}</h3>
          <div className="settings-grid">
            <div className="group">
              <label htmlFor="set-tts-engine">{t('ttsEngine')}</label>
              <select
                id="set-tts-engine"
                value={settings.ttsEngine}
                onChange={e => onChange({ ttsEngine: e.target.value as Settings['ttsEngine'] })}
              >
                <option value="phonon">{t('enginePhonon')}</option>
                <option value="system">{t('engineSystem')}</option>
              </select>
            </div>
            <div className="group">
              <label htmlFor="set-voice">{t('voiceLabel')} — {info.nativeName}</label>
              {settings.ttsEngine === 'phonon' ? (
                <select id="set-voice" value={voice} onChange={e => setVoice(e.target.value)}>
                  {phononVoices(lang, phononBase).map(v => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select id="set-voice" value={voice} onChange={e => setVoice(e.target.value)}>
                  {systemVoices.length === 0 && <option value="">{t('noSystemVoiceForLang')}</option>}
                  {systemVoices.map(v => (
                    <option key={v.uri} value={v.uri}>
                      {v.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {settings.ttsEngine === 'phonon' && (
            <div className="group">
              <label htmlFor="set-phonon-base">{t('phononBase')} — {info.nativeName}</label>
              <input
                id="set-phonon-base"
                type="text"
                value={phononBase}
                placeholder={info.phononBase}
                onChange={e => onChange({ phononBases: { ...settings.phononBases, [lang]: e.target.value } })}
              />
              <p className="hint-note">{t('phononBaseHint')}</p>
            </div>
          )}
          <div className="group">
            <label htmlFor="set-speed">{t('ttsSpeed', { x: settings.ttsSpeed.toFixed(2) })}</label>
            <input
              id="set-speed"
              type="range"
              min={0.6}
              max={1.4}
              step={0.05}
              value={settings.ttsSpeed}
              onChange={e => onChange({ ttsSpeed: Number(e.target.value) })}
            />
          </div>
        </section>

        {/* ---------- Models ---------- */}
        <section className="settings-section">
          <h3>{t('sectionModels')}</h3>
          <div className="settings-grid">
            <div className="group">
              <label htmlFor="set-llm">{t('llmModel')}</label>
              <select
                id="set-llm"
                value={settings.llmModel}
                onChange={e => onChange({ llmModel: e.target.value })}
              >
                {llmOptions.map(o => (
                  <option key={o.key} value={o.key}>
                    {o.label} ({o.size})
                  </option>
                ))}
              </select>
              <p className="hint-note">
                {currentLlm.size ? t('ramInTab', { size: currentLlm.size }) + ' ' : ''}
                {t('llmHint')}
              </p>
            </div>
            <div className="group">
              <label htmlFor="set-asr">{t('asrModel')}</label>
              <select
                id="set-asr"
                value={settings.asrModel}
                onChange={e => onChange({ asrModel: e.target.value })}
              >
                {ASR_MODELS.map(o => (
                  <option key={o.key} value={o.key}>
                    {o.label} ({o.size})
                  </option>
                ))}
              </select>
              {settings.asrModel !== DEFAULT_ASR_KEY && <p className="hint-note" />}
            </div>
          </div>
          <div className="group models">
            <ul>
              <li>
                <span className={`dot ${dotClass(health?.models.asr)}`} />
                {t('asrRow')}: {modelStatus(health?.models.asr, t)}
              </li>
              <li>
                <span className={`dot ${dotClass(health?.models.llm)}`} />
                {t('llmRow', { name: currentLlm.label })}: {modelStatus(health?.models.llm, t)}
              </li>
              <li>
                <span className={`dot ${dotClass(health?.models.tts)}`} />
                {t('ttsRow')}: {modelStatus(health?.models.tts, t)}
              </li>
            </ul>
            {!webgpuOk && <p className="offline-note">{t('webgpuNote')}</p>}
          </div>
        </section>

        {/* ---------- Google Drive ---------- */}
        <section className="settings-section">
          <h3>{t('syncSection')}</h3>
          <div className="group">
            <label htmlFor="set-google-id">{t('googleClientId')}</label>
            <input
              id="set-google-id"
              type="text"
              value={settings.googleClientId}
              placeholder="1234567890-xxxxxxxx.apps.googleusercontent.com"
              onChange={e => onChange({ googleClientId: e.target.value })}
            />
            <p className="hint-note">{t('googleClientIdHint')}</p>
          </div>
          <SyncControls settings={settings} onChange={onChange} />
        </section>

        {/* ---------- Tutor ---------- */}
        <section className="settings-section">
          <h3>{t('sectionTutor')}</h3>
          <p className="hint-note">{t('tutorMovedNote')}</p>
          <button type="button" className="reset-btn" onClick={onReset}>
            {t('newDialog')}
          </button>
        </section>
      </div>
    </div>
  )
}
