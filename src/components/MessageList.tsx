import { useEffect, useRef } from 'react'
import type { ChatMessage, Suggestion } from '../types'
import type { UiLang } from '../i18n'
import { useI18n } from '../i18n'
import type { TargetLang } from '../lib/langs'
import { MessageBubble } from './MessageBubble'

interface Props {
  messages: ChatMessage[]
  showTranslation: boolean
  targetLang: TargetLang
  uiLang: UiLang
  onReplay: (msg: ChatMessage) => void
  onSuggest: (text: string) => void
}

/** Starter suggestions per target language (translation is in the UI language) */
const STARTER_TEXTS: Record<TargetLang, string[]> = {
  de: [
    'Guten Tag! Wie geht es dir?',
    'Ich möchte über mein Wochenende erzählen.',
    'Stell mir bitte eine Frage.',
  ],
  en: ["Hi! How's it going?", "I'd like to talk about my weekend.", 'Ask me a question, please.'],
  fr: [
    'Bonjour ! Comment ça va ?',
    'Je veux parler de mon week-end.',
    "Pose-moi une question, s'il te plaît.",
  ],
  es: [
    '¡Hola! ¿Cómo estás?',
    'Quiero hablar de mi fin de semana.',
    'Hazme una pregunta, por favor.',
  ],
  pt: [
    'Olá! Tudo bem?',
    'Quero falar sobre meu fim de semana.',
    'Me faz uma pergunta, por favor.',
  ],
}

const STARTER_TRANSLATIONS: Record<TargetLang, { ru: string[]; en: string[] }> = {
  de: {
    ru: ['Привет! Как у тебя дела?', 'Я хочу рассказать о своих выходных.', 'Задай мне, пожалуйста, вопрос.'],
    en: ['Hello! How are you?', 'I want to tell you about my weekend.', 'Ask me a question, please.'],
  },
  en: {
    ru: ['Привет! Как дела?', 'Я хочу поговорить о своих выходных.', 'Задай мне, пожалуйста, вопрос.'],
    en: ["Hi! How's it going?", "I'd like to talk about my weekend.", 'Ask me a question, please.'],
  },
  fr: {
    ru: ['Здравствуй! Как дела ?', 'Я хочу рассказать о своих выходных.', 'Задай мне, пожалуйста, вопрос.'],
    en: ['Hello! How are you?', 'I want to talk about my weekend.', 'Ask me a question, please.'],
  },
  es: {
    ru: ['Привет! Как дела?', 'Я хочу рассказать о своих выходных.', 'Задай мне, пожалуйста, вопрос.'],
    en: ['Hi! How are you?', 'I want to talk about my weekend.', 'Ask me a question, please.'],
  },
  pt: {
    ru: ['Привет! Как дела?', 'Я хочу рассказать о своих выходных.', 'Задай мне, пожалуйста, вопрос.'],
    en: ['Hi! How are you?', 'I want to talk about my weekend.', 'Ask me a question, please.'],
  },
}

export function starterSuggestions(targetLang: TargetLang, uiLang: 'ru' | 'en'): Suggestion[] {
  return STARTER_TEXTS[targetLang].map((text, i) => ({
    text,
    translation: STARTER_TRANSLATIONS[targetLang][uiLang][i],
  }))
}

export function MessageList({ messages, showTranslation, targetLang, uiLang, onReplay, onSuggest }: Props) {
  const t = useI18n()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const lastTutor = [...messages].reverse().find(m => m.role === 'tutor')
  const chips = lastTutor?.suggestions ?? []
  const starters = starterSuggestions(targetLang, uiLang)

  return (
    <section className="message-list">
      {messages.length === 0 && (
        <div className="empty-state">
          <h2>{t('appName')}</h2>
          <p>
            {t('emptyText')}
            <br />
            {t('emptyHint')}
          </p>
          <div className="suggestions suggestions-centered">
            {starters.map(s => (
              <button
                key={s.text}
                type="button"
                className="suggestion-chip"
                onClick={() => onSuggest(s.text)}
              >
                <span className="suggestion-de" lang={targetLang}>
                  {s.text}
                </span>
                {s.translation !== s.text && <span className="suggestion-ru">{s.translation}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      {messages.map(m => (
        <MessageBubble
          key={m.id}
          msg={m}
          showTranslation={showTranslation}
          targetLang={targetLang}
          onReplay={onReplay}
        />
      ))}
      {messages.length > 0 && chips.length > 0 && (
        <div className="row tutor">
          <div className="suggestions">
            <div className="suggestions-title">{t('suggestionsTitle')}</div>
            {chips.map((s, i) => (
              <button
                key={i}
                type="button"
                className="suggestion-chip"
                onClick={() => onSuggest(s.text)}
              >
                <span className="suggestion-de" lang={targetLang}>
                  {s.text}
                </span>
                {s.translation && <span className="suggestion-ru">{s.translation}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={endRef} />
    </section>
  )
}
