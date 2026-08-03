import type { CaseStatus, RuleOutcome } from '@/types/caseStatus'
import { cn } from '@/lib/cn'

/**
 * Status is carried by three channels: a glyph, a text label, and colour.
 * Never colour alone. Some reviewers will not distinguish red from green, and
 * the console gets read in a grayscale screenshot pasted into a support thread
 * more often than anyone plans for.
 */
type Tone = 'verified' | 'pending' | 'review' | 'rejected' | 'neutral'

const TONE_CLASS: Record<Tone, string> = {
  verified: 'bg-verified-soft text-content',
  pending: 'bg-pending-soft text-content',
  review: 'bg-review-soft text-content',
  rejected: 'bg-rejected-soft text-content',
  neutral: 'bg-surface-raised text-content-muted',
}

interface Presentation {
  glyph: string
  label: string
  tone: Tone
}

/**
 * Internal status vocabulary, for the review console only. These are database
 * words and a practitioner must never see them: the portal maps to plain
 * language through features/verification/outcome.ts instead.
 */
export const CASE_STATUS_PRESENTATION: Record<CaseStatus, Presentation> = {
  SUBMITTED: { glyph: '●', label: 'Submitted', tone: 'pending' },
  MATCHING: { glyph: '●', label: 'Matching', tone: 'pending' },
  RULES_EVAL: { glyph: '●', label: 'Evaluating rules', tone: 'pending' },
  NO_MATCH: { glyph: '○', label: 'No match', tone: 'neutral' },
  MANUAL_REVIEW: { glyph: '▲', label: 'Manual review', tone: 'review' },
  AUTO_VERIFIED: { glyph: '◆', label: 'Auto verified', tone: 'verified' },
  APPROVED: { glyph: '◆', label: 'Approved', tone: 'verified' },
  REJECTED: { glyph: '■', label: 'Rejected', tone: 'rejected' },
  EXPIRED: { glyph: '○', label: 'Expired', tone: 'neutral' },
  REVOKED: { glyph: '■', label: 'Revoked', tone: 'rejected' },
  FAILED: { glyph: '✕', label: 'Failed', tone: 'rejected' },
}

export const RULE_OUTCOME_PRESENTATION: Record<RuleOutcome, Presentation> = {
  PASS: { glyph: '✓', label: 'Pass', tone: 'verified' },
  REVIEW: { glyph: '▲', label: 'Review', tone: 'review' },
  FAIL: { glyph: '✕', label: 'Fail', tone: 'rejected' },
  SKIPPED: { glyph: '○', label: 'Skipped', tone: 'neutral' },
}

const BASE = 'inline-flex items-center gap-1.5 rounded-[--radius-control] font-medium'

export function StatusBadge({
  status,
  className,
}: {
  status: CaseStatus
  className?: string
}) {
  const { glyph, label, tone } = CASE_STATUS_PRESENTATION[status]
  return (
    <span className={cn(BASE, 'px-2 py-0.5 text-xs', TONE_CLASS[tone], className)}>
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  )
}

export function OutcomeBadge({
  outcome,
  className,
}: {
  outcome: RuleOutcome
  className?: string
}) {
  const { glyph, label, tone } = RULE_OUTCOME_PRESENTATION[outcome]
  return (
    <span className={cn(BASE, 'px-1.5 py-0.5 text-2xs uppercase', TONE_CLASS[tone], className)}>
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  )
}
