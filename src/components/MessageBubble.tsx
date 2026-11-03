import type { ChatMessage } from '../types'
import type { TargetLang } from '../lib/langs'
import { useI18n } from '../i18n'

interface Props {
  msg: ChatMessage
  showTranslation: boolean
  targetLang: TargetLang
  /** Replay speaks the message text with the selected TTS engine */
  onReplay: (msg: ChatMessage) => void
}

function TutorFollowUp({
  msg,
  showTranslation,
  targetLang,
}: {
  msg: ChatMessage
  showTranslation: boolean
  targetLang: string
}) {
  const t = useI18n()
  if (!msg.follow_up) return null
  return (
    <div className="tutor-follow">
      <span className="follow-label">{t('followLabel')}</span>
      <span className="follow-de" lang={targetLang}>
        {msg.follow_up}
      </span>
      {showTranslation && msg.follow_up_translation && (
        <span className="follow-ru">{msg.follow_up_translation}</span>
      )}
    </div>
  )
}

export function MessageBubble({ msg, showTranslation, targetLang, onReplay }: Props) {
  const t = useI18n()
  if (msg.role === 'user') {
    return (
      <div className="row user">
        <div className="bubble user-bubble">
          {msg.text}
          {showTranslation && msg.userTranslation && (
            <div className="user-translation">{msg.userTranslation}</div>
          )}
        </div>
      </div>
    )
  }

  const corrections = msg.corrections ?? []
  return (
    <div className="row tutor">
      <div className="bubble tutor-bubble">
        <div className="tutor-name">{t('appName')}</div>
        <p className="tutor-text">{msg.text}</p>
        {showTranslation && msg.translation && <div className="translation">{msg.translation}</div>}
        <TutorFollowUp msg={msg} showTranslation={showTranslation} targetLang={targetLang} />
        {corrections.length > 0 && (
          <details className="corrections">
            <summary>{t('mistakesCount', { count: corrections.length })}</summary>
            {corrections.map((c, i) => (
              <div className="correction" key={i}>
                <div className="correction-pair">
                  <s>{c.original}</s>
                  <span className="arrow">→</span>
                  <b>{c.corrected}</b>
                </div>
                {c.explanation && <div className="correction-note">{c.explanation}</div>}
              </div>
            ))}
          </details>
        )}
        {msg.audio_url && (
          <button type="button" className="replay-btn" onClick={() => onReplay(msg)}>
            <span className="eq">
              <i />
              <i />
              <i />
            </span>
            {t('replay')}
          </button>
        )}
      </div>
    </div>
  )
}
