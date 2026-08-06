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

/**
 * Compact form for dense tables: 29 Jul, 14:02.
 *
 * Returns a dash rather than throwing on a value it cannot parse. Intl throws
 * RangeError on an Invalid Date, and inside a render that takes down the whole
 * route: one badly shaped timestamp from one endpoint replaced the entire case
 * review screen with a 404 page. A missing date should read as missing.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '–'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '–'

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  }).format(date)
}

/** Never render a bare tick. Verification is always "as of" a point in time. */
export function formatVerifiedAsOf(iso: string, sourceBatch: string): string {
  return `Verified as of ${formatDate(iso)}, source ${sourceBatch}`
}

/** 0.912 -> "0.91". Scores are compared by eye in the console, so pad them. */
export function formatScore(score: number): string {
  return score.toFixed(2)
}
