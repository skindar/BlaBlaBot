// Diary service: entry management + the on-demand "refined page" (literary
// rewrite + grounded facts + translation).

import type { ClockPort, DiaryRepository } from '../ports'
import type { DiaryPage, DiaryRefineResult, Level, TargetLang, UiLang } from '../../domain/models'
import type { TurnService } from './TurnService'

export interface RefineOptions {
  lang: TargetLang
  date: string
  level: Level
  uiLang: UiLang
  llmKey: string
}

export class DiaryService {
  constructor(
    private readonly deps: {
      diary: DiaryRepository
      turns: TurnService
      clock: ClockPort
    },
  ) {}

  entries(lang?: TargetLang) {
    return this.deps.diary.list(lang)
  }

  remove(uid: string): boolean {
    return this.deps.diary.remove(uid)
  }

  page(lang: TargetLang, date: string): DiaryPage | null {
    return this.deps.diary.page(lang, date)
  }

  prunePages(lang: TargetLang, dates: Set<string>): void {
    this.deps.diary.prunePages(lang, dates)
  }

  /** Raw lines for a day, corrected versions winning when present. */
  linesFor(lang: TargetLang, date: string): string[] {
    return this.deps.diary
      .list(lang)
      .filter(e => e.date === date)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .map(e => e.corrected || e.text)
      .filter(Boolean)
  }

  /** Refine the day and cache the page. Throws when the model is unavailable. */
  async refine(opts: RefineOptions): Promise<DiaryPage> {
    const lines = this.linesFor(opts.lang, opts.date)
    const result: DiaryRefineResult = await this.deps.turns.refineDiary({
      lines,
      level: opts.level,
      targetLang: opts.lang,
      uiLang: opts.uiLang,
      llmKey: opts.llmKey,
    })
    const page: DiaryPage = {
      lang: opts.lang,
      date: opts.date,
      text: result.text,
      facts: result.facts,
      translation: result.translation,
      updatedAt: this.deps.clock.nowIso(),
    }
    this.deps.diary.savePage(page)
    return page
  }
}
