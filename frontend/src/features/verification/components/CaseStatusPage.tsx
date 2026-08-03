import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { DetailRow, Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingPanel, Skeleton, errorCopy } from '@/components/ui/States'
import { formatDate } from '@/lib/formatters'
import { cn } from '@/lib/cn'
import { useVerificationCase } from '../hooks/useVerificationCase'
import { outcomeCopy } from '../outcome'
import { councilLabel } from '../councils'
import { ProgressTracker } from './ProgressTracker'
import type { OutcomeCopy } from '../outcome'

const TONE_CLASS: Record<OutcomeCopy['tone'], string> = {
  progress: 'border-border bg-surface-raised',
  good: 'border-verified/40 bg-verified-soft',
  warn: 'border-review/40 bg-review-soft',
  bad: 'border-rejected/40 bg-rejected-soft',
}

export function CaseStatusPage() {
  const { caseId } = useParams<{ caseId: string }>()
  const query = useVerificationCase(caseId)

  if (query.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-32 w-full" />
        <LoadingPanel label="Loading your claim" />
      </div>
    )
  }

  if (query.isError) {
    const copy = errorCopy(query.error)
    return (
      <ErrorState title={copy.title} body={copy.body} onRetry={() => void query.refetch()} />
    )
  }

  const detail = query.data
  const copy = outcomeCopy(detail.outcomeCode)
  const isVerified = detail.outcomeCode === 'VERIFIED'

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <Link to="/cases" className="text-sm text-content-muted underline underline-offset-2">
          All my claims
        </Link>
        <h1 className="text-xl font-semibold text-content">Your verification</h1>
        <p className="font-mono text-sm text-content-subtle">
          Case reference {detail.caseId.slice(0, 8)}
        </p>
      </header>

      {/* The outcome, in the practitioner's terms. Never a rule code, never a
          bare tick. Every terminal state answers "so what do I do now". */}
      <section
        aria-live="polite"
        className={cn('rounded-[--radius-panel] border p-5', TONE_CLASS[copy.tone])}
      >
        <h2 className="text-lg font-semibold text-content">
          {isVerified && detail.verifiedAsOf
            ? `Verified as of ${formatDate(detail.verifiedAsOf)}`
            : copy.headline}
        </h2>
        <p className="mt-2 text-base text-content-muted">{copy.body}</p>
        <p className="mt-3 text-base text-content">{copy.action}</p>

        {isVerified && detail.registrySourceBatch && (
          <p className="mt-3 font-mono text-sm text-content-subtle">
            Register batch {detail.registrySourceBatch}
          </p>
        )}

        {!copy.terminal && (
          <p className="mt-4 flex items-center gap-2 text-sm text-content-subtle">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-content-subtle"
            />
            Checking automatically. This page updates on its own.
          </p>
        )}
      </section>

      {isVerified && (
        <Panel title="Immortal ID">
          {detail.immortalId ? (
            <p className="font-mono text-lg tracking-wider text-content">{detail.immortalId}</p>
          ) : (
            // Marked placeholder, not an empty field and not a fake value.
            <p className="text-base text-content-muted">
              Not yet issued. Your permanent ID will appear here and will not change afterwards.
            </p>
          )}
        </Panel>
      )}

      <Panel title="Progress">
        <ProgressTracker progress={detail.progress} />
      </Panel>

      <Panel title="What you submitted">
        <dl className="divide-y divide-border">
          <DetailRow label="Full name" value={detail.claim.fullName} />
          <DetailRow
            label="Registration number"
            value={<span className="font-mono tabular-nums">{detail.claim.registrationNumber}</span>}
          />
          <DetailRow label="Council" value={councilLabel(detail.claim.council)} />
          <DetailRow label="Specialty" value={detail.claim.specialty} />
          <DetailRow label="Submitted" value={formatDate(detail.submittedAt)} />
        </dl>
      </Panel>

      {copy.terminal && detail.outcomeCode !== 'VERIFIED' && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="primary" size="lg" onClick={() => (window.location.href = '/')}>
            Submit a new claim
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void query.refetch()}>
            Check again
          </Button>
        </div>
      )}
    </div>
  )
}
