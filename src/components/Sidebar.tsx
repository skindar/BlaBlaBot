// The design's left sidebar: brand, primary navigation (Conversation /
// Cards / Diary), the current conversation, the weekly streak and the
// account button. Everything the old Sidebar did now lives in the
// navigation and the right inspiration panel.

import { useEffect, useState } from 'react'
import type { Settings } from '../types'
import { useI18n } from '../i18n'
import { BotMark, Icon, type IconName } from '../ui/design'
import { TARGET_LANG_LIST, langInfo } from '../lib/langs'
import { conversation, diary, vocab } from '../lib/store'

export type NavTab = 'conversation' | 'cards' | 'diary' | 'bench'

interface Props {
  settings: Settings
  active: NavTab
  /** Google sign-in gates the diary */
  googleSignedIn: boolean
  onNav: (tab: NavTab) => void
  onNewConversation: () => void
  onOpenSettings: () => void
}

/** Talking days this week: any chat message or diary entry counts */
function streakDays(): number {
  const now = new Date()
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const days = new Set<string>()
  const touch = (iso: string) => {
    const d = new Date(iso)
    if (d >= monday) days.add(d.toDateString())
  }
  for (const lang of TARGET_LANG_LIST) {
    for (const m of conversation.recent(lang, 200)) touch(m.created_at)
  }
  for (const e of diary.list()) touch(e.created_at)
  return days.size
}

export function Sidebar({
  settings,
  active,
  googleSignedIn,
  onNav,
  onNewConversation,
  onOpenSettings,
}: Props) {
  const t = useI18n()
  const [streak, setStreak] = useState(0)
  const [cardCount, setCardCount] = useState(0)
  const [hasConversation, setHasConversation] = useState(false)

  useEffect(() => {
    setStreak(streakDays())
    setCardCount(vocab.listAll(settings.targetLang).filter(i => !i.known).length)
    setHasConversation(conversation.recent(settings.targetLang, 1).length > 0)
  }, [settings.targetLang, active])

  const nav: Array<{ label: string; tab: NavTab; icon: IconName; badge?: number }> = [
    { label: t('navConversation'), tab: 'conversation', icon: 'messages' },
    { label: t('navCards'), tab: 'cards', icon: 'layers', badge: cardCount },
    { label: t('navDiary'), tab: 'diary', icon: 'book' },
  ]
  if (settings.showBench) nav.push({ label: t('tabBench'), tab: 'bench', icon: 'chart' })

  return (
    <aside className="scroll-sage sticky top-0 hidden h-dvh w-56 shrink-0 flex-col justify-between overflow-y-auto border-r border-[#e5e6de] bg-[#f1f0eb] px-4 pb-5 pt-8 lg:flex">
      <div>
        <div className="flex items-center gap-[9px] pl-2">
          <BotMark large />
          <span className="text-xl tracking-[-0.7px]">{t('appName')}</span>
        </div>

        <nav aria-label="Primary navigation" className="mt-8 space-y-[5px]">
          {nav.map(({ label, tab, icon, badge }) => {
            // the diary lives locally; Google is only for syncing it across
            // devices, so the tab is never locked
            const locked = false
            return (
              <button
                className={`flex h-[46px] w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
                  active === tab
                    ? 'bg-[#e5ece4] font-semibold text-[#526f60]'
                    : 'text-[#737970] hover:bg-[#e9e9e3]'
                } ${locked ? 'opacity-50' : ''}`}
                key={tab}
                onClick={() => !locked && onNav(tab)}
                title={locked ? t('diaryNeedsGoogle') : undefined}
                type="button"
              >
                <Icon name={icon} size={20} />
                <span className="flex-1 text-left">{label}</span>
                {typeof badge === 'number' && badge > 0 && (
                  <span className="text-xs font-normal">{badge}</span>
                )}
              </button>
            )
          })}
        </nav>

        <section className="mt-8 px-3">
          <h2 className="text-[11px] font-semibold tracking-[1px] text-[#94988f]">
            {t('recentTitle')}
          </h2>
          {hasConversation && (
            <button
              className="mt-[18px] block w-full text-left"
              onClick={() => onNav('conversation')}
              type="button"
            >
              <span className="block text-[13px]">
                {t('convTitle', { lang: langInfo(settings.targetLang).nativeName })}
              </span>
              <span className="mt-1.5 block text-[11px] text-[#737970]">{t('currentTopicLine')}</span>
            </button>
          )}
          <button
            className="mt-[18px] flex items-center gap-[7px] text-xs text-[#526f60]"
            onClick={onNewConversation}
            type="button"
          >
            <Icon name="plus" size={15} />
            {t('newConversation')}
          </button>
        </section>
      </div>

      <div>
        <section className="rounded-xl bg-[#faf9f6] p-4">
          <div className="flex items-center gap-2">
            <Icon name="sprout" size={18} />
            <h2 className="text-[13px] font-semibold">{t('streakTitle')}</h2>
          </div>
          <p className="mt-2.5 text-xs leading-[1.5] text-[#737970]">
            {t('streakText', { days: streak })}
          </p>
          {googleSignedIn && (
        <div className="mt-2.5 flex justify-between">
            {'MTWTFSS'.split('').map((day, index) => {
              const dayIdx = (new Date().getDay() + 6) % 7
              return (
                <div className="flex flex-col items-center gap-[7px]" key={`${day}-${index}`}>
                  <span className={`h-1 w-4 rounded-sm ${index < streak ? 'bg-[#526f60]' : 'bg-[#e5e6de]'}`} />
                  <span className={`text-[9px] ${index === dayIdx ? 'text-[#526f60]' : 'text-[#94988f]'}`}>
                    {day}
                  </span>
                </div>
              )
            })}
          </div>
      )}
        </section>
        <button
          className="mt-5 flex w-full items-center gap-2.5 px-2 text-left"
          onClick={onOpenSettings}
          type="button"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#e5e6de] text-[13px] font-semibold text-[#526f60]">
            {googleSignedIn ? '●' : '○'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px]">{t('appName')}</span>
            <span className="mt-[3px] block text-[11px] text-[#737970]">{t('yourSpace')}</span>
          </span>
          <Icon name="settings" size={18} />
        </button>
      </div>
    </aside>
  )
}
