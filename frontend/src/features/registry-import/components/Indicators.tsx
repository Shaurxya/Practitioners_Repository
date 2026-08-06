import { cn } from '@/lib/cn'
import type {
  BatchStatus,
  ConfirmationCode,
  DiffVerdict,
  PageAnomaly,
  PageClassification,
} from '../types'

/**
 * Status vocabulary for the import pipeline.
 *
 * Same rule as StatusBadge: three channels, glyph plus label plus colour, never
 * colour alone. The console gets read in a grayscale screenshot pasted into a
 * support thread more often than anyone plans for.
 */

type Tone = 'verified' | 'pending' | 'review' | 'rejected' | 'neutral'

const TONE_CLASS: Record<Tone, string> = {
  verified: 'border-verified/45 bg-verified-soft text-content',
  pending: 'border-border-strong bg-pending-soft text-content',
  review: 'border-review/45 bg-review-soft text-content',
  rejected: 'border-rejected/45 bg-rejected-soft text-content',
  neutral: 'border-border bg-surface-raised text-content-muted',
}

const GLYPH_CLASS: Record<Tone, string> = {
  verified: 'text-verified',
  pending: 'text-pending',
  review: 'text-review',
  rejected: 'text-rejected',
  neutral: 'text-ash',
}

interface Presentation {
  glyph: string
  label: string
  tone: Tone
}

/**
 * Awaiting states are toned "review" rather than "pending", because they are
 * not waiting on a machine. They are waiting on the person reading the screen,
 * and that reads differently.
 */
export const BATCH_STATUS_PRESENTATION: Record<BatchStatus, Presentation> = {
  UPLOADED: { glyph: '○', label: 'Uploaded', tone: 'neutral' },
  CLASSIFYING: { glyph: '●', label: 'Classifying pages', tone: 'pending' },
  AWAITING_CLASSIFY_OK: { glyph: '▲', label: 'Review page mix', tone: 'review' },
  CLASSIFY_FAILED: { glyph: '✕', label: 'Cannot read PDF', tone: 'rejected' },
  AWAITING_MAPPING: { glyph: '▲', label: 'Confirm columns', tone: 'review' },
  PARSING: { glyph: '●', label: 'Extracting', tone: 'pending' },
  PARSED: { glyph: '●', label: 'Computing diff', tone: 'pending' },
  AWAITING_PROMOTE_OK: { glyph: '▲', label: 'Review rows', tone: 'review' },
  PARSE_FAILED: { glyph: '✕', label: 'Extraction failed', tone: 'rejected' },
  PROMOTING: { glyph: '●', label: 'Promoting', tone: 'pending' },
  // Toned review, not verified. Rows are live, but the batch is still waiting
  // on a person to read the ones held back, and a green badge on a job that is
  // not finished is how held rows get forgotten.
  PARTIALLY_PROMOTED: { glyph: '▲', label: 'Rows held back', tone: 'review' },
  PROMOTED: { glyph: '◆', label: 'Promoted', tone: 'verified' },
  PROMOTE_FAILED: { glyph: '✕', label: 'Promotion failed', tone: 'rejected' },
  CANCELLED: { glyph: '○', label: 'Cancelled', tone: 'neutral' },
}

const BASE = 'inline-flex items-center gap-1.5 rounded-none border font-medium'

export function BatchStatusBadge({
  status,
  className,
}: {
  status: BatchStatus
  className?: string
}) {
  const { glyph, label, tone } = BATCH_STATUS_PRESENTATION[status]
  return (
    <span className={cn(BASE, 'px-2 py-0.5 text-caption-sm', TONE_CLASS[tone], className)}>
      <span aria-hidden="true" className={GLYPH_CLASS[tone]}>
        {glyph}
      </span>
      {label}
    </span>
  )
}

const VERDICT_PRESENTATION: Record<DiffVerdict, Presentation> = {
  INSERT: { glyph: '+', label: 'New', tone: 'verified' },
  UPDATE: { glyph: '~', label: 'Changed', tone: 'review' },
  UNCHANGED: { glyph: '=', label: 'Unchanged', tone: 'neutral' },
  // Two staged rows landing on one natural key, or a staged row landing on two
  // live rows. Never promoted without a human choosing which one is right.
  CONFLICT: { glyph: '!', label: 'Conflict', tone: 'rejected' },
}

