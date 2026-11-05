// Tutor and student messages in the design's look: the bot block with
// Listen / Translate / Save-phrase actions, the student's green bubble,
// corrections and the per-message translation toggle.

import { useState } from 'react'
import type { ChatMessage } from '../../domain/models'
import type { TargetLang } from '../../domain/policies/languages'
import { useI18n } from '../i18n'
import { BotMark, Icon } from '../ui/design'

interface Props {
  msg: ChatMessage
  showTranslation: boolean
  targetLang: TargetLang
  /** Replay speaks the message text with the selected TTS engine */
  onReplay: (msg: ChatMessage) => void
  /** Save the tutor's line (or its selected words) as a flashcard */
  onSavePhrase?: (text: string) => void
}

function timeOf(createdAt?: number): string {
  if (!createdAt) return ''
  const d = new Date(createdAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function MessageAction({
  icon,
  children,
  active,
  onClick,
}: {
  icon: Parameters<typeof Icon>[0]['name']
  children: React.ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className={`flex items-center gap-1.5 text-xs transition-colors hover:text-[#526f60] ${
        active ? 'text-[#526f60]' : 'text-[#737970]'
      }`}
      onClick={onClick}
      type="button"
    >
      <Icon name={icon} size={15} />
      <span>{children}</span>
    </button>
  )
}

export function MessageBubble({ msg, showTranslation, targetLang, onReplay, onSavePhrase }: Props) {
  const t = useI18n()
  const [translated, setTranslated] = useState(showTranslation)
  const [saved, setSaved] = useState(false)

  if (msg.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-[9px]">
        <div className="w-full max-w-[588px] rounded-bl-[20px] rounded-br-[5px] rounded-t-[20px] bg-[#ebefe7] px-[22px] py-[18px]">
          <p className="text-[17px] leading-[1.6]">{msg.text}</p>
          {showTranslation && msg.userTranslation && (
            <p className="mt-2 rounded-lg bg-white/60 px-3 py-2 text-sm leading-relaxed text-[#737970]">
              {msg.userTranslation}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[#94988f]">
          <span>
            {t('you')} · {timeOf(msg.createdAt)}
          </span>
          <Icon name="checks" size={14} />
        </div>
      </div>
    )
  }

  const corrections = msg.corrections ?? []
  return (
    <div className="flex w-full items-start gap-3.5">
      <BotMark />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-[#526f60]">
          {t('appName')} <span className="font-normal text-[#94988f]">· {timeOf(msg.createdAt)}</span>
        </p>
        <p className="mt-3.5 text-[18px] leading-[1.65] text-[#292e2a]" lang={targetLang}>{msg.text}</p>
        {translated && msg.translation && (
          <p className="mt-2 rounded-lg bg-[#f1f0eb] px-3 py-2 text-sm leading-relaxed text-[#737970]">
            {msg.translation}
          </p>
        )}
        {corrections.length > 0 && (
          <div className="mt-3 rounded-xl border border-[#e5e6de] bg-[#faf9f6] px-4 py-3">
            <p className="text-[11px] font-semibold tracking-[0.8px] text-[#9c625c]">
              {t('mistakesCount', { count: corrections.length }).toUpperCase()}
            </p>
            <div className="mt-2 space-y-2.5">
              {corrections.map((c, i) => (
                <div key={i}>
                  <p className="text-sm leading-relaxed">
                    <s className="text-[#94988f]">{c.original}</s>
                    <span className="mx-2 text-[#94988f]">→</span>
                    <b className="font-medium">{c.corrected}</b>
                  </p>
                  {c.explanation && (
                    <p className="mt-1 text-xs leading-relaxed text-[#737970]">{c.explanation}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-5">
          {msg.canSpeak && (
            <MessageAction icon="volume" onClick={() => onReplay(msg)}>
              {t('listen')}
            </MessageAction>
          )}
          {msg.translation && (
            <MessageAction active={translated} icon="languages" onClick={() => setTranslated(!translated)}>
              {translated ? t('hideTranslation') : t('translateAction')}
            </MessageAction>
          )}
          {onSavePhrase && msg.text.length <= 80 && (
            <MessageAction
              active={saved}
              icon="bookmark"
              onClick={() => {
                onSavePhrase(msg.text)
                setSaved(true)
              }}
            >
              {saved ? t('phraseSaved') : t('savePhrase')}
            </MessageAction>
          )}
        </div>
      </div>
    </div>
  )
}
