// The design's right panel: today's topic (the active scenario), words to
// try (scenario vocabulary → flashcards) and the "make it yours" section
// (level, voice, diary mode, sync line).

import { useMemo, useState } from 'react'
import type { Level, Settings } from '../types'
import { useI18n } from '../i18n'
import { Icon } from '../ui/design'
import { langInfo, phononVoices, resolvePhononVoice } from '../lib/langs'
import { scenarioById, selectScenario, nextScenario, type Scenario } from '../lib/scenarios'
import { tutorSession } from '../lib/store'
import { getSyncStatus, subscribeSync } from '../lib/sync'

const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2']

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onAddWord: (word: string) => void
  onClose: () => void
}

/** The scenario the current conversation runs on */
function activeScenario(settings: Settings): Scenario {
  const session = tutorSession.get(settings.targetLang)
  return (session && scenarioById(session.scenarioId)) || selectScenario(settings.targetLang, settings.level, settings.extraPrompt)
}

export function RightPanel({ settings, onChange, onAddWord, onClose }: Props) {
  const t = useI18n()
  const [sync] = useState(getSyncStatus)
  const [levelOpen, setLevelOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)

  useMemo(() => subscribeSync, []) // keep the import; status refreshes on remount

  const lang = settings.targetLang
  const scenario = activeScenario(settings)
  const topicTitle = settings.uiLang === 'ru' ? scenario.titleTr.ru : scenario.titleTr.en
  const words = scenario.vocab.slice(0, 3)
  const phononBase = settings.phononBases[lang] ?? langInfo(lang).phononBase
  const voices = phononVoices(lang, phononBase)

  return (
    <aside className="scroll-sage sticky top-24 hidden h-[calc(100dvh-6rem)] w-80 shrink-0 flex-col justify-between overflow-y-auto border-l border-[#e5e6de] px-6 pb-7 pt-8 xl:flex">
      <div>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('inspirationTitle')}</h2>
          <button aria-label={t('closePanel')} onClick={onClose} type="button">
            <Icon name="panel" size={17} />
          </button>
        </div>

        <section className="mt-[27px] rounded-[20px] bg-[#f0f2e9] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold tracking-[1.2px] text-[#526f60]">
              {t('todaysTopic')}
            </h3>
            <Icon name="compass" size={19} />
          </div>
          <p className="mt-4 text-[22px] leading-[1.25] tracking-[-0.6px]">{topicTitle}</p>
          <div className="mt-3 flex h-[43px] items-center gap-3">
            <img alt="" className="h-[35px] w-40" src={`${import.meta.env.BASE_URL}assets/13225.svg`} />
            <Icon name="sun" size={25} />
          </div>
          <button
            className="mt-3 flex items-center gap-[7px] text-xs text-[#526f60]"
            onClick={() => {
              // switching the topic = switching the scenario via the topic field
              const next = nextScenario(scenario)
              onChange({ extraPrompt: next.title })
            }}
            type="button"
          >
            <Icon name="shuffle" size={14} />
            {t('exploreAnother')}
          </button>
        </section>

        <section className="mt-[27px]">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px]">{t('wordsToTry')}</h3>
            <Icon name="sparkles" size={15} />
          </div>
          <div className="mt-[17px] space-y-[17px]">
            {words.map(word => (
              <div className="flex items-center gap-2.5" key={word}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[#526f60]">{word}</p>
                </div>
                <button
                  aria-label={`${t('savePhrase')}: ${word}`}
                  className="rounded-full transition-colors hover:bg-[#dce7db]"
                  onClick={() => onAddWord(word)}
                  type="button"
                >
                  <Icon name="smallPlus" size={15} />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-[17px] text-[10px] leading-[1.5] text-[#94988f]">{t('tapToKeep')}</p>
        </section>
      </div>

      <section className="mt-10 border-t border-[#e5e6de] pt-5">
        <h3 className="text-[10px] font-semibold tracking-[1.1px] text-[#94988f]">
          {t('makeItYours')}
        </h3>

        <div className="relative">
          <button
            className="mt-5 flex w-full items-center gap-2.5 text-left"
            onClick={() => {
              setVoiceOpen(false)
              setLevelOpen(!levelOpen)
            }}
            type="button"
          >
            <Icon name="chart" size={17} />
            <span className="flex-1">
              <span className="block text-[11px] text-[#737970]">{t('convLevel')}</span>
              <span className="mt-[5px] block text-[13px] font-medium">{settings.level}</span>
            </span>
            <Icon name="smallChevron" size={14} />
          </button>
          {levelOpen && (
            <div className="absolute right-0 top-14 z-20 w-36 rounded-xl border border-[#e5e6de] bg-white p-1.5 text-xs shadow-lg">
              {LEVELS.map(level => (
                <button
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#f1f0eb]"
                  key={level}
                  onClick={() => {
                    onChange({ level })
                    setLevelOpen(false)
                  }}
                  type="button"
                >
                  {level}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            className="mt-5 flex w-full items-center gap-2.5 text-left"
            onClick={() => {
              setLevelOpen(false)
              setVoiceOpen(!voiceOpen)
            }}
            type="button"
          >
            <Icon name="audio" size={17} />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] text-[#737970]">{t('companionVoice')}</span>
              <span className="mt-[5px] block truncate text-[13px] font-medium">
                {resolvePhononVoice(lang, phononBase, settings.ttsVoices[lang])}
              </span>
            </span>
            <Icon name="smallChevron" size={14} />
          </button>
          {voiceOpen && (
            <div className="scroll-sage absolute right-0 top-14 z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-[#e5e6de] bg-white p-1.5 text-xs shadow-lg">
              {voices.map(v => (
                <button
                  className="block w-full truncate rounded-lg px-3 py-2 text-left hover:bg-[#f1f0eb]"
                  key={v.name}
                  onClick={() => {
                    onChange({ ttsVoices: { ...settings.ttsVoices, [lang]: v.name } })
                    setVoiceOpen(false)
                  }}
                  type="button"
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          className="mt-5 flex w-full items-center gap-2.5 text-left"
          onClick={() => onChange({ diaryMode: !settings.diaryMode })}
          type="button"
        >
          {settings.diaryMode ? (
            <span className="flex h-[18px] w-[30px] shrink-0 items-center justify-end rounded-full bg-[#526f60] p-0.5">
              <span className="size-3.5 rounded-full bg-white" />
            </span>
          ) : (
            <span className="flex h-[18px] w-[30px] shrink-0 items-center justify-start rounded-full bg-[#e5e6de] p-0.5">
              <span className="size-3.5 rounded-full bg-white" />
            </span>
          )}
          <span className="flex-1 text-[13px] font-medium">{t('diaryMode')}</span>
        </button>

        <div className="mt-5 flex items-start gap-2 text-[11px] leading-[1.5] text-[#737970]">
          <Icon name="smallBook" size={14} />
          <p>{sync.signedIn ? t('savedInDiary') : t('syncOffHint')}</p>
        </div>
      </section>
    </aside>
  )
}
