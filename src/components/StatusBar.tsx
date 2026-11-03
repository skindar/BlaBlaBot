import type { HealthInfo, Stage } from '../types'
import { useI18n } from '../i18n'

interface Props {
  stage: Stage
  statusText: string
  isError: boolean
  timings: Record<string, number> | null
  health: HealthInfo | null
}

export function StatusBar({ stage, statusText, isError, timings, health }: Props) {
  const t = useI18n()
  const dotClass = health == null ? 'offline' : health.ready ? 'ready' : 'loading'
  const dotTitle =
    health == null
      ? t('statusServerDown')
      : health.ready
        ? t('statusAllReady')
        : t('statusModelsLoading')

  const formatTimings = (tm: Record<string, number>): string => {
    const parts: string[] = []
    if (tm.asr_ms != null) parts.push(`ASR ${tm.asr_ms} ${t('fileMs')}`)
    if (tm.llm_ms != null) parts.push(`LLM ${tm.llm_ms} ${t('fileMs')}`)
    if (tm.tts_ms != null) parts.push(`TTS ${tm.tts_ms} ${t('fileMs')}`)
    if (tm.translation_ms != null) parts.push(`${t('timingTranslation')} ${tm.translation_ms} ${t('fileMs')}`)
    if (tm.total_ms != null) parts.push(`${t('timingTotal')} ${tm.total_ms} ${t('fileMs')}`)
    return parts.join(' · ')
  }

  void stage
  return (
    <div className={`status-bar${isError ? ' error' : ''}`}>
      <span className={`dot ${dotClass}`} title={dotTitle} />
      <span className="status-text">{statusText}</span>
      {timings && <span className="timings">{formatTimings(timings)}</span>}
    </div>
  )
}
