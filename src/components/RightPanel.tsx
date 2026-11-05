// The design's right panel: today's topic (the active scenario), words to
// try (scenario vocabulary → flashcards) and the "make it yours" section
// (level, voice, diary mode, sync line).

import { useMemo, useState } from 'react'
import type { Level, Settings } from '../types'
import { useI18n } from '../i18n'
import { Icon } from '../ui/design'
import { langInfo, phononVoices, resolvePhononVoice } from '../lib/langs'
import { PIPER_VOICES, piperVoiceOrDefault } from '../lib/piperTts'
import { scenarioById, selectScenario, nextScenario, type Scenario } from '../lib/scenarios'
import { TopicFigure } from './TopicFigure'
import { tutorSession } from '../lib/store'
import { getSyncStatus, subscribeSync } from '../lib/sync'

const LEVELS: Level[] = ['A1', 'A2', 'B1', 'B2']

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onAddWord: (word: string) => void
  onClose: () => void
}

/** The scenario shown in the panel: the freshly picked topic wins over the
 *  running session (a click must be visible immediately), the session wins
 *  once it actually runs the picked topic. */
function activeScenario(settings: Settings): Scenario {
  const lang = settings.targetLang
  const pickedId = settings.topics?.[lang]
  const session = tutorSession.get(lang)
  const sessionScenario = session && scenarioById(session.scenarioId)
  if (pickedId) {
    if (sessionScenario && session.topicKey === pickedId) return sessionScenario
    return scenarioById(pickedId) ?? sessionScenario ?? selectScenario(lang, settings.level, settings.extraPrompt)
  }
  return sessionScenario || selectScenario(lang, settings.level, settings.extraPrompt)
}

export function RightPanel({ settings, onChange, onAddWord, onClose }: Props) {
  const t = useI18n()
  const [sync] = useState(getSyncStatus)
  const [levelOpen, setLevelOpen] = useState(false)
  const [voiceOpen, setVoiceOpen] = useState(false)
  // every "explore another topic" click also rebuilds the lattice figure
  const [figureSeed, setFigureSeed] = useState(0)
  const rotate = () => {
    // the picked topic is an id, sticky per language: it never snaps back to
    // an older one and survives reloads and "New conversation"
    const next = nextScenario(scenario)
    onChange({ topics: { ...settings.topics, [lang]: next.id } })
    setFigureSeed(f => f + 1)
  }

  useMemo(() => subscribeSync, []) // keep the import; status refreshes on remount

  const lang = settings.targetLang
  const scenario = activeScenario(settings)
  const topicTitle = settings.uiLang === 'ru' ? scenario.titleTr.ru : scenario.titleTr.en
  const words = scenario.vocab.slice(0, 3)
  const phononBase = settings.phononBases[lang] ?? langInfo(lang).phononBase
  // Russian speaks through Piper, so the picker lists Piper voices there
  const piperList = PIPER_VOICES[lang]
  const voices = piperList && piperList.length > 0
    ? piperList.map(v => ({ name: v.id, url: '' }))
    : phononVoices(lang, phononBase)
  const savedVoice = piperList && piperList.length > 0
    ? piperVoiceOrDefault(lang, settings.ttsVoices[lang])
    : resolvePhononVoice(lang, phononBase, settings.ttsVoices[lang])
  const voiceLabelText = piperList && piperList.length > 0
    ? (piperList.find(v => v.id === savedVoice)?.label ?? savedVoice)
    : savedVoice

  return (
    /* h-full, not h-dvh: the panel lives below the 96px header, inside the
       middle section's content row. h-full spans exactly the row's height
       (viewport minus header), so the bottom stays on screen and the
       scroller below reaches every element. */
    <aside className="hidden h-full w-80 shrink-0 flex-col border-l border-[#e5e6de] xl:flex">
      <div className="scroll-sage min-h-0 flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col px-6 pb-7 pt-8">
      <div className="shrink-0">
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
          <button
            className="mt-4 block w-full text-left"
            onClick={rotate}
            title={t('exploreAnother')}
            type="button"
          >
            <p className="text-[22px] leading-[1.25] tracking-[-0.6px]">{topicTitle}</p>
          </button>
          <div className="mt-4 flex justify-center">
            <TopicFigure seed={figureSeed} />
          </div>
          <button
            className="mt-3 flex items-center gap-[7px] text-xs text-[#526f60]"
            onClick={rotate}
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

      <section className="mt-auto shrink-0 border-t border-[#e5e6de] pt-5">
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
                {voiceLabelText}
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
      </div>
      </div>
    </aside>
  )
}
