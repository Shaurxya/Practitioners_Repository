import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { REGISTRY_PAGE_SIZE } from '../api/registryImportApi'
import { useCouncils, useRegistry, useRegistrySummary } from '../hooks/useImports'
import type { RegistryFilter } from '../types'
import { Stat } from './Indicators'

/**
 * The live registry: the rows a practitioner's claim is actually matched
 * against.
 *
 * Deliberately separate from Imports, which answers a different question.
 * Imports shows how data got here, batch by batch, with everything still in
 * staging. This shows what is here now, across every batch ever promoted. An
 * admin asking "is this practitioner in our registry" was previously forced to
 * open a batch and read its staging table, which answers "was this row in that
 * upload" and is not the same question at all.
 *
 * Read only, and permanently so. Nothing edits a registry record by hand: the
 * registry is a normalized copy of an external authority, and a hand edit here
 * is a claim about a council's own register that the council never made. Fixing
 * a wrong row means correcting it in staging and promoting again, which leaves
 * a batch and a reason behind it.
 */
export function RegistryPage() {
  const [params, setParams] = useSearchParams()
  const councils = useCouncils()

  const filter: RegistryFilter = {
    q: params.get('q') ?? '',
    council: params.get('council') ?? '',
    status: params.get('status') ?? '',
    page: Number(params.get('page') ?? '0'),
  }

  const summary = useRegistrySummary()
  const query = useRegistry(filter)

  function update(next: Partial<RegistryFilter>) {
    const merged = { ...filter, ...next }
    const search = new URLSearchParams()
    if (merged.q) search.set('q', merged.q)
    if (merged.council) search.set('council', merged.council)
    if (merged.status) search.set('status', merged.status)
    // Any filter change returns to the first page. Staying on page 7 of a
    // result set that now has two pages shows an empty table and looks broken.
    const page = next.page ?? 0
    if (page > 0) search.set('page', String(page))
    setParams(search, { replace: true })
  }

  if (query.isPending) return <LoadingPanel label="Loading the registry" />
  if (query.isError) {
    return <ErrorState {...errorCopy(query.error)} onRetry={() => void query.refetch()} />
  }

  const rows = query.data.content
  const total = query.data.totalElements
  const totalPages = query.data.totalPages
  const hasFilters = Boolean(filter.q || filter.council || filter.status)
  const counts = summary.data

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-3">
        <div>
          <h1 className="text-heading-md font-bold tracking-tight text-content">Registry</h1>
          <p className="mt-1 max-w-2xl text-body-sm text-content-muted">
            Every record promoted from an import, across all batches. This is what a claim is
            matched against. Records are never edited here: correct the row in its batch and
            promote again, so the change carries a batch and a reason.
          </p>
        </div>
        <span className="mono-label whitespace-nowrap text-content-muted">
          {total.toLocaleString('en-GB')} record{total === 1 ? '' : 's'}
        </span>
      </header>

      {counts && counts.totalRows > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat value={counts.totalRows.toLocaleString('en-GB')} label="Records" />
          <Stat value={counts.councils.length} label="Councils" />
          <Stat value={counts.batches.length} label="Source batches" />
          <Stat
            value={(counts.byStatus['ACTIVE'] ?? 0).toLocaleString('en-GB')}
            label="Active"
            tone={counts.byStatus['ACTIVE'] ? 'good' : 'neutral'}
            hint={
              counts.byStatus['UNKNOWN']
                ? `${counts.byStatus['UNKNOWN'].toLocaleString('en-GB')} with no published status`
                : undefined
            }
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border border-border bg-surface px-3 py-2.5">
        <input
          aria-label="Search by name or registration number"
          placeholder="Name or registration number"
          defaultValue={filter.q}
          onChange={(e) => update({ q: e.target.value })}
          className="h-8 min-w-64 flex-1 rounded-[--radius-control] border border-border-strong bg-surface px-2.5 text-xs text-content outline-none placeholder:text-content-subtle focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
        />
        <select
          aria-label="Filter by council"
          value={filter.council}
          onChange={(e) => update({ council: e.target.value })}
          className="h-8 rounded-[--radius-control] border border-border-strong bg-surface px-2 text-xs text-content outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
        >
          <option value="">All councils</option>
          {(counts?.councils ?? []).map((code) => (
            <option key={code} value={code}>
              {code} / {councils.data?.find((c) => c.code === code)?.canonicalName ?? code}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={filter.status}
          onChange={(e) => update({ status: e.target.value })}
          className="h-8 rounded-[--radius-control] border border-border-strong bg-surface px-2 text-xs text-content outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
        >
          <option value="">Any status</option>
          {Object.keys(counts?.byStatus ?? {})
            .sort()
            .map((status) => (
              <option key={status} value={status}>
                {status.toLowerCase()}
              </option>
            ))}
        </select>
      </div>

      {rows.length === 0 && (
        <EmptyState
          title={hasFilters ? 'No records match these filters.' : 'The registry is empty.'}
          body={
            hasFilters
              ? undefined
              : 'Upload a council register, confirm its column mapping, then promote the rows you have checked. Promoted rows appear here and are what claims match against.'
          }
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={() => update({ q: '', council: '', status: '' })}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}

      {rows.length > 0 && (
        <Panel title="Records" bodyClassName="p-0">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left">
                <th className="mono-label px-3 py-2 font-normal">Registration no.</th>
                <th className="mono-label px-3 py-2 font-normal">Name</th>
                <th className="mono-label px-3 py-2 font-normal">Council</th>
                <th className="mono-label px-3 py-2 font-normal">Status</th>
                <th className="mono-label px-3 py-2 font-normal">Valid until</th>
                <th className="mono-label px-3 py-2 font-normal">Source batch</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((record) => (
                <tr
                  key={`${record.councilCode}-${record.licenceRaw}-${record.sourceBatch}`}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="px-3 py-2 font-mono text-content">{record.licenceRaw}</td>
                  <td className="px-3 py-2 text-content">{record.fullNameRaw}</td>
                  <td className="px-3 py-2 font-mono text-2xs text-content-muted">
                    {record.councilCode}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'mono-label',
                        record.status === 'ACTIVE' && 'text-verified',
                        (record.status === 'SUSPENDED' || record.status === 'REVOKED') &&
                          'text-rejected',
                        record.status === 'UNKNOWN' && 'text-review',
                      )}
                    >
                      {record.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-2xs text-content-muted">
                    {record.validUntil ?? '–'}
                  </td>
                  <td className="px-3 py-2 font-mono text-2xs text-content-muted">
                    {record.sourceBatch}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            size="sm"
            variant="secondary"
            disabled={filter.page === 0}
            onClick={() => update({ page: filter.page - 1 })}
          >
            Previous
          </Button>
          <span className="mono-label text-content-muted">
            {(filter.page * REGISTRY_PAGE_SIZE + 1).toLocaleString('en-GB')} to{' '}
            {Math.min((filter.page + 1) * REGISTRY_PAGE_SIZE, total).toLocaleString('en-GB')} of{' '}
            {total.toLocaleString('en-GB')}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={filter.page >= totalPages - 1}
            onClick={() => update({ page: filter.page + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
