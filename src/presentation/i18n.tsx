// React wiring around the framework-free string catalog in shared/i18nStrings.
// Components use useI18n(); non-React code keeps using tr()/libT().

import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { UiLang } from '../domain/models'
import { makeT, type TFunc } from '../shared/i18nStrings'

export * from '../shared/i18nStrings'
export type { UiLang } from '../domain/models'

const I18nContext = createContext<TFunc>(makeT('ru'))
const I18N_CACHE: Partial<Record<UiLang, TFunc>> = {}

export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }): JSX.Element {
  const t = I18N_CACHE[lang] ?? (I18N_CACHE[lang] = makeT(lang))
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>
}

export function useI18n(): TFunc {
  return useContext(I18nContext)
}
