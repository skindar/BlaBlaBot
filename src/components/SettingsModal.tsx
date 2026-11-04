// Settings modal in the design's language: sections in white cards with
// sage accents. Everything is functional (models, speech, tutor, Drive).
// The single visual theme is fixed by the design — no theme switcher.

import { useEffect, useState } from 'react'
import type { Level, Settings, WebHealth } from '../types'
import type { UiLang } from '../i18n'
import { useI18n } from '../i18n'
import { TARGET_LANG_LIST, langInfo, phononVoices, resolvePhononVoice } from '../lib/langs'
import { ASR_MODELS, DEFAULT_ASR_KEY } from '../lib/asr'
import { LlmEngine, availableLlmModels, llmModelByKey } from '../lib/llm'
import { ttsEngine } from '../lib/tts'
import { BUILT_IN_CLIENT_ID } from '../lib/gdrive'
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

const inputCls =
  'w-full rounded-xl border border-[#e5e6de] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#526f60]'
const labelCls = 'block text-[11px] font-semibold tracking-[0.8px] text-[#94988f] uppercase'

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
    configureSync({ autoSync: settings.driveAutoSync })
  }, [settings.driveAutoSync])

  const signIn = () => {
    void doSignIn().catch(() => undefined)
  }

  return (
    <>
      <label className={labelCls} htmlFor="set-drive-autosync">
        {t('syncAuto')}
      </label>
      <div className="mt-2 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2.5 text-sm" htmlFor="set-drive-autosync">
          <button
            aria-checked={settings.driveAutoSync}
            aria-labelledby="set-drive-autosync"
            className={`flex h-[22px] w-[38px] shrink-0 items-center rounded-full p-0.5 transition-colors ${
              settings.driveAutoSync ? 'justify-end bg-[#526f60]' : 'justify-start bg-[#e5e6de]'
            }`}
            disabled={!sync.signedIn}
            id="set-drive-autosync"
            onClick={() => onChange({ driveAutoSync: !settings.driveAutoSync })}
            role="switch"
            type="button"
          >
            <span className="size-4 rounded-full bg-white" />
          </button>
        </label>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
          {sync.signedIn ? (
            <>
              <span className="min-w-0 truncate text-xs text-[#737970]">
                {sync.syncing ? t('syncSyncing') : t('syncSignedInAs', { email: sync.email ?? '' })}
              </span>
              <button
                className="rounded-full border border-[#e5e6de] px-4 py-1.5 text-xs hover:border-[#526f60]"
                disabled={sync.syncing}
                onClick={() => void syncNow()}
                type="button"
              >
                {t('syncNow')}
              </button>
              <button
                className="rounded-full px-3 py-1.5 text-xs text-[#9c625c] hover:bg-[#faf3f2]"
                onClick={doSignOut}
                type="button"
              >
                {t('syncSignOut')}
              </button>
            </>
          ) : (
            <button
              className="rounded-full bg-[#526f60] px-5 py-2.5 text-xs text-white hover:bg-[#466052] disabled:opacity-40"
              disabled={!BUILT_IN_CLIENT_ID || sync.syncing}
              onClick={signIn}
              type="button"
            >
              {t('syncSignIn')}
            </button>
          )}
        </div>
      </div>
      {sync.error && (
        <p className="mt-2 text-xs leading-relaxed text-[#9c625c]">
          {t('syncError', { error: sync.error })}
        </p>
      )}
    </>
  )
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
  }, [settings.ttsEngine, lang, t])

  const voice =
    settings.ttsEngine === 'phonon'
      ? resolvePhononVoice(lang, settings.phononBases[lang] ?? info.phononBase, settings.ttsVoices[lang])
      : settings.ttsVoices[lang] ?? ''
  const setVoice = (v: string) => onChange({ ttsVoices: { ...settings.ttsVoices, [lang]: v } })
  const phononBase = settings.phononBases[lang] ?? info.phononBase

  const sectionTitle = 'text-[11px] font-semibold tracking-[1.2px] text-[#94988f]'
  const rowCls = 'flex flex-col gap-1.5'

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/25 p-4 sm:p-8" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div
        aria-label={t('settingsTitle')}
        aria-modal="true"
        className="w-full max-w-2xl rounded-[24px] border border-[#e5e6de] bg-[#faf9f6] p-6 shadow-2xl sm:p-8"
        role="dialog"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold tracking-[-0.5px]">{t('settingsTitle')}</h2>
          <button
            aria-label={t('close')}
            className="rounded-full p-2 text-xl leading-none text-[#737970] hover:bg-[#f1f0eb]"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {/* ---------- General ---------- */}
        <section className="mt-6 rounded-[20px] border border-[#e5e6de] bg-white p-5">
          <h3 className={sectionTitle}>{t('sectionGeneral')}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-ui-lang">{t('interfaceLang')}</label>
              <select
                className={inputCls}
                id="set-ui-lang"
                onChange={e => onChange({ uiLang: e.target.value as UiLang })}
                value={settings.uiLang}
              >
                <option value="ru">Русский</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-target-lang">{t('studyLang')}</label>
              <select
                className={inputCls}
                id="set-target-lang"
                onChange={e => onChange({ targetLang: e.target.value as Settings['targetLang'] })}
                value={lang}
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
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-level">{t('level')}</label>
              <select
                className={inputCls}
                id="set-level"
                onChange={e => onChange({ level: e.target.value as Level })}
                value={settings.level}
              >
                {LEVELS.map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </div>
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-translation">{t('showTranslation')}</label>
              <button
                aria-checked={settings.showTranslation}
                aria-labelledby="set-translation"
                className={`mt-1 flex h-[22px] w-[38px] items-center rounded-full p-0.5 transition-colors ${
                  settings.showTranslation ? 'justify-end bg-[#526f60]' : 'justify-start bg-[#e5e6de]'
                }`}
                id="set-translation"
                onClick={() => onChange({ showTranslation: !settings.showTranslation })}
                role="switch"
                type="button"
              >
                <span className="size-4 rounded-full bg-white" />
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-5">
            <label className="flex items-center gap-2 text-xs text-[#737970]" htmlFor="set-bench">
              <input
                checked={Boolean(settings.showBench)}
                id="set-bench"
                onChange={e => onChange({ showBench: e.target.checked })}
                type="checkbox"
              />
              {t('showBenchTab')}
            </label>
            <label className="flex items-center gap-2 text-xs text-[#737970]" htmlFor="set-handsfree">
              <input
                checked={Boolean(settings.handsFree)}
                id="set-handsfree"
                onChange={e => onChange({ handsFree: e.target.checked })}
                type="checkbox"
              />
              {t('handsFree')}
            </label>
          </div>
        </section>

        {/* ---------- Speech ---------- */}
        <section className="mt-4 rounded-[20px] border border-[#e5e6de] bg-white p-5">
          <h3 className={sectionTitle}>{t('sectionSpeech')}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-tts-engine">{t('ttsEngine')}</label>
              <select
                className={inputCls}
                id="set-tts-engine"
                onChange={e => onChange({ ttsEngine: e.target.value as Settings['ttsEngine'] })}
                value={settings.ttsEngine}
              >
                <option value="phonon">{t('enginePhonon')}</option>
                <option value="system">{t('engineSystem')}</option>
              </select>
            </div>
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-voice">{`${t('voiceLabel')} — ${info.nativeName}`}</label>
              {settings.ttsEngine === 'phonon' ? (
                <select className={inputCls} id="set-voice" onChange={e => setVoice(e.target.value)} value={voice}>
                  {phononVoices(lang, phononBase).map(v => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))}
                </select>
              ) : (
                <select className={inputCls} id="set-voice" onChange={e => setVoice(e.target.value)} value={voice}>
                  {systemVoices.length === 0 && <option value="">{t('noSystemVoiceForLang')}</option>}
                  {systemVoices.map(v => (
                    <option key={v.uri} value={v.uri}>{v.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {settings.ttsEngine === 'phonon' && (
            <div className={`${rowCls} mt-4`}>
              <label className={labelCls} htmlFor="set-phonon-base">{`${t('phononBase')} — ${info.nativeName}`}</label>
              <input
                className={inputCls}
                id="set-phonon-base"
                onChange={e => onChange({ phononBases: { ...settings.phononBases, [lang]: e.target.value } })}
                placeholder={info.phononBase}
                type="text"
                value={phononBase}
              />
              <p className="text-[11px] leading-relaxed text-[#94988f]">{t('phononBaseHint')}</p>
            </div>
          )}
          <div className={`${rowCls} mt-4`}>
            <label className={labelCls} htmlFor="set-speed">{t('ttsSpeed', { x: settings.ttsSpeed.toFixed(2) })}</label>
            <input
              className="accent-[#526f60]"
              id="set-speed"
              max={1.4}
              min={0.6}
              onChange={e => onChange({ ttsSpeed: Number(e.target.value) })}
              step={0.05}
              type="range"
              value={settings.ttsSpeed}
            />
          </div>
          <div className={rowCls}>
            <label className={labelCls} htmlFor="set-hf-pause">
              {t('handsFreePause', { s: Math.round((settings.handsFreePauseMs ?? 3000) / 1000) })}
            </label>
            <input
              className="accent-[#526f60]"
              id="set-hf-pause"
              max={30000}
              min={1000}
              onChange={e => onChange({ handsFreePauseMs: Number(e.target.value) })}
              step={500}
              type="range"
              value={settings.handsFreePauseMs ?? 3000}
            />
            <p className="text-[11px] leading-relaxed text-[#94988f]">{t('handsFreePauseHint')}</p>
          </div>
        </section>

        {/* ---------- Models ---------- */}
        <section className="mt-4 rounded-[20px] border border-[#e5e6de] bg-white p-5">
          <h3 className={sectionTitle}>{t('sectionModels')}</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-brain">{t('brain')}</label>
              <select
                className={inputCls}
                id="set-brain"
                onChange={e => onChange({ brain: e.target.value as Settings['brain'] })}
                value={settings.brain ?? 'local'}
              >
                <option value="local">{t('brainLocal')}</option>
                <option value="cloud">{t('brainCloud')}</option>
              </select>
              <p className="text-[11px] leading-relaxed text-[#94988f]">{t('brainHint')}</p>
            </div>
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-llm">{t('llmModel')}</label>
              <select
                className={inputCls}
                id="set-llm"
                onChange={e => onChange({ llmModel: e.target.value })}
                value={settings.llmModel}
              >
                {llmOptions.map(o => (
                  <option key={o.key} value={o.key}>
                    {o.label} ({o.size})
                  </option>
                ))}
              </select>
              <p className="text-[11px] leading-relaxed text-[#94988f]">
                {currentLlm.size ? `${t('ramInTab', { size: currentLlm.size })} · ` : ''}
                {t('llmHint')}
              </p>
            </div>
            <div className={rowCls}>
              <label className={labelCls} htmlFor="set-asr">{t('asrModel')}</label>
              <select
                className={inputCls}
                id="set-asr"
                onChange={e => onChange({ asrModel: e.target.value })}
                value={settings.asrModel}
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
          {(settings.brain ?? 'local') === 'cloud' && (
            <div className="mt-4 grid gap-4 border-t border-[#e5e6de] pt-4 sm:grid-cols-2">
              <div className={rowCls}>
                <label className={labelCls} htmlFor="set-cloud-base">{t('cloudBaseUrl')}</label>
                <input
                  className={inputCls}
                  id="set-cloud-base"
                  onChange={e => onChange({ cloudBaseUrl: e.target.value })}
                  placeholder="https://open.bigmodel.cn/api/paas/v4"
                  type="text"
                  value={settings.cloudBaseUrl ?? ''}
                />
              </div>
              <div className={rowCls}>
                <label className={labelCls} htmlFor="set-cloud-model">{t('cloudModel')}</label>
                <input
                  className={inputCls}
                  id="set-cloud-model"
                  onChange={e => onChange({ cloudModel: e.target.value })}
                  placeholder="glm-4-flash"
                  type="text"
                  value={settings.cloudModel ?? ''}
                />
              </div>
              <div className={rowCls}>
                <label className={labelCls} htmlFor="set-cloud-key">{t('cloudApiKey')}</label>
                <input
                  autoComplete="off"
                  className={inputCls}
                  id="set-cloud-key"
                  onChange={e => onChange({ cloudApiKey: e.target.value })}
                  placeholder="●●●●●●●●"
                  type="password"
                  value={settings.cloudApiKey ?? ''}
                />
              </div>
              <p className="text-[11px] leading-relaxed text-[#94988f]">{t('cloudPrivacyNote')}</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[#737970]">
            {(['asr', 'llm', 'tts'] as const).map(kind => {
              const m = health?.models[kind]
              const color =
                m?.state === 'ready' ? 'bg-[#526f60]' : m?.state === 'error' ? 'bg-[#9c625c]' : 'bg-[#c9cbbd]'
              return (
                <span className="flex items-center gap-1.5" key={kind}>
                  <span className={`size-2 rounded-full ${color}`} />
                  {kind === 'asr' ? t('asrRow', { name: 'ASR' }) : kind === 'llm' ? t('llmRow', { name: currentLlm.label }) : t('ttsRow')}
                  {m?.state === 'loading' && m.progressText ? ` · ${m.progressText.slice(0, 40)}` : ''}
                </span>
              )
            })}
          </div>
          {!webgpuOk && <p className="mt-4 text-[11px] leading-relaxed text-[#9c625c]">{t('webgpuNote')}</p>}
        </section>

        {/* ---------- Google Drive ---------- */}
        <section className="mt-4 rounded-[20px] border border-[#e5e6de] bg-white p-5">
          <h3 className={sectionTitle}>{t('syncSection')}</h3>
          {!BUILT_IN_CLIENT_ID && <p className="mt-2 text-[11px] leading-relaxed text-[#94988f]">{t('googleClientIdBakedHint')}</p>}
          <div className="mt-4">
            <SyncControls settings={settings} onChange={onChange} />
          </div>
        </section>

        {/* ---------- Tutor ---------- */}
        <section className="mt-4 rounded-[20px] border border-[#e5e6de] bg-white p-5">
          <h3 className={sectionTitle}>{t('sectionTutor')}</h3>
          <div className={`${rowCls} mt-4`}>
            <label className={labelCls} htmlFor="set-extra-prompt">{t('extraPromptLabel')}</label>
            <textarea
              className="min-h-20 w-full resize-none rounded-xl border border-[#e5e6de] bg-white px-4 py-3 text-sm outline-none focus:border-[#526f60]"
              id="set-extra-prompt"
              onChange={e => onChange({ extraPrompt: e.target.value })}
              placeholder={t('extraPromptPlaceholder')}
              rows={3}
              value={settings.extraPrompt}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <button
              className="rounded-full bg-[#9c625c] px-5 py-2.5 text-xs text-white hover:bg-[#8a534e]"
              onClick={onReset}
              type="button"
            >
              {t('newDialog')}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
