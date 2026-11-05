// Shared achievement enums — kept apart so the policy file imports the tier
// types without a self-import cycle.

export type AchievementTier = 'fragment' | 'skill' | 'mastery' | 'legacy'
export type AchievementBranch = 'deutsch' | 'career' | 'creator' | 'body' | 'mind' | 'tools'
