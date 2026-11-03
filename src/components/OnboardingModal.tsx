// First-launch onboarding in the design's look: pick the UI language and
// the language to learn, then start. Cards, pills and the sage button.

import { useState } from 'react'
import type { UiLang } from '../i18n'
import { useI18n } from '../i18n'
import { TARGET_LANG_LIST, langInfo, type TargetLang } from '../lib/langs'
import { BotMark, SageButton } from '../ui/design'

interface Props {
  initialUiLang: UiLang
  onDone: (uiLang: UiLang, targetLang: TargetLang) => void
}

export function OnboardingModal({ initialUiLang, onDone }: Props) {
  const t = useI18n()
  const [uiLang, setUiLang] = useState<UiLang>(initialUiLang)
  const [targetLang, setTargetLang] = useState<TargetLang>('de')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/25 p-4">
      <div className="w-full max-w-lg rounded-[24px] border border-[#e5e6de] bg-[#faf9f6] p-8 text-center shadow-2xl sm:p-10">
        <div className="mx-auto flex w-fit">
          <BotMark large />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.6px]">{t('appName')}</h1>
        <p className="mt-2 text-sm leading-6 text-[#737970]">{t('tagline')}</p>

        <div className="mt-8 text-left">
          <h2 className="text-[11px] font-semibold tracking-[1px] text-[#94988f]">
            {t('onboardingUiLang').toUpperCase()}
          </h2>
          <div className="mt-3 flex gap-2.5">
            {(['ru', 'en'] as const).map(code => (
              <button
                className={`flex-1 rounded-2xl border px-4 py-3 text-sm transition-colors ${
                  uiLang === code
                    ? 'border-[#526f60] bg-[#e5ece4] font-semibold text-[#526f60]'
                    : 'border-[#e5e6de] bg-white text-[#737970] hover:border-[#526f60]'
                }`}
                key={code}
                onClick={() => setUiLang(code)}
                type="button"
              >
                {code === 'ru' ? '🇷🇺 Русский' : '🇬🇧 English'}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 text-left">
          <h2 className="text-[11px] font-semibold tracking-[1px] text-[#94988f]">
            {t('onboardingStudy').toUpperCase()}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {TARGET_LANG_LIST.map(code => {
              const info = langInfo(code)
              return (
                <button
                  className={`flex flex-col items-center gap-1.5 rounded-2xl border px-3 py-4 transition-colors ${
                    targetLang === code
                      ? 'border-[#526f60] bg-[#e5ece4]'
                      : 'border-[#e5e6de] bg-white hover:border-[#526f60]'
                  }`}
                  key={code}
                  onClick={() => setTargetLang(code)}
                  type="button"
                >
                  <span className="text-2xl">{info.flag}</span>
                  <span className={`text-[13px] ${targetLang === code ? 'font-semibold text-[#526f60]' : 'text-[#737970]'}`}>
                    {info.nativeName}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <p className="mt-6 text-[11px] leading-relaxed text-[#94988f]">{t('onboardingHint')}</p>
        <SageButton className="mt-5 w-full" onClick={() => onDone(uiLang, targetLang)}>
          {t('onboardingStart')}
        </SageButton>
      </div>
    </div>
  )
}
