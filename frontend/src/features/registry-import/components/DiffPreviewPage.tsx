import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import {
  useBatch,
  useConfirmRow,
  useCorrectRow,
  usePromoteBatch,
  useRecomputeDiff,
  useRejects,
  useStaging,
} from '../hooks/useImports'
import { CANONICAL_FIELDS } from '../types'
import type { CanonicalField, DiffVerdict, StagingFilter, StagingRow } from '../types'
import { CONFIRMATION_COPY, Confidence, Stat, VerdictBadge } from './Indicators'

const FIELD_LABEL: Record<CanonicalField, string> = {
  licenseNo: 'Licence number',
  fullName: 'Full name',
  council: 'Council',
  status: 'Status',
  specialty: 'Specialty',
  qualification: 'Qualification',
  registrationDate: 'Registration date',
  validUntil: 'Valid until',
}

const VERDICTS: DiffVerdict[] = ['INSERT', 'UPDATE', 'UNCHANGED', 'CONFLICT']

function filterFromParams(params: URLSearchParams): StagingFilter {
  return {
    // Defaults to the rows that need a decision. The whole point of this screen
    // is the rows the parser was unsure about, and opening on 12,000 good rows
    // buries them.
    needsConfirmationOnly: params.get('all') !== 'true',
    verdicts: params.getAll('verdict').filter((v): v is DiffVerdict =>
      (VERDICTS as string[]).includes(v),
    ),
    q: params.get('q') ?? '',
    page: Number(params.get('page') ?? '0') || 0,
  }
}