export function VerdictBadge({ verdict }: { verdict: DiffVerdict | null }) {
  if (!verdict) {
    return (
      <span className={cn(BASE, 'px-1.5 py-0.5 font-mono text-utility-xs', TONE_CLASS.neutral)}>
        <span aria-hidden="true" className={GLYPH_CLASS.neutral}>
          ?
        </span>
        Stale
      </span>
    )
  }
  const { glyph, label, tone } = VERDICT_PRESENTATION[verdict]
  return (
    <span
      className={cn(
        BASE,
        'px-1.5 py-0.5 font-mono text-utility-xs uppercase tracking-wider',
        TONE_CLASS[tone],
      )}
    >
      <span aria-hidden="true" className={GLYPH_CLASS[tone]}>
        {glyph}
      </span>
      {label}
    </span>
  )
}

export const CLASSIFICATION_LABEL: Record<PageClassification, string> = {
  TEXT_LAYER: 'Text layer',
  SCANNED: 'Scanned',
  UNREADABLE: 'Unreadable',
}

export const ANOMALY_COPY: Record<PageAnomaly, string> = {
  ZERO_ROWS: 'No rows extracted from this page',
  LOW_ROW_COUNT: 'Far fewer rows than this document averages',
  LOW_OCR_CONFIDENCE: 'OCR was unsure across most of the page',
  COLUMN_DRIFT: 'Column positions moved from the previous page',
  NO_TABLE_FOUND: 'No table structure detected',
  ROTATED: 'Page was rotated and had to be corrected',
}

export const CONFIRMATION_COPY: Record<ConfirmationCode, string> = {
  LOW_LICENSE_CONFIDENCE: 'OCR confidence on the licence number is below threshold',
  LICENSE_FORMAT_MISMATCH: 'Licence number does not match this register’s format',
  OCR_CONFUSABLE_CHARS: 'Licence number contains characters OCR commonly confuses',
  AMBIGUOUS_DATE: 'Date is ambiguous under this register’s convention',
  UNKNOWN_STATUS_VALUE: 'Status value is not in the profile vocabulary',
  LOW_ROW_CONFIDENCE: 'Several fields on this row scored low',
}

/**
 * A confidence value as a number plus a bar.
 *
 * The bar is not decoration. Comparing 0.71 against 0.68 by reading digits is
 * slow, and this table is read by scanning down a column. Colour is a third
 * channel on top of the number and the bar length, never the only one.
 */
export function Confidence({
  value,
  threshold = 0.9,
  className,
}: {
  value: number | null
  threshold?: number
  className?: string
}) {
  if (value === null) {
    return <span className={cn('font-mono text-2xs text-content-subtle', className)}>n/a</span>
  }

  const tone: Tone = value >= threshold ? 'verified' : value >= threshold - 0.2 ? 'review' : 'rejected'
  const fill = { verified: 'bg-verified', review: 'bg-review', rejected: 'bg-rejected' }[
    tone as 'verified' | 'review' | 'rejected'
  ]

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="font-mono text-2xs tabular-nums text-content">{value.toFixed(2)}</span>
      <span
        aria-hidden="true"
        className="h-1 w-10 shrink-0 overflow-hidden bg-surface-raised"
        title={`Confidence ${value.toFixed(2)}`}
      >
        <span className={cn('block h-full', fill)} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </span>
  )
}

/** A count with a monospace figure above a label. Used across the report screens. */
export function Stat({
  value,
  label,
  tone = 'neutral',
  hint,
}: {
  value: string | number
  label: string
  tone?: 'neutral' | 'warn' | 'bad' | 'good'
  hint?: string
}) {
  const valueClass = {
    neutral: 'text-content',
    good: 'text-verified',
    warn: 'text-review',
    bad: 'text-rejected',
  }[tone]

  return (
    <div className="border border-border bg-surface px-3 py-2.5">
      <div className={cn('font-mono text-heading-sm tabular-nums', valueClass)}>{value}</div>
      <div className="mono-label mt-1">{label}</div>
      {hint && <p className="mt-1 text-2xs text-content-muted">{hint}</p>}
    </div>
  )
}
