import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { OutcomeBadge, StatusBadge } from '@/components/ui/StatusBadge'
import { ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { ApiRequestError } from '@/lib/apiClient'
import { formatDateTime, formatScore } from '@/lib/formatters'
import { cn } from '@/lib/cn'
import { useDecideCase, useReviewCase } from '../hooks/useReviewQueue'
import { isTypingTarget } from '../hooks/useListKeyboardNav'
import { ComparisonPanel } from './ComparisonPanel'

/** Minimum reason length, mirroring the server constraint. */
const MIN_REASON = 10

type Armed = 'APPROVE' | 'REJECT' | null

export function ReviewDetailPage() {
  const { caseId } = useParams<{ caseId: string }>()
  const navigate = useNavigate()
  const query = useReviewCase(caseId)
  const decide = useDecideCase(caseId)

  const [candidateIndex, setCandidateIndex] = useState(0)
  const [reason, setReason] = useState('')
  const [armed, setArmed] = useState<Armed>(null)
  const [reasonError, setReasonError] = useState<string | null>(null)

  // Read defensively here because hooks must run before the loading guards
  // below. The narrowed value is taken again once the guards have passed.
  const candidates = query.data?.candidates ?? []
  const candidate = candidates[candidateIndex]

  useEffect(() => {
    setCandidateIndex(0)
    setReason('')
    setArmed(null)
    setReasonError(null)
  }, [caseId])

  function submit(decision: 'APPROVE' | 'REJECT') {
    if (reason.trim().length < MIN_REASON) {
      setReasonError('Add a reason before deciding. At least a sentence.')
      setArmed(null)
      return
    }
    setReasonError(null)
    decide.mutate(
      {
        decision,
        reason: reason.trim(),
        registryRecordId: candidate?.registryRecordId ?? null,
      },
      {
        onSuccess: (result) => {
          // Straight to the next case. A reviewer clearing forty of these
          // should never bounce back to the list in between.
          if (result.nextCaseId) void navigate(`/admin/review/${result.nextCaseId}`)
          else void navigate('/admin')
        },
      },
    )
  }

  /**
   * Two key confirmation rather than a modal: "a" arms the button, "a" again
   * commits, Escape cancels. A modal that steals focus and needs a click is
   * exactly the friction that makes case forty slower than case one.
   */
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (isTypingTarget(event.target)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur()
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        if (armed) setArmed(null)
        else void navigate('/admin')
        return
      }
      if (event.key === 'a') {
        event.preventDefault()
        if (armed === 'APPROVE') submit('APPROVE')
        else setArmed('APPROVE')
        return
      }
      if (event.key === 'r') {
        event.preventDefault()
        if (armed === 'REJECT') submit('REJECT')
        else setArmed('REJECT')
        return
      }
      if (event.key === 'Enter' && armed) {
        event.preventDefault()
        submit(armed)
        return
      }
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= candidates.length) {
        event.preventDefault()
        setCandidateIndex(digit - 1)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  })

  if (query.isPending) return <div className="pt-8"><LoadingPanel label="Loading case" /></div>

  if (query.isError) {
    const copy = errorCopy(query.error)
    return (
      <ErrorState
        title={copy.title}
        body={copy.body}
        onRetry={() => void query.refetch()}
      />
    )
  }

  const detail = query.data
  const conflict = decide.error instanceof ApiRequestError && decide.error.status === 409
  const alreadyDecided = detail.decidedAt !== null

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => void navigate('/admin')}>
            ← Queue
          </Button>
          <span className="font-mono text-xs text-content-muted">
            Case {detail.caseId.slice(0, 8)}
          </span>
          <StatusBadge status={detail.status} />
        </div>
        <span className="text-2xs text-content-subtle">
          submitted {formatDateTime(detail.submittedAt)}
        </span>
      </header>

      {conflict && (
        <div role="alert" className="rounded-[--radius-panel] border border-review/40 bg-review-soft px-4 py-3">
          <p className="text-xs font-medium text-content">
            This case was already decided by someone else.
          </p>
          <p className="mt-1 text-2xs text-content-muted">
            Your decision was not applied. Reloading the current state.
          </p>
          <Button size="sm" className="mt-2" onClick={() => void query.refetch()}>
            Reload case
          </Button>
        </div>
      )}

      {alreadyDecided && (
        <div className="rounded-[--radius-panel] border border-border bg-surface-raised px-4 py-2.5 text-xs text-content-muted">
          Decided {formatDateTime(detail.decidedAt as string)} by {detail.decidedBy ?? 'unknown'}.
          {detail.decisionReason && <span className="text-content"> {detail.decisionReason}</span>}
        </div>
      )}

      {candidates.length === 0 ? (
        <ErrorState
          title="No registry rows matched this claim"
          body="Nothing was found for this registration number and council. Close the case with a reason."
        />
      ) : (
        <>
          {/* Candidates are tabs, never a silently chosen winner. Approving the
              wrong practitioner is the failure this whole system exists to
              prevent, so the reviewer picks explicitly even when there is one. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs uppercase tracking-wider text-content-muted">
              Candidates
            </span>
            {candidates.map((item, index) => (
              <button
                key={item.registryRecordId}
                type="button"
                aria-pressed={index === candidateIndex}
                onClick={() => setCandidateIndex(index)}
                className={cn(
                  'rounded-[--radius-control] border px-2.5 py-1 font-mono text-2xs transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
                  index === candidateIndex
                    ? 'border-accent bg-row-selected text-content'
                    : 'border-border text-content-muted hover:bg-surface-raised',
                )}
              >
                {index + 1} · {item.registrationNumber} · {formatScore(item.nameScore)}
              </button>
            ))}
            {candidates.length > 1 && (
              <span className="text-2xs text-content-subtle">
                {candidates.length} matched, pick one
              </span>
            )}
          </div>

          {candidate && <ComparisonPanel detail={detail} candidate={candidate} />}
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Rules" bodyClassName="p-0">
          <ul className="divide-y divide-border">
            {detail.ruleResults.map((rule) => (
              <li key={rule.ruleCode} className="flex gap-3 px-4 py-2">
                <OutcomeBadge outcome={rule.outcome} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-mono text-2xs text-content">{rule.ruleCode}</p>
                  <p className="text-xs text-content-muted">{rule.detail}</p>
                </div>
              </li>
            ))}
            {detail.ruleResults.length === 0 && (
              <li className="px-4 py-3 text-xs text-content-muted">No rules were evaluated.</li>
            )}
          </ul>
        </Panel>

        <Panel title="Audit" bodyClassName="p-0">
          <ol className="divide-y divide-border">
            {detail.audit.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="px-4 py-2">
                <p className="text-2xs tabular-nums text-content-subtle">
                  {formatDateTime(entry.at)} · {entry.actor}
                </p>
                <p className="text-xs text-content">
                  {entry.fromStatus && entry.toStatus
                    ? `${entry.fromStatus} → ${entry.toStatus}`
                    : entry.eventType}
                </p>
                {entry.reason && <p className="text-xs text-content-muted">{entry.reason}</p>}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {!alreadyDecided && (
        <div className="sticky bottom-0 space-y-3 border-t-2 border-ink bg-surface p-4">
          <TextAreaField
            label="Reason"
            required
            hint="Shown in the audit trail with your name against it, permanently."
            value={reason}
            error={reasonError ?? undefined}
            onChange={(event) => {
              setReason(event.target.value)
              if (reasonError) setReasonError(null)
            }}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {armed && (
              <span className="mr-auto text-xs text-content-muted">
                Press {armed === 'APPROVE' ? 'a' : 'r'} again or Enter to confirm, Escape to cancel.
              </span>
            )}
            <Button
              variant={armed === 'APPROVE' ? 'primary' : 'secondary'}
              loading={decide.isPending && armed === 'APPROVE'}
              onClick={() => (armed === 'APPROVE' ? submit('APPROVE') : setArmed('APPROVE'))}
            >
              {armed === 'APPROVE' ? 'Confirm approve' : 'Approve'}
              <kbd className="ml-1 text-2xs text-content-subtle">a</kbd>
            </Button>
            <Button
              variant={armed === 'REJECT' ? 'danger' : 'secondary'}
              loading={decide.isPending && armed === 'REJECT'}
              onClick={() => (armed === 'REJECT' ? submit('REJECT') : setArmed('REJECT'))}
            >
              {armed === 'REJECT' ? 'Confirm reject' : 'Reject'}
              <kbd className="ml-1 text-2xs text-content-subtle">r</kbd>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
