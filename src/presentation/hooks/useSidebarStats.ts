// Sidebar numbers (streak / unread cards / recent conversation). Recomputed
// on data-change events and when the tab or language changes.

import { useEffect, useState } from 'react'
import type { TargetLang } from '../../domain/models'
import { TARGET_LANG_LIST } from '../../domain/policies/languages'
import { useServices } from '../context'

export interface SidebarStats {
  streak: number
  cardCount: number
  hasConversation: boolean
}

/** Talking days this week: any chat message or diary entry counts. */
function streakDays(conversation: ReturnType<typeof useServices>['conversation'], diary: ReturnType<typeof useServices>['diaryRepo']): number {
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
    for (const m of conversation.recent(lang, 200)) touch(m.createdAt)
  }
  for (const e of diary.list()) touch(e.createdAt)
  return days.size
}

export function useSidebarStats(targetLang: TargetLang, active: string): SidebarStats {
  const services = useServices()
  const [stats, setStats] = useState<SidebarStats>({ streak: 0, cardCount: 0, hasConversation: false })

  useEffect(() => {
    const refresh = () => {
      setStats({
        streak: streakDays(services.conversation, services.diaryRepo),
        cardCount: services.vocab.list(targetLang).filter(i => !i.known).length,
        hasConversation: services.conversation.recent(targetLang, 1).length > 0,
      })
    }
    refresh()
    const unsubData = services.bus.subscribe(() => refresh())
    const unsubSync = services.sync.subscribe(() => refresh())
    return () => {
      unsubData()
      unsubSync()
    }
  }, [services, targetLang, active])

  return stats
}
