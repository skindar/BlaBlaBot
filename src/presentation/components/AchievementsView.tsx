// Achievements tab: the evolution tree — fragments → skills → mastery → legacy.
// Data comes from AchievementsService (pure policy evaluation over stats).

import { useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import { useServices } from '../context'
import {
  BRANCH_LABELS,
  type AchievementProgress,
} from '../../domain/policies/achievements'
import type { AchievementTier } from '../../domain/policies/achievementsBranches'

const TIER_ORDER: AchievementTier[] = ['legacy', 'mastery', 'skill', 'fragment']
const TIER_LABEL: Record<AchievementTier, string> = {
  fragment: '🌱 Фрагменты',
  skill: '🔧 Навыки',
  mastery: '🛡️ Мастерство',
  legacy: '👑 Легенды',
}

function Card({ p }: { p: AchievementProgress }) {
  const t = useI18n()
  const pct = Math.round((p.progress ?? (p.unlocked ? 1 : 0)) * 100)
  return (
    <div
      className="rounded-2xl border border-[#e5e6de] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
      style={{ opacity: p.unlocked ? 1 : 0.72 }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl leading-none">{p.unlocked ? p.def.icon : '🔒'}</span>
          <span className="text-xs text-[#737970]">{BRANCH_LABELS[p.def.branch]}</span>
        </div>
        <span className="text-xs font-semibold text-[#526f60]">+{p.def.xp} XP</span>
      </div>
      <h3 className="text-sm font-bold text-[#2f3a33]">{p.def.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-[#737970]">{p.def.desc}</p>
      {p.def.parents.length > 0 && (
        <p className="mt-2 text-[11px] text-[#9aa39b]">
          🧬 {t('achFrom')}: {p.def.parents.join(' + ')}
        </p>
      )}
      {p.def.metric && !p.unlocked && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e5e6de]">
            <div className="h-full rounded-full bg-[#526f60]" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-[#9aa39b]">{pct}%</div>
        </div>
      )}
      <div className="mt-2 text-[11px] text-[#9aa39b]">
        {p.unlocked && p.date
          ? `${t('achUnlocked')}: ${new Date(p.date + 'T00:00:00').toLocaleDateString()}`
          : t('achLocked')}
      </div>
    </div>
  )
}

export function AchievementsView({ active, uiLang: _uiLang }: { active: boolean; uiLang: string }) {
  const services = useServices()
  const t = useI18n()
  const [snap, setSnap] = useState(() => services.achievements.snapshot())

  useEffect(() => {
    if (!active) return
    const refresh = (): void => setSnap(services.achievements.snapshot())
    refresh()
    const unsub = services.bus.subscribe(refresh)
    const unsubSync = services.sync.subscribe(refresh)
    return () => {
      unsub()
      unsubSync()
    }
  }, [services, active])

  if (!active) return null
  const goal = snap.nextGoal

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-10 pt-6">
      <div className="mb-5 rounded-2xl bg-[#e9efe7] p-4">
        <div className="text-2xl font-extrabold text-[#2f3a33]">{snap.xp} XP</div>
        {goal && (
          <div className="mt-1 text-sm text-[#526f60]">
            {t('achNextGoal')}: {goal.title} ({Math.round(goal.progress * 100)}%)
          </div>
        )}
      </div>

      {TIER_ORDER.map(tier => {
        const items = snap.progress.filter(p => p.def.tier === tier)
        if (!items.length) return null
        return (
          <section key={tier} className="mb-7">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#737970]">
              {TIER_LABEL[tier]}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map(p => (
                <Card key={p.def.id} p={p} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
