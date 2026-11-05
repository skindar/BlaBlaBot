import { useEffect, useState } from 'react'
import type { ChatSummary, TargetLang } from '../../domain/models'
import { useServices } from '../context'

/** Current chat first, then archived chats of this language (newest first). */
export function useChatArchives(lang: TargetLang, active: string): ChatSummary[] {
  const services = useServices()
  const [chats, setChats] = useState<ChatSummary[]>([])

  useEffect(() => {
    const refresh = () => {
      const current = services.conversation.currentChat(lang)
      setChats([current, ...services.conversation.archives(lang)])
    }
    refresh()
    return services.bus.subscribe(refresh)
  }, [services, lang, active])

  return chats
}