export function DiffPreviewPage() {
  const { batchId } = useParams()
  const [params, setParams] = useSearchParams()
  const filter = useMemo(() => filterFromParams(params), [params])

  const batch = useBatch(batchId)
  const staging = useStaging(batchId, filter)
  const rejects = useRejects(batchId, true)
  const recompute = useRecomputeDiff(batchId)
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = staging.data?.content ?? []
  const total = staging.data?.totalElements ?? 0
  const totalPages = staging.data?.totalPages ?? 0

  function update(next: Partial<StagingFilter>) {
    const merged = { ...filter, ...next }
    const search = new URLSearchParams()
    if (!merged.needsConfirmationOnly) search.set('all', 'true')
    for (const v of merged.verdicts) search.append('verdict', v)
    if (merged.q) search.set('q', merged.q)
    search.set('page', String(next.page ?? 0))
    setParams(search, { replace: true })
  }

  if (batch.isPending) return <LoadingPanel label="Loading batch" />
  if (batch.isError || !batch.data) {
    return <ErrorState {...errorCopy(batch.error)} onRetry={() => void batch.refetch()} />
  }

  const staleCount = batch.data.staleDiffCount
  const pendingConfirmation = batch.data.needsConfirmationCount
  const promoted = batch.data.rowsPromoted
  // What is left on this screen, not what the document contained. After a
  // partial promotion those are different numbers and the tile has to say the
  // one the reader is looking at.
  const stillStaged = batch.data.rowsExtracted - promoted

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-3">
        <div>
          <Link
            to={`/admin/imports/${batchId}`}
            className="mono-label mb-1 block text-content-muted hover:text-content"
          >
            ← Back to batch
          </Link>
          <h1 className="text-heading-md font-bold tracking-tight text-content">
            Diff preview: {batch.data.label}
          </h1>
          <p className="mt-1 text-body-sm text-content-muted">
            {promoted > 0
              ? `Worst confidence first. ${promoted.toLocaleString('en-GB')} rows are already live. What is left below is not.`
              : 'Worst confidence first. Nothing here has touched the live registry.'}
          </p>
        </div>
        <PromotePanel batchId={batchId} />
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat
          value={stillStaged.toLocaleString('en-GB')}
          label="Still staged"
          hint={promoted > 0 ? 'Not in the registry yet' : undefined}
        />
        <Stat
          value={promoted.toLocaleString('en-GB')}
          label="Promoted"
          tone={promoted > 0 ? 'good' : 'neutral'}
          hint={promoted > 0 ? 'Already in the live registry' : 'Nothing promoted yet'}
        />
        <Stat
          value={pendingConfirmation}
          label="Need confirming"
          tone={pendingConfirmation > 0 ? 'warn' : 'good'}
          hint="Licence numbers the parser was unsure about"
        />
        <Stat
          value={batch.data.rowsRejected}
          label="Rejected"
          tone={batch.data.rowsRejected > 0 ? 'bad' : 'neutral'}
          hint="Never silently dropped"
        />
        <Stat
          value={staleCount}
          label="Stale diffs"
          tone={staleCount > 0 ? 'warn' : 'good'}
          hint={staleCount > 0 ? 'Corrected since the diff ran' : undefined}
        />
      </div>

      {staleCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-border border-l-2 border-l-review bg-review-soft px-4 py-3">
          <p className="max-w-2xl text-body-sm text-content">
            {staleCount} row{staleCount === 1 ? ' has' : 's have'} been corrected since the diff was
            computed. A corrected licence number changes the natural key, which can turn a new row
            into an update of a different practitioner, so the diff has to run again before this
            batch can be promoted.
          </p>
          <Button size="sm" variant="secondary" onClick={() => recompute.mutate()} loading={recompute.isPending}>
            Recompute diff
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-[--radius-panel] border border-border bg-surface px-3 py-2.5">
        <div className="min-w-56 grow">
          <label htmlFor="staging-search" className="sr-only">
            Search name or licence number
          </label>
          <input
            id="staging-search"
            type="search"
            placeholder="Name or licence number"
            defaultValue={filter.q}
            onChange={(e) => update({ q: e.target.value })}
            className="h-8 w-full rounded-[--radius-control] border border-border-strong bg-surface px-2.5 text-xs text-content outline-none placeholder:text-content-subtle focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
          />
        </div>

        <button
          type="button"
          aria-pressed={filter.needsConfirmationOnly}
          onClick={() => update({ needsConfirmationOnly: !filter.needsConfirmationOnly })}
          className={cn(
            'rounded-[--radius-control] border px-2 py-1 text-2xs font-medium transition-colors',
            'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
            filter.needsConfirmationOnly
              ? 'border-accent bg-row-selected text-content'
              : 'border-border text-content-muted hover:bg-surface-raised',
          )}
        >
          needs confirming
        </button>

        <div className="flex items-center gap-1.5">
          {VERDICTS.map((verdict) => {
            const on = filter.verdicts.includes(verdict)
            return (
              <button
                key={verdict}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  update({
                    verdicts: on
                      ? filter.verdicts.filter((v) => v !== verdict)
                      : [...filter.verdicts, verdict],
                  })
                }
                className={cn(
                  'rounded-[--radius-control] border px-2 py-1 text-2xs font-medium transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
                  on
                    ? 'border-accent bg-row-selected text-content'
                    : 'border-border text-content-muted hover:bg-surface-raised',
                )}
              >
                {verdict.toLowerCase()}
              </button>
            )
          })}
        </div>
      </div>

      {staging.isPending && <LoadingPanel label="Loading rows" />}
      {staging.isError && (
        <ErrorState {...errorCopy(staging.error)} onRetry={() => void staging.refetch()} />
      )}

      {staging.isSuccess && rows.length === 0 && (
        <EmptyState
          title={
            filter.needsConfirmationOnly
              ? 'Nothing left to confirm.'
              : 'No rows match these filters.'
          }
          body={
            filter.needsConfirmationOnly
              ? 'Every flagged row has been confirmed or corrected. Switch off the filter to read the rest.'
              : undefined
          }
          action={
            filter.needsConfirmationOnly ? (
              <Button variant="secondary" onClick={() => update({ needsConfirmationOnly: false })}>
                Show all rows
              </Button>
            ) : undefined
          }
        />
      )}

      {staging.isSuccess && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-[--radius-panel] border border-border">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-raised text-left">
                  <th className="mono-label px-3 py-2 font-normal">Score</th>
                  <th className="mono-label px-3 py-2 font-normal">Licence</th>
                  <th className="mono-label px-3 py-2 font-normal">Name</th>
                  <th className="mono-label px-3 py-2 font-normal">Status</th>
                  <th className="mono-label px-3 py-2 font-normal">Valid until</th>
                  <th className="mono-label px-3 py-2 font-normal">Diff</th>
                  <th className="mono-label px-3 py-2 font-normal">Page</th>
                  <th className="mono-label px-3 py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <StagingRowView
                    key={row.id}
                    batchId={batchId}
                    row={row}
                    expanded={expanded === row.id}
                    onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="secondary"
              disabled={filter.page === 0}
              onClick={() => update({ page: filter.page - 1 })}
            >
              Previous
            </Button>
            <span className="mono-label">
              {total.toLocaleString('en-GB')} rows / page {filter.page + 1} of {Math.max(1, totalPages)}
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
        </>
      )}

      {(rejects.data ?? []).length > 0 && (
        <Panel
          title="Rejected rows"
          aside={<span className="mono-label">{rejects.data?.length} not staged</span>}
          bodyClassName="p-0"
        >
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-raised text-left">
                <th className="mono-label px-3 py-2 font-normal">Page</th>
                <th className="mono-label px-3 py-2 font-normal">Row</th>
                <th className="mono-label px-3 py-2 font-normal">Reason</th>
                <th className="mono-label px-3 py-2 font-normal">Raw text</th>
              </tr>
            </thead>
            <tbody>
              {rejects.data?.map((reject) => (
                <tr key={reject.id} className="border-b border-border align-top last:border-b-0">
                  <td className="px-3 py-2 font-mono tabular-nums text-content-muted">
                    {reject.sourcePage}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-content-subtle">
                    {reject.sourceRowNumber}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-2xs text-rejected">{reject.reasonCode}</div>
                    {reject.reasonDetail && (
                      <div className="mt-0.5 text-2xs text-content-muted">{reject.reasonDetail}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-2xs text-content-muted">
                    {reject.rawRowText}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  )
}

/**
 * One staged row, collapsed to a summary line and expandable into the full cell
 * by cell comparison.
 *
 * The licence number is drawn separately from the other fields and always
 * carries its own confidence, because it is the natural key the matcher runs
 * on: one wrong character invents a practitioner who does not exist and
 * simultaneously erases one who does. Every other field can tolerate a bad
 * character and be corrected later without anybody failing verification.
 */
function StagingRowView({
  batchId,
  row,
  expanded,
  onToggle,
}: {
  batchId: string | undefined
  row: StagingRow
  expanded: boolean
  onToggle: () => void
}) {
  const correct = useCorrectRow(batchId)
  const confirmRow = useConfirmRow(batchId)
  const [edits, setEdits] = useState<Partial<Record<CanonicalField, string>>>({})

  const dirty = Object.keys(edits).length > 0
  const flagged = row.needsConfirmation && row.confirmedAt === null

  return (
    <>
      <tr
        className={cn(
          'border-b border-border',
          flagged ? 'bg-review-soft' : 'hover:bg-row-hover',
          expanded && 'bg-row-selected',
        )}
      >
        <td className="px-3 py-2">
          <Confidence value={row.rowConfidence} />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'font-mono tabular-nums',
                flagged ? 'font-bold text-content' : 'text-content',
              )}
            >
              {row.cells.licenseNo.raw ?? '-'}
            </span>
            {flagged && (
              <span aria-hidden="true" className="text-review" title="Needs confirmation">
                ▲
              </span>
            )}
          </div>
          <Confidence value={row.licenseConfidence} threshold={0.95} className="mt-0.5" />
        </td>
        <td className="px-3 py-2 text-content">{row.cells.fullName.raw ?? '-'}</td>
        <td className="px-3 py-2 font-mono text-2xs text-content-muted">
          {row.cells.status.normalized ?? row.cells.status.raw ?? '-'}
        </td>
        <td className="px-3 py-2 font-mono text-2xs text-content-muted">
          {row.cells.validUntil.normalized ?? row.cells.validUntil.raw ?? '-'}
        </td>
        <td className="px-3 py-2">
          <VerdictBadge verdict={row.diffComputedAt === null ? null : row.diffVerdict} />
        </td>
        <td className="px-3 py-2 font-mono tabular-nums text-content-subtle">
          {row.sourcePage}
          <span className="ml-1 text-content-subtle">
            {row.pageClassification === 'SCANNED' ? 'ocr' : 'txt'}
          </span>
        </td>
        <td className="px-3 py-2 text-right">
          <Button size="sm" variant="ghost" onClick={onToggle}>
            {expanded ? 'Close' : 'Open'}
          </Button>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-border bg-surface">
          <td colSpan={8} className="px-3 py-4">
            <div className="space-y-4">
              {row.confirmationCodes.length > 0 && (
                <ul className="space-y-1 border border-border border-l-2 border-l-review bg-review-soft px-4 py-3">
                  {row.confirmationCodes.map((code) => (
                    <li key={code} className="text-body-sm text-content">
                      {CONFIRMATION_COPY[code]}
                    </li>
                  ))}
                </ul>
              )}

              <div>
                <p className="mono-label mb-1">Row as extracted</p>
                <pre className="overflow-x-auto border border-border bg-surface-raised px-3 py-2 font-mono text-2xs text-content-muted">
                  {row.rawRowText}
                </pre>
                <p className="mt-1 text-2xs text-content-subtle">
                  Page {row.sourcePage}, row {row.sourceRowIndex}, {row.pageClassification === 'SCANNED' ? 'read by OCR' : 'read from the text layer'}.
                  Read this when a field looks wrong: it is the only way to tell bad character
                  recognition from a bad column mapping.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="mono-label px-2 py-1.5 font-normal">Field</th>
                      <th className="mono-label px-2 py-1.5 font-normal">Extracted</th>
                      <th className="mono-label px-2 py-1.5 font-normal">Normalized</th>
                      <th className="mono-label px-2 py-1.5 font-normal">Confidence</th>
                      <th className="mono-label px-2 py-1.5 font-normal">Live registry</th>
                      <th className="mono-label px-2 py-1.5 font-normal">Correct to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CANONICAL_FIELDS.map((field) => {
                      const cell = row.cells[field]
                      const live = row.diffAgainst?.[field] ?? null
                      const changed = live !== null && live !== (cell.normalized ?? cell.raw)
                      return (
                        <tr key={field} className="border-b border-border last:border-b-0">
                          <td className="px-2 py-1.5 text-content-muted">{FIELD_LABEL[field]}</td>
                          <td className="px-2 py-1.5 font-mono text-content">{cell.raw ?? '-'}</td>
                          <td className="px-2 py-1.5 font-mono text-2xs text-content-muted">
                            {cell.normalized ?? '-'}
                          </td>
                          <td className="px-2 py-1.5">
                            <Confidence
                              value={cell.confidence}
                              threshold={field === 'licenseNo' ? 0.95 : 0.7}
                            />
                          </td>
                          <td
                            className={cn(
                              'px-2 py-1.5 font-mono text-2xs',
                              changed ? 'bg-review-soft text-content' : 'text-content-subtle',
                            )}
                          >
                            {live ?? '-'}
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              aria-label={`Correct ${FIELD_LABEL[field]}`}
                              value={edits[field] ?? ''}
                              placeholder={cell.raw ?? ''}
                              onChange={(e) =>
                                setEdits((prev) => ({ ...prev, [field]: e.target.value }))
                              }
                              className="h-7 w-full min-w-32 rounded-[--radius-control] border border-border-strong bg-surface px-2 font-mono text-2xs text-content outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {correct.isError && <ErrorState {...errorCopy(correct.error)} />}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  disabled={!dirty}
                  loading={correct.isPending}
                  onClick={() =>
                    correct.mutate(
                      {
                        rowId: row.id,
                        corrections: Object.entries(edits)
                          .filter(([, value]) => value.trim() !== '')
                          .map(([field, value]) => ({
                            field: field as CanonicalField,
                            value: value.trim(),
                          })),
                      },
                      { onSuccess: () => setEdits({}) },
                    )
                  }
                >
                  Save corrections
                </Button>
                {flagged && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={dirty}
                    loading={confirmRow.isPending}
                    onClick={() => confirmRow.mutate(row.id)}
                  >
                    Confirm as extracted
                  </Button>
                )}
                {row.confirmedAt && (
                  <span className="mono-label text-verified">confirmed</span>
                )}
                <p className="text-2xs text-content-subtle">
                  Corrections are recorded against the extraction, confidence and all, and feed the
                  accuracy report.
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Promotion. Guarded rather than merely confirmed, because this is the one
 * action in the panel that writes to the live registry, and everything
 * downstream reads verified status from it.
 */
function PromotePanel({ batchId }: { batchId: string | undefined }) {
  const batch = useBatch(batchId)
  const promote = usePromoteBatch(batchId)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')

  if (!batch.data) return null
  const data = batch.data

  const held = data.needsConfirmationCount
  const ready = data.rowsExtracted - data.rowsPromoted - held

  const blockers: string[] = []
  if (data.status !== 'AWAITING_PROMOTE_OK' && data.status !== 'PARTIALLY_PROMOTED') {
    blockers.push('The batch is not ready to promote yet.')
  }
  /**
   * Held rows no longer block the batch, they are simply left behind. What does
   * block is having nothing to promote: if every remaining row needs a human,
   * the button would write nothing and should say so rather than appear to work.
   */
  if (ready <= 0) {
    blockers.push('Every remaining row still needs confirming. There is nothing to promote.')
  }
  if (data.staleDiffCount > 0) {
    blockers.push(
      `${data.staleDiffCount} row${data.staleDiffCount === 1 ? ' was' : 's were'} corrected after the diff ran. Recompute it first.`,
    )
  }
  if (data.reconciliation?.gap !== null && data.reconciliation?.gap !== undefined && data.reconciliation.gap !== 0) {
    blockers.push('The row count does not reconcile against the document.')
  }

  if (promote.isSuccess) {
    const r = promote.data
    return (
      <div className="max-w-sm border border-border border-l-2 border-l-verified bg-verified-soft px-4 py-3 text-body-sm text-content">
        Promoted: {r.inserted} new, {r.updated} updated, {r.unchanged} unchanged,{' '}
        {r.flaggedNotPresent} flagged as absent from this batch.
        {r.held > 0 && (
          <span className="mt-1.5 block text-content-muted">
            {r.held} row{r.held === 1 ? '' : 's'} held back and still listed below. They are not in
            the registry. Confirm or correct them, then promote again.
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="min-w-72 space-y-2">
      {!open ? (
        <>
          <Button disabled={blockers.length > 0} onClick={() => setOpen(true)}>
            Promote to live registry
          </Button>
          {/*
            Said before the click, not after. "Promote" reads as "promote all of
            it", and an admin who does not know 9 rows are staying behind will
            close the tab believing the import is finished.
          */}
          {blockers.length === 0 && held > 0 && (
            <p className="text-2xs text-content-muted">
              Promotes {ready.toLocaleString('en-GB')} row{ready === 1 ? '' : 's'} now. {held} still
              need{held === 1 ? 's' : ''} confirming and stay{held === 1 ? 's' : ''} here.
            </p>
          )}
        </>
      ) : (
        <div className="space-y-2 border border-border bg-surface px-3 py-3">
          <label htmlFor="promote-reason" className="mono-label block">
            Reason, recorded in the audit log
          </label>
          <textarea
            id="promote-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-[--radius-control] border border-border-strong bg-surface px-2 py-1.5 text-xs text-content outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={reason.trim().length < 10}
              loading={promote.isPending}
              onClick={() =>
                promote.mutate({ reason: reason.trim(), expectedUpdatedAt: data.updatedAt })
              }
            >
              Confirm promotion
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {promote.isError && <ErrorState {...errorCopy(promote.error)} />}
        </div>
      )}

      {blockers.length > 0 && (
        <ul className="space-y-0.5 text-2xs text-content-muted">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
