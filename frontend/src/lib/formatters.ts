/**
 * Display formatting. Lives here so "verified as of DATE" is worded identically
 * everywhere it appears.
 *
 * en-GB and a fixed UTC timezone rather than the browser locale, so a reviewer
 * in one timezone and a practitioner in another read the same case as having
 * happened at the same moment. Localising this later is a deliberate decision,
 * not something to inherit by accident from whoever's laptop rendered it.
 */
const TZ = 'UTC'

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  }).format(new Date(iso))
}

/** Compact form for dense tables: 29 Jul, 14:02. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  }).format(new Date(iso))
}

/** Never render a bare tick. Verification is always "as of" a point in time. */
export function formatVerifiedAsOf(iso: string, sourceBatch: string): string {
  return `Verified as of ${formatDate(iso)}, source ${sourceBatch}`
}

/** 0.912 -> "0.91". Scores are compared by eye in the console, so pad them. */
export function formatScore(score: number): string {
  return score.toFixed(2)
}
