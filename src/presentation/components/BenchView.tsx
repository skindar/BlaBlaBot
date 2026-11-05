// Bench tab: environment snapshot, per-model aggregate of LLM calls,
// model load log (cold vs cache) and a scripted benchmark run across the
// selected models. Exports Markdown tables ready to paste into an article.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n, type UiLang } from '../i18n'
import type {
  BenchRunProgress,
  ContextProbe,
  EnvSnapshot,
  LoadMetric,
  TurnMetrics,
} from '../../application/telemetry'
import { useServices } from '../context'
import type { TargetLang } from '../../domain/policies/languages'

function fmt1(x: number | null | undefined): string {
  return x == null ? '—' : x.toFixed(1)
}

function fmt0(x: number | null | undefined): string {
  return x == null ? '—' : Math.round(x).toString()
}

interface Props {
  active: boolean
  targetLang: TargetLang
  uiLang: UiLang
}

export function BenchView({ active, targetLang, uiLang }: Props) {
  const t = useI18n()
  const { bench, catalog } = useServices()
  const [env, setEnv] = useState<EnvSnapshot | null>(() => bench.env())
  const [turns, setTurns] = useState<TurnMetrics[]>([])
  const [loads, setLoads] = useState<LoadMetric[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [running, setRunning] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<ContextProbe | null>(null)
  const [progress, setProgress] = useState<BenchRunProgress | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const models = useMemo(() => catalog.llmModels(), [catalog])

  const refresh = useCallback(() => {
    setTurns(bench.turns())
    setLoads(bench.loads())
    const probes = bench.probes()
    setProbe(probes.length > 0 ? probes[probes.length - 1] : null)
  }, [bench])

  useEffect(() => {
    if (!active) return
    void bench.snapshotEnv().then(setEnv)
    refresh()
  }, [active, bench, refresh])

  // Default selection: the curated model list
  useEffect(() => {
    const preferred = ['gemma-3-1b', 'llama-3.2-1b', 'qwen2.5-1.5b', 'gemma-4-e2b']
    setChecked(Object.fromEntries(models.map(m => [m.key, preferred.includes(m.key)])))
  }, [models])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const aggregate = useMemo(() => bench.aggregate(), [bench, turns])

  const onRun = useCallback(async () => {
    if (running) return
    const modelKeys = models.filter(m => checked[m.key]).map(m => m.key)
    if (modelKeys.length === 0) return
    setRunning(true)
    setProgress(null)
    try {
      await bench.runBenchmark({
        modelKeys,
        targetLang,
        uiLang,
        onProgress: setProgress,
      })
      setToast(t('benchRun'))
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
      refresh()
    }
  }, [running, models, checked, targetLang, uiLang, t, refresh, bench])

  const onProbe = useCallback(async () => {
    if (probing || running) return
    const modelKey = models.find(m => checked[m.key])?.key
    if (!modelKey) return
    setProbing(true)
    setProgress(null)
    try {
      const result = await bench.runContextProbe({
        modelKey,
        targetLang,
        uiLang,
        onProgress: setProgress,
      })
      if (result) setProbe(result)
      setToast(t('benchProbe'))
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    } finally {
      setProbing(false)
      refresh()
    }
  }, [probing, running, models, checked, targetLang, uiLang, t, refresh, bench])

  const copy = useCallback(
    (text: string) => {
      void navigator.clipboard
        .writeText(text)
        .then(() => setToast(t('benchCopied')))
        .catch(() => setToast('clipboard error'))
    },
    [t],
  )

  const recent = [...turns].slice(-15).reverse()

  return (
    <section className="bench-view">
      <div className="bench-top">
        <h2>{t('benchTitle')}</h2>
        <div className="bench-actions">
          <button type="button" className="card-btn" onClick={() => copy(bench.toMarkdown())} disabled={turns.length === 0}>
            {t('benchCopyMd')}
          </button>
          <button type="button" className="card-btn" onClick={() => copy(bench.toJSON())} disabled={turns.length === 0}>
            {t('benchCopyJson')}
          </button>
          <button type="button" className="card-btn danger" onClick={() => { bench.clear(); refresh() }} disabled={running}>
            {t('benchClear')}
          </button>
        </div>
      </div>

      <div className="bench-env">
        <h3>{t('benchEnvTitle')}</h3>
        {env ? (
          <ul className="bench-env-list">
            <li>GPU: {[env.gpuVendor, env.gpuArchitecture, env.gpuDevice].filter(Boolean).join(' / ') || '—'}</li>
            <li>Browser: {env.userAgent}</li>
            <li>
              web-llm {env.webllmVersion} · phonon-tts {env.phononTtsVersion} · transformers.js {env.transformersVersion}
            </li>
          </ul>
        ) : (
          <p className="bench-hint">{t('benchEnvHint')}</p>
        )}
      </div>

      <div className="bench-run">
        <h3>{t('benchModelsTitle')}</h3>
        <div className="bench-models">
          {models.map(m => (
            <label key={m.key} className="bench-model">
              <input
                type="checkbox"
                checked={Boolean(checked[m.key])}
                disabled={running}
                onChange={e => setChecked(prev => ({ ...prev, [m.key]: e.target.checked }))}
              />
              {m.label} <span className="bench-size">{m.size}</span>
            </label>
          ))}
        </div>
        <div className="bench-actions">
          <button type="button" className="card-btn primary" onClick={() => void onRun()} disabled={running || probing}>
            {running ? t('benchRunning') : t('benchRun')}
          </button>
          <button type="button" className="card-btn" onClick={() => void onProbe()} disabled={running || probing} title={t('benchProbeHint')}>
            {probing ? t('benchRunning') : t('benchProbe')}
          </button>
        </div>
        <p className="bench-hint">{t('benchProbeHint')}</p>
        {progress && (
          <p className="bench-progress">
            {t('benchProgress', { model: progress.modelKey || progress.text, text: progress.text })}
          </p>
        )}
      </div>

      {probe && (
        <div className="bench-section">
          <h3>
            {t('benchProbeTitle')} — {probe.modelId} (window {probe.contextWindow})
          </h3>
          <div className="bench-table-wrap">
            <table className="bench-table">
              <thead>
                <tr>
                  <th>{t('benchColTurn')}</th>
                  <th>{t('benchColPromptTok')}</th>
                  <th>{t('benchColTtft')}</th>
                  <th>{t('benchColDecode')}</th>
                  <th>{t('benchColWall')}</th>
                </tr>
              </thead>
              <tbody>
                {probe.rows.map((r, i) => (
                  <tr key={i} className={r.error ? 'bench-row-error' : undefined}>
                    <td>{r.turn}</td>
                    <td>{r.promptTokens ?? '—'}</td>
                    <td>{fmt0(r.ttftMs)}</td>
                    <td>{fmt1(r.decodeTokS)}</td>
                    <td>{r.wallMs ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {probe.rows[probe.rows.length - 1]?.error && (
            <p className="bench-hint">⚠ {probe.rows[probe.rows.length - 1].error}</p>
          )}
        </div>
      )}

      {aggregate.length > 0 && (
        <div className="bench-section">
          <h3>{t('benchAggTitle')}</h3>
          <div className="bench-table-wrap">
            <table className="bench-table">
              <thead>
                <tr>
                  <th>{t('benchColModel')}</th>
                  <th>{t('benchColTurns')}</th>
                  <th>{t('benchColDecode')}</th>
                  <th>{t('benchColTtft')}</th>
                  <th>{t('benchColWall')}</th>
                  <th>{t('benchColJson')}</th>
                  <th>{t('benchColCorr')}</th>
                </tr>
              </thead>
              <tbody>
                {aggregate.map(a => (
                  <tr key={a.llmKey}>
                    <td>{a.modelId}</td>
                    <td>{a.turns}</td>
                    <td>{fmt1(a.decodeTokS)}</td>
                    <td>{fmt0(a.ttftMs)}</td>
                    <td>{fmt0(a.wallMs)}</td>
                    <td>{a.jsonOkRate == null ? '—' : `${Math.round(a.jsonOkRate * 100)}%`}</td>
                    <td>{a.correctionsKept}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loads.length > 0 && (
        <div className="bench-section">
          <h3>{t('benchLoadsTitle')}</h3>
          <div className="bench-table-wrap">
            <table className="bench-table">
              <thead>
                <tr>
                  <th>{t('benchColKind')}</th>
                  <th>{t('benchColModel')}</th>
                  <th>{t('benchColMs')}</th>
                  <th>{t('benchColSource')}</th>
                </tr>
              </thead>
              <tbody>
                {[...loads].reverse().slice(0, 12).map((l, i) => (
                  <tr key={l.ts + '-' + i}>
                    <td>{l.kind}</td>
                    <td>{l.model}</td>
                    <td>{l.ms}</td>
                    <td>{l.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {recent.length > 0 && (
        <div className="bench-section">
          <h3>{t('benchTurnsTitle')}</h3>
          <div className="bench-table-wrap">
            <table className="bench-table">
              <thead>
                <tr>
                  <th>{t('benchColStage')}</th>
                  <th>{t('benchColModel')}</th>
                  <th>{t('benchColDecode')}</th>
                  <th>{t('benchColTtft')}</th>
                  <th>{t('benchColTokens')}</th>
                  <th>{t('benchColWall')}</th>
                  <th>{t('benchColParse')}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={r.ts + '-' + i}>
                    <td>{r.stage}</td>
                    <td>{r.modelId}</td>
                    <td>{fmt1(r.decodeTokS)}</td>
                    <td>{fmt0(r.ttftMs)}</td>
                    <td>
                      {r.promptTokens ?? '—'}/{r.completionTokens ?? '—'}
                    </td>
                    <td>{r.wallMs ?? '—'}</td>
                    <td>{r.parse ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {turns.length === 0 && loads.length === 0 && <p className="bench-hint">{t('benchEmpty')}</p>}
      {toast && <div className="vocab-toast bench-toast">{toast}</div>}
    </section>
  )
}
