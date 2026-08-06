import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { formatDateTime } from '@/lib/formatters'
import { cn } from '@/lib/cn'
import { useBatches } from '../hooks/useImports'
import { BatchStatusBadge } from './Indicators'
import { AWAITING_HUMAN_STATUSES } from '../types'

/**
 * Every register import ever run, newest first.
 *
 * Sorted by creation rather than by "needs attention", because this list is
 * also the audit trail: someone asking "where did this registry row come from"
 * starts here, and a list that reorders itself by urgency is hard to search.
 * Urgency is carried by the status column instead.
 */
export function ImportListPage() {
  const [page, setPage] = useState(0)
  const navigate = useNavigate()
  const query = useBatches(page)

  const rows = query.data?.content ?? []
  const total = query.data?.totalElements ?? 0
  const totalPages = query.data?.totalPages ?? 0
  const waiting = rows.filter((b) => AWAITING_HUMAN_STATUSES.includes(b.status)).length

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b-2 border-ink pb-3">
        <h1 className="text-heading-md font-bold tracking-tight text-content">Registry imports</h1>
        <div className="flex items-center gap-4">
          <p className="mono-label">
            {total} batch{total === 1 ? '' : 'es'}
            {waiting > 0 && <span className="ml-3 text-review">{waiting} waiting on you</span>}
          </p>
          <Button size="sm" onClick={() => void navigate('/admin/imports/new')}>
            Upload a register
          </Button>
        </div>
      </header>

      {query.isPending && <LoadingPanel label="Loading imports" />}

      {query.isError && (
        <ErrorState
          {...errorCopy(query.error)}
          onRetry={() => void query.refetch()}
        />
      )}

      {query.isSuccess && rows.length === 0 && (
        <EmptyState
          title="No registers imported yet."
          body="Upload a council register PDF to extract it into staging. Nothing reaches the live registry until you approve the diff."
          action={
            <Button onClick={() => void navigate('/admin/imports/new')}>Upload a register</Button>
          }
        />
      )}

      {query.isSuccess && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-[--radius-panel] border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-left">
                  <th className="mono-label px-3 py-2 font-normal">Batch</th>
                  <th className="mono-label px-3 py-2 font-normal">Status</th>
                  <th className="mono-label px-3 py-2 font-normal">Profile</th>
                  <th className="mono-label px-3 py-2 text-right font-normal">Pages</th>
                  <th className="mono-label px-3 py-2 text-right font-normal">Rows</th>
                  <th className="mono-label px-3 py-2 text-right font-normal">Rejects</th>
                  <th className="mono-label px-3 py-2 text-right font-normal">To confirm</th>
                  <th className="mono-label px-3 py-2 font-normal">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((batch) => (
                  <tr
                    key={batch.id}
                    className="border-b border-border last:border-b-0 hover:bg-row-hover"
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/admin/imports/${batch.id}`}
                        className="font-medium text-content underline decoration-border-strong underline-offset-4 hover:decoration-current"
                      >
                        {batch.label}
                      </Link>
                      <div className="mt-0.5 font-mono text-2xs text-content-subtle">
                        {batch.sourceFilename}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <BatchStatusBadge status={batch.status} />
                    </td>
                    <td className="px-3 py-2.5 font-mono text-2xs text-content-muted">
                      {batch.profileName ?? 'not set'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content-muted">
                      {batch.pageCount ?? '-'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-content">
                      {batch.rowsExtracted.toLocaleString('en-GB')}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right font-mono tabular-nums',
                        batch.rowsRejected > 0 ? 'text-rejected' : 'text-content-subtle',
                      )}
                    >
                      {batch.rowsRejected}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-2.5 text-right font-mono tabular-nums',
                        batch.needsConfirmationCount > 0 ? 'text-review' : 'text-content-subtle',
                      )}
                    >
                      {batch.needsConfirmationCount}
                    </td>
                    <td className="px-3 py-2.5 text-content-muted">
                      {formatDateTime(batch.createdAt)}
                      <div className="mt-0.5 text-2xs text-content-subtle">{batch.uploadedBy}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="mono-label">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
