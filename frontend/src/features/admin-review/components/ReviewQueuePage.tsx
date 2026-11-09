import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { formatDateTime } from '@/lib/formatters'
import { cn } from '@/lib/cn'
import { CASE_STATUS } from '@/types/caseStatus'
import type { CaseStatus } from '@/types/caseStatus'
import { QUEUE_PAGE_SIZE } from '../api/adminReviewApi'
import { useReviewQueue } from '../hooks/useReviewQueue'
import type { ReviewQueueFilter } from '../types'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'

/**
 * A no match case is exactly what a human is for, so it defaults into the queue
 * alongside manual review rather than being something you have to go and find.
 */
const DEFAULT_STATUSES: CaseStatus[] = ['MANUAL_REVIEW', 'NO_MATCH']

/**
 * Filter state lives in the URL so a reviewer can share or bookmark a view, and
 * so the back button behaves. It is the single source of truth: there is no
 * mirrored useState that could disagree with it.
 */
function filterFromParams(params: URLSearchParams): ReviewQueueFilter {
  const statuses = params.getAll('status').filter((s): s is CaseStatus =>
    (CASE_STATUS as readonly string[]).includes(s),
  )
  return {
    statuses: statuses.length > 0 ? statuses : DEFAULT_STATUSES,
    q: params.get('q') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Number(params.get('page') ?? '0') || 0,
  }
}

export function ReviewQueuePage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => filterFromParams(params), [params])
  const query = useReviewQueue(filter)
  const searchRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => query.data?.content ?? [], [query.data?.content])
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    setSelected(0)
  }, [filter])

  const open = useCallback(
    (index: number) => {
      const row = rows[index]
      if (row) void navigate(`/admin/review/${row.caseId}`)
    },
    [rows, navigate],
  )

  useListKeyboardNav({
    count: rows.length,
    selected,
    onSelect: setSelected,
    onOpen: open,
    onSearch: () => searchRef.current?.focus(),
  })

  function update(next: Partial<ReviewQueueFilter>) {
    const merged = { ...filter, ...next }
    const search = new URLSearchParams()
    for (const status of merged.statuses) search.append('status', status)
    if (merged.q) search.set('q', merged.q)
    if (merged.from) search.set('from', merged.from)
    if (merged.to) search.set('to', merged.to)
    // Any filter change resets to page 0, unless the change IS the page.
    search.set('page', String(next.page ?? 0))
    setParams(search, { replace: true })
  }

  function toggleStatus(status: CaseStatus) {
    const next = filter.statuses.includes(status)
      ? filter.statuses.filter((s) => s !== status)
      : [...filter.statuses, status]
    update({ statuses: next.length > 0 ? next : DEFAULT_STATUSES })
  }

  const total = query.data?.totalElements ?? 0
  const totalPages = query.data?.totalPages ?? 0
  const hasFilters = Boolean(filter.q || filter.from || filter.to)

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b-2 border-ink pb-3">
        <h1 className="text-heading-md font-bold tracking-tight text-content">Review queue</h1>
        <p className="mono-label">
          {total} case{total === 1 ? '' : 's'} waiting
          <span className="ml-3 mono-label--faint">j k move / Enter open / slash search</span>
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-[--radius-panel] border border-border bg-surface px-3 py-2.5">
        <div className="min-w-56 grow">
          <label htmlFor="queue-search" className="sr-only">
            Search name or registration number
          </label>
          <input
            id="queue-search"
            ref={searchRef}
            type="search"
            placeholder="Name or registration number"
            defaultValue={filter.q}
            onChange={(event) => update({ q: event.target.value })}
            className="h-8 w-full rounded-[--radius-control] border border-border-strong bg-surface px-2.5 text-xs text-content outline-none placeholder:text-content-subtle focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(['MANUAL_REVIEW', 'NO_MATCH', 'REJECTED', 'APPROVED'] as CaseStatus[]).map((status) => {
            const on = filter.statuses.includes(status)
            return (
              <button
                key={status}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(status)}
                className={cn(
                  'rounded-[--radius-control] border px-2 py-1 text-2xs font-medium transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
                  on
                    ? 'border-accent bg-row-selected text-content'
                    : 'border-border text-content-muted hover:bg-surface-raised',
                )}
              >
                {status.replace('_', ' ').toLowerCase()}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="queue-from" className="text-2xs text-content-muted">
            From
          </label>
          <input
            id="queue-from"
            type="date"
            value={filter.from}
            onChange={(event) => update({ from: event.target.value })}
            className="h-8 rounded-[--radius-control] border border-border-strong bg-surface px-2 text-xs text-content outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <label htmlFor="queue-to" className="text-2xs text-content-muted">
            To
          </label>
          <input
            id="queue-to"
            type="date"
            value={filter.to}
            onChange={(event) => update({ to: event.target.value })}
            className="h-8 rounded-[--radius-control] border border-border-strong bg-surface px-2 text-xs text-content outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </div>

        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={() => update({ q: '', from: '', to: '' })}>
            Clear filters
          </Button>
        )}
      </div>

      {query.isPending && <LoadingPanel label="Loading the queue" />}

      {query.isError && (
        <ErrorState
          {...errorCopy(query.error)}
          title="Could not load the queue"
          body="The service did not respond."
          onRetry={() => void query.refetch()}
        />
      )}

      {query.isSuccess && rows.length === 0 && (
        <EmptyState
          title={hasFilters ? 'No cases match these filters.' : 'No cases waiting.'}
          /*
            "Everything submitted has been decided" was stated unconditionally,
            which on a system where nothing has ever been submitted is simply
            untrue. Same empty table, two different facts, and the reassuring
            one is the wrong one to guess at.
          */
          body={
            hasFilters
              ? undefined
              : 'Claims submitted on the public site arrive here when they need a person.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={() => update({ q: '', from: '', to: '' })}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}

      {query.isSuccess && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-[--radius-panel] border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-left">
                  <th className="px-3 py-2 font-medium text-content-muted">Submitted</th>
                  <th className="px-3 py-2 font-medium text-content-muted">Claimed name</th>
                  <th className="px-3 py-2 font-medium text-content-muted">Registration no.</th>
                  <th className="px-3 py-2 font-medium text-content-muted">Council</th>
                  <th className="px-3 py-2 font-medium text-content-muted">Status</th>
                  <th className="px-3 py-2 font-medium text-content-muted">Why it is here</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.caseId}
                    aria-selected={index === selected}
                    onClick={() => {
                      setSelected(index)
                      open(index)
                    }}
                    className={cn(
                      'cursor-pointer border-b border-border last:border-0',
                      index === selected ? 'bg-row-selected' : 'hover:bg-row-hover',
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-content-muted">
                      {formatDateTime(row.submittedAt)}
                    </td>
                    <td className="px-3 py-1.5 text-content">{row.claimedFullName}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-content">
                      {row.claimedRegistrationNumber}
                    </td>
                    <td className="px-3 py-1.5 text-content-muted">{row.council}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-2xs text-content-muted">
                        {row.routedReasons.join(', ') || '-'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-xs text-content-muted">
            <span>
              Showing {filter.page * QUEUE_PAGE_SIZE + 1} to{' '}
              {filter.page * QUEUE_PAGE_SIZE + rows.length} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={filter.page === 0}
                onClick={() => update({ page: filter.page - 1 })}
              >
                Previous
              </Button>
              <Button
                size="sm"
                disabled={filter.page >= totalPages - 1}
                onClick={() => update({ page: filter.page + 1 })}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
