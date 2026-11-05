// The conversation list in the design's look: the date divider, the
// message stream, the answer chips and the "need a starting point?" hint
// for an empty conversation.

import { useEffect, useRef } from 'react'
import type { ChatMessage, Suggestion } from '../types'
import type { UiLang } from '../i18n'
import { useI18n } from '../i18n'
import type { TargetLang } from '../lib/langs'
import { Icon } from '../ui/design'
import { MessageBubble } from './MessageBubble'

interface Props {
  messages: ChatMessage[]
  showTranslation: boolean
  targetLang: TargetLang
  uiLang: UiLang
  onReplay: (msg: ChatMessage) => void
  onSuggest: (text: string) => void
  onSavePhrase?: (text: string) => void
  /** fill the typing box with a starter line ("Need a starting point?") */
  onStartHint?: (text: string) => void
}

/** Starter lines per target language for the "need a starting point?" hint */
const STARTER_TEXTS: Record<TargetLang, string[]> = {
  de: ['Guten Tag! Ich möchte über mein Wochenende erzählen.', 'Hallo! Erzähl mir bitte eine Frage.'],
  en: ["Hi! I'd like to talk about my weekend.", 'Hello! Please ask me a question.'],
  fr: ['Bonjour ! Je veux parler de mon week-end.', 'Salut ! Pose-moi une question, s’il te plaît.'],
  es: ['¡Hola! Quiero hablar de mi fin de semana.', '¡Hola! Hazme una pregunta, por favor.'],
  pt: ['Olá! Quero falar sobre meu fim de semana.', 'Olá! Me faz uma pergunta, por favor.'],
  ru: ['Привет! Хочу рассказать о своих выходных.', 'Привет! Задай мне вопрос, пожалуйста.'],
}

export function MessageList({
  messages,
  showTranslation,
  targetLang,
  uiLang,
  onReplay,
  onSuggest,
  onSavePhrase,
  onStartHint,
}: Props) {
  const t = useI18n()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const lastTutor = [...messages].reverse().find(m => m.role === 'tutor')
  const chips = lastTutor?.suggestions ?? []
  const dateLabel = new Date().toLocaleDateString(uiLang === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    day: 'numeric',
  })

  return (
    <section className="mx-auto w-full max-w-[896px] px-5 pb-8 pt-[29px] sm:px-8 xl:px-11">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[#e5e6de]" />
        <span className="text-[11px] text-[#94988f]">{t('today', { date: dateLabel })}</span>
        <span className="h-px flex-1 bg-[#e5e6de]" />
      </div>

      {messages.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-4 pt-10 text-center">
          <p className="max-w-md text-sm leading-6 text-[#737970]">{t('emptyText')}</p>
          {onStartHint && (
            <button
              className="flex flex-wrap items-center justify-center gap-2 text-xs"
              onClick={() => onStartHint(STARTER_TEXTS[targetLang][0])}
              type="button"
            >
              <Icon name="bulb" size={15} />
              <span className="text-[#737970]">{t('needStart')}</span>
              <span className="font-medium text-[#526f60]">“{STARTER_TEXTS[targetLang][0]}”</span>
            </button>
          )}
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {messages.map(m => (
            <MessageBubble
              key={m.id}
              msg={m}
              showTranslation={showTranslation}
              targetLang={targetLang}
              onReplay={onReplay}
              onSavePhrase={onSavePhrase}
            />
          ))}

          {chips.length > 0 && (
            <div className="flex flex-col items-end gap-[9px]">
              <div className="flex max-w-[588px] flex-wrap justify-end gap-2">
                {chips.map((s: Suggestion, i: number) => (
                  <button
                    className="rounded-full border border-[#e5e6de] bg-white px-4 py-2 text-left text-[13px] transition-colors hover:border-[#526f60] hover:text-[#526f60]"
                    key={i}
                    onClick={() => onSuggest(s.text)}
                    type="button"
                  >
                    {s.text}
                    {s.translation && (
                      <span className="ml-2 text-[11px] text-[#94988f]">{s.translation}</span>
                    )}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-[#94988f]">{t('suggestionsTitle')}</span>
            </div>
          )}
        </div>
      )}
      <div ref={endRef} />
    </section>
  )
}
