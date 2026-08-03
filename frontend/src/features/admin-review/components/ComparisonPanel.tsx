import { cn } from '@/lib/cn'
import type { MatchCandidate, ReviewCaseDetail } from '../types'

/**
 * The comparison is the single view a reviewer's decision rests on, so it sits
 * full width at the top and must be readable without scrolling.
 *
 * It splits into two bands. Fields that agree sit quiet at the top and exist
 * only to confirm identity. Fields that differ, or that a rule acted on, drop
 * into a marked band below, so the reviewer's eye goes straight to what matters
 * instead of hunting down a flat list in registry column order.
 *
 * Rows where the practitioner claimed nothing still render, showing
 * "not claimed", because dropping them would break the column alignment that
 * makes the whole layout work.
 */
interface Row {
  label: string
  claim: string | null
  registry: string | null
  /** Forces the row into the marked band even when the strings match. */
  flag?: string
  mono?: boolean
}

function buildRows(detail: ReviewCaseDetail, candidate: MatchCandidate): Row[] {
  const expired =
    candidate.validUntil !== null && new Date(candidate.validUntil).getTime() < Date.now()

  return [
    { label: 'Name', claim: detail.claim.fullName, registry: candidate.fullName },
    {
      label: 'Normalized name',
      claim: detail.claim.normalizedName,
      registry: candidate.fullName.toUpperCase(),
      mono: true,
    },
    {
      label: 'Registration no.',
      claim: detail.claim.registrationNumber,
      registry: candidate.registrationNumber,
      mono: true,
    },
    { label: 'Council', claim: detail.claim.council, registry: candidate.council },
    { label: 'Specialty', claim: detail.claim.specialty, registry: candidate.specialty },
    {
      label: 'Valid until',
      claim: null,
      registry: candidate.validUntil,
      ...(expired ? { flag: 'expired' } : {}),
    },
    {
      label: 'Register status',
      claim: null,
      registry: candidate.status,
      ...(candidate.status !== 'ACTIVE' ? { flag: 'not active' } : {}),
    },
  ]
}

function differs(row: Row): boolean {
  if (row.flag) return true
  if (row.claim === null || row.registry === null) return false
  return row.claim.trim().toUpperCase() !== row.registry.trim().toUpperCase()
}

function FieldRow({ row, marked }: { row: Row; marked: boolean }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-x-4 border-b border-border px-3 py-1.5 last:border-0 sm:grid-cols-[8rem_1fr_1fr]',
        marked && 'bg-diff-changed',
      )}
    >
      <span className="text-2xs uppercase tracking-wide text-content-muted">{row.label}</span>
      <span className={cn('text-xs text-content', row.mono && 'font-mono tabular-nums')}>
        {row.claim ?? <span className="text-content-subtle">not claimed</span>}
      </span>
      <span className="flex items-baseline justify-between gap-2">
        <span className={cn('text-xs text-content', row.mono && 'font-mono tabular-nums')}>
          {row.registry ?? <span className="text-content-subtle">-</span>}
        </span>
        {marked ? (
          <span className="shrink-0 text-2xs font-medium text-review">
            {row.flag ? `▲ ${row.flag}` : '▲ differs'}
          </span>
        ) : (
          <span className="shrink-0 text-2xs text-content-subtle">✓ same</span>
        )}
      </span>
    </div>
  )
}

export function ComparisonPanel({
  detail,
  candidate,
}: {
  detail: ReviewCaseDetail
  candidate: MatchCandidate
}) {
  const rows = buildRows(detail, candidate)
  const same = rows.filter((row) => !differs(row))
  const different = rows.filter(differs)

  return (
    <section className="overflow-hidden rounded-[--radius-panel] border border-border bg-surface">
      <header className="grid grid-cols-1 gap-x-4 border-b border-border bg-surface-raised px-3 py-2 sm:grid-cols-[8rem_1fr_1fr]">
        <span className="text-2xs uppercase tracking-wider text-content-subtle">Field</span>
        <span className="text-2xs font-semibold uppercase tracking-wider text-content-muted">
          Claim, as submitted
        </span>
        <span className="text-2xs font-semibold uppercase tracking-wider text-content-muted">
          Registry row
        </span>
      </header>

      <div>
        {same.map((row) => (
          <FieldRow key={row.label} row={row} marked={false} />
        ))}
        {different.length > 0 && (
          <div className="border-t-2 border-diff-changed-border">
            {different.map((row) => (
              <FieldRow key={row.label} row={row} marked />
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-border bg-surface-raised px-3 py-1.5 font-mono text-2xs text-content-subtle">
        batch {candidate.sourceBatch} · synced {candidate.syncedAt.slice(0, 10)} · present in latest
        batch: {candidate.presentInLatestBatch ? 'yes' : 'no'}
      </footer>
    </section>
  )
}
