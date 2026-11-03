// Human-readable Drive formats: the app's data lands on Google Drive as
// files a person can open — cards.csv in Google Sheets, diary.md and
// chat-*.md in the Drive preview — while a hidden JSON anchor inside each
// Markdown block keeps the sync merge exact and lossless.

import type { DiaryEntry, VocabItem } from '../types'
import type { StoredMessage } from './store'
import type { TargetLang } from './langs'

// ---------- CSV ----------

function csvField(v: string): string {
  return v === '' || /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** RFC-4180-ish parser: quotes, doubled quotes, CRLF */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

// ---------- Markdown anchors ----------

/** JSON inside an HTML comment is invisible in the Drive preview; the
 *  `-->` sequence is escaped so a value can never break the comment. */
function anchor(tag: string, data: unknown): string {
  const json = JSON.stringify(data).replace(/-->/g, '--\\u003e')
  return `<!-- ${tag}:${json} -->`
}

function parseAnchors<T>(text: string, tag: string): T[] {
  const out: T[] = []
  const re = new RegExp(`<!-- ${tag}:(\\{.*?\\}) -->`, 'gs')
  for (const m of text.matchAll(re)) {
    try {
      out.push(JSON.parse(m[1]) as T)
    } catch {
      /* a damaged anchor must not break the whole pull */
    }
  }
  return out
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---------- Vocab → cards.csv ----------

const VOCAB_HEADER = [
  'uid',
  'word',
  'translation',
  'part_of_speech',
  'example',
  'example_translation',
  'known',
  'lang',
  'created_at',
  'updated_at',
]

export function vocabToCsv(items: VocabItem[]): string {
  return toCsv(
    VOCAB_HEADER,
    items.map(i => [
      i.uid,
      i.word,
      i.translation,
      i.part_of_speech,
      i.example,
      i.example_translation,
      i.known ? 'yes' : 'no',
      i.lang ?? 'de',
      i.created_at,
      i.updated_at ?? '',
    ]),
  )
}

export function vocabFromCsv(text: string): VocabItem[] {
  const rows = parseCsv(text)
  if (rows.length < 2) return []
  const idx = new Map(rows[0].map((h, c) => [h.trim(), c]))
  const get = (r: string[], k: string) => r[idx.get(k) ?? -1] ?? ''
  return rows.slice(1).map(r => ({
    id: 0,
    uid: get(r, 'uid'),
    word: get(r, 'word'),
    translation: get(r, 'translation'),
    part_of_speech: get(r, 'part_of_speech'),
    example: get(r, 'example'),
    example_translation: get(r, 'example_translation'),
    known: get(r, 'known') === 'yes',
    lang: (get(r, 'lang') || 'de') as TargetLang,
    created_at: get(r, 'created_at'),
    updated_at: get(r, 'updated_at') || get(r, 'created_at'),
  }))
}

// ---------- Diary → diary.md ----------

export function diaryToMd(entries: DiaryEntry[]): string {
  const byDate = new Map<string, DiaryEntry[]>()
  for (const e of entries) {
    const list = byDate.get(e.date) ?? []
    list.push(e)
    byDate.set(e.date, list)
  }
  const parts: string[] = ['# BlaBlaBot — дневник', '']
  for (const [date, list] of [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    parts.push(`## ${date}`, '')
    for (const e of list.sort((a, b) => (a.created_at < b.created_at ? -1 : 1))) {
      parts.push(
        `### ${timeOf(e.created_at)}`,
        anchor('diary', e),
        `**${e.text}**`,
        e.refined ? `*${e.refined}*` : '',
        e.corrected && e.corrected !== e.text ? `> Исправлено: ${e.corrected}` : '',
        e.translation ? `> ${e.translation}` : '',
        '',
      )
    }
  }
  return parts.filter(p => p !== '').join('\n') + '\n'
}

export function diaryFromMd(text: string): DiaryEntry[] {
  return parseAnchors<DiaryEntry>(text, 'diary')
}

// ---------- Chats → chat-{lang}.md ----------

export function historyToMd(lang: TargetLang, messages: StoredMessage[]): string {
  const parts: string[] = [`# BlaBlaBot — диалоги (${lang})`, '']
  let lastDate = ''
  for (const m of messages) {
    const d = new Date(m.created_at)
    const date = d.toISOString().slice(0, 10)
    if (date !== lastDate) {
      parts.push(`## ${date}`, '')
      lastDate = date
    }
    const translation = m.role === 'user' ? m.user_translation : m.translation
    parts.push(
      `### ${timeOf(m.created_at)} · ${m.role === 'user' ? 'Вы' : 'BlaBlaBot'}`,
      anchor('msg', m),
      `**${m.role === 'user' ? 'Вы' : 'BlaBlaBot'}:** ${m.text}`,
      translation ? `> ${translation}` : '',
      '',
    )
  }
  return parts.filter(p => p !== '').join('\n') + '\n'
}

export function historyFromMd(text: string): StoredMessage[] {
  return parseAnchors<StoredMessage>(text, 'msg')
}

// ---------- Activity → activity.csv ----------

export function activityToCsv(days: Record<string, number>): string {
  const rows = Object.entries(days)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, actions]) => [date, String(actions)])
  return toCsv(['date', 'actions'], rows)
}

export function activityFromCsv(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of parseCsv(text).slice(1)) {
    const n = Number.parseInt(r[1] ?? '', 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(r[0] ?? '') && Number.isFinite(n)) out[r[0]] = n
  }
  return out
}
