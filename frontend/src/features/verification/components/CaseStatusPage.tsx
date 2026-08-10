import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ImmortalIdDisplay } from '@/components/ui/ImmortalIdDisplay'
import { DetailRow, Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingPanel, Skeleton, errorCopy } from '@/components/ui/States'
import { formatDate } from '@/lib/formatters'
import { cn } from '@/lib/cn'
import { useVerificationCase } from '../hooks/useVerificationCase'
import { outcomeCopy } from '../outcome'
import { councilLabel, useCouncils } from '../councils'
import { countryName, medicalSystemName, useCountries, useMedicalSystems } from '../referenceData'
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
  // Falls back to the code, so the panel never waits on reference data.
  const councils = useCouncils()
  const countries = useCountries()
  const systems = useMedicalSystems()

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
    <div className="doc space-y-8">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          Case {detail.caseId.slice(0, 8)}
        </p>
        <h1>Your verification</h1>
        <p>
          <Link to="/cases" className="underline decoration-border-strong underline-offset-4">
            All my claims
          </Link>
        </p>
      </header>

      {/* The outcome, in the practitioner's terms. Never a rule code, never a
          bare tick. Every terminal state answers "so what do I do now". */}
      <section
        aria-live="polite"
        className={cn('border border-l-2 p-5', TONE_CLASS[copy.tone])}
      >
        <h2 className="text-heading-sm font-bold tracking-tight text-content">
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
          <ImmortalIdDisplay
            immortalId={detail.immortalId}
            size="lg"
            showParts
            copyable
            placeholder="Not yet issued. Your permanent ID will appear here and will not change afterwards."
          />
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
          <DetailRow label="Council" value={councilLabel(detail.claim.council, councils.data)} />
          {detail.claim.country && (
            <DetailRow label="Country" value={countryName(detail.claim.country, countries.data)} />
          )}
          {detail.claim.medicalSystem && (
            <DetailRow
              label="System of medicine"
              value={medicalSystemName(detail.claim.medicalSystem, systems.data)}
            />
          )}
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
