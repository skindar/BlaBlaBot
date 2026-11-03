// First-launch onboarding: pick the UI language (RU/EN)
// and the target language to learn (de/en/fr/es/pt).

import { useState } from 'react'
import type { UiLang } from '../i18n'
import { useI18n } from '../i18n'
import { TARGET_LANG_LIST, langInfo, type TargetLang } from '../lib/langs'

interface Props {
  initialUiLang: UiLang
  onDone: (uiLang: UiLang, targetLang: TargetLang) => void
}

export function OnboardingModal({ initialUiLang, onDone }: Props) {
  const t = useI18n()
  const [uiLang, setUiLang] = useState<UiLang>(initialUiLang)
  const [targetLang, setTargetLang] = useState<TargetLang>('de')

  return (
    <div className="modal-overlay onboarding-overlay">
      <div className="modal onboarding-modal" role="dialog" aria-modal="true">
        <div className="onboarding-brand">
          <div className="brand-icon big">💬</div>
          <h1>{t('appName')}</h1>
          <p>{t('tagline')}</p>
        </div>

        <div className="onboarding-block">
          <h2>{t('onboardingUiLang')}</h2>
          <div className="lang-pills">
            <button
              type="button"
              className={`lang-pill${uiLang === 'ru' ? ' active' : ''}`}
              onClick={() => setUiLang('ru')}
            >
              🇷🇺 Русский
            </button>
            <button
              type="button"
              className={`lang-pill${uiLang === 'en' ? ' active' : ''}`}
              onClick={() => setUiLang('en')}
            >
              🇬🇧 English
            </button>
          </div>
        </div>

        <div className="onboarding-block">
          <h2>{t('onboardingStudy')}</h2>
          <div className="lang-cards">
            {TARGET_LANG_LIST.map(code => {
              const info = langInfo(code)
              return (
                <button
                  key={code}
                  type="button"
                  className={`lang-card${targetLang === code ? ' active' : ''}`}
                  onClick={() => setTargetLang(code)}
                >
                  <span className="lang-flag">{info.flag}</span>
                  <span className="lang-native">{info.nativeName}</span>
                </button>
              )
            })}
          </div>
        </div>

        <p className="onboarding-hint">{t('onboardingHint')}</p>

        <button type="button" className="card-btn primary onboarding-start" onClick={() => onDone(uiLang, targetLang)}>
          {t('onboardingStart')}
        </button>
      </div>
    </div>
  )
}
