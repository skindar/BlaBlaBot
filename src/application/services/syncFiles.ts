// The Drive file-name contract (human-readable files the user can open).

export function historyFileName(lang: string): string {
  return `chat-${lang}.md`
}

export const VOCAB_FILE = 'cards.csv'
export const DIARY_FILE = 'diary.md'
export const ACTIVITY_FILE = 'activity.csv'
