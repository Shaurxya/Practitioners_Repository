import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { formatDateTime } from '@/lib/formatters'
import { cn } from '@/lib/cn'
import {
  useBatch,
  useBatchPages,
  useCancelBatch,
  useRetryExtraction,
  useStartExtraction,
} from '../hooks/useImports'
import { ANOMALY_COPY, BatchStatusBadge, CLASSIFICATION_LABEL, Confidence, Stat } from './Indicators'
import type { BatchFailureCode, ImportBatchDetail } from '../types'

/**
 * Failure copy. Every failure gets its own sentence and its own next action,
 * because "extraction failed" tells nobody anything and the four reasons below
 * need four different responses.
 */
const FAILURE_COPY: Record<BatchFailureCode, { title: string; body: string }> = {
  ENCRYPTED_PDF: {
    title: 'This PDF is encrypted',
    body: 'Nothing can be read from it. Ask the council for an unprotected copy, or remove the password and upload again.',
  },
  NO_READABLE_PAGES: {
    title: 'No page in this PDF could be read',
    body: 'Every page came back with neither a text layer nor a renderable image. The file is likely corrupt.',
  },
  PROFILE_SHAPE_MISMATCH: {
    title: 'This document does not match its parser profile',
    body: 'The council has changed the register layout. Confirm a new column mapping, or fix the profile, before this can be extracted. Nothing was parsed on a guess.',
  },
  EXTRACTOR_TIMEOUT: {
    title: 'Extraction stopped responding',
    body: 'The extraction service stopped sending progress. Whatever was extracted before that point was discarded rather than kept, because a partial register is the dangerous case. Retry when the service is healthy.',
  },
  EXTRACTOR_UNAVAILABLE: {
    title: 'The extraction service is not reachable',
    body: 'Check the sidecar is running, then retry. The batch is unchanged.',
  },
  EXTRACTOR_ERROR: {
    title: 'The extraction service returned an error',
    body: 'The detail below is what it reported. Nothing was written to staging.',
  },
  PROMOTE_CONSTRAINT_VIOLATION: {
    title: 'Promotion hit a database constraint',
    body: 'The whole promotion rolled back, so the live registry is exactly as it was. The detail below names the constraint.',
  },
}

export function ImportDetailPage() {
  const { batchId } = useParams()
  const query = useBatch(batchId)
  const batch = query.data

  const showPages = Boolean(
    batch && ['AWAITING_CLASSIFY_OK', 'PARSING', 'PARSED', 'AWAITING_PROMOTE_OK', 'PARSE_FAILED', 'PROMOTED'].includes(batch.status),
  )
  const pages = useBatchPages(batchId, showPages)

  const startExtraction = useStartExtraction(batchId)
  const retry = useRetryExtraction(batchId)
  const cancel = useCancelBatch(batchId)
  const [confirmCancel, setConfirmCancel] = useState(false)

  if (query.isPending) return <LoadingPanel label="Loading batch" />
  if (query.isError || !batch) {
    return <ErrorState {...errorCopy(query.error)} onRetry={() => void query.refetch()} />
  }

  const failure = batch.failureCode ? FAILURE_COPY[batch.failureCode] : null
  const anomalies = (pages.data ?? []).filter((p) => p.anomalyCode !== null)

  return (
    <div className="space-y-4 pt-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-3">
        <div>
          <Link
            to="/admin/imports"
            className="mono-label mb-1 block text-content-muted hover:text-content"
          >
            ← All imports
          </Link>
          <h1 className="text-heading-md font-bold tracking-tight text-content">{batch.label}</h1>
          <p className="mt-1 font-mono text-2xs text-content-subtle">
            {batch.sourceFilename} / {(batch.sourceBytes / 1024 / 1024).toFixed(1)} MB / sha256{' '}
            {batch.sourceSha256.slice(0, 12)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <BatchStatusBadge status={batch.status} />
          <BatchActions
            batch={batch}
            onStart={() => startExtraction.mutate()}
            starting={startExtraction.isPending}
            onRetry={() => retry.mutate()}
            retrying={retry.isPending}
            onCancel={() => (confirmCancel ? cancel.mutate() : setConfirmCancel(true))}
            cancelling={cancel.isPending}
            confirmCancel={confirmCancel}
          />
        </div>
      </header>

      {failure && (
        <div
          role="alert"
          className="border border-border border-l-2 border-l-rejected bg-rejected-soft px-5 py-4"
        >
          <p className="text-body-md font-medium text-content">{failure.title}</p>
          <p className="mt-1.5 max-w-2xl text-body-sm text-content-muted">{failure.body}</p>
          {batch.failureDetail && (
            <pre className="mt-3 overflow-x-auto border border-border bg-surface px-3 py-2 font-mono text-2xs text-content-muted">
              {batch.failureDetail}
            </pre>
          )}
        </div>
      )}

      {batch.status === 'PARSING' && <ExtractionProgress batch={batch} />}

      {batch.classification && (
        <Panel
          title="Page classification"
          aside={
            <span className="mono-label--faint text-2xs">
              classified per page, never per document
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat value={batch.classification.pageCount} label="Pages" />
            <Stat
              value={batch.classification.textLayerPages}
              label="Text layer"
              tone="good"
              hint="Extracted at confidence 1.0"
            />
            <Stat
              value={batch.classification.scannedPages}
              label="Scanned"
              tone={batch.classification.scannedPages > 0 ? 'warn' : 'neutral'}
              hint="Goes through OCR"
            />
            <Stat
              value={batch.classification.unreadablePages}
              label="Unreadable"
              tone={batch.classification.unreadablePages > 0 ? 'bad' : 'neutral'}
            />
            <Stat
              value={batch.classification.rotatedPages}
              label="Rotated"
              hint="Corrected before anything else"
            />
          </div>

          {batch.status === 'AWAITING_CLASSIFY_OK' && (
            <ClassificationVerdict batch={batch} />
          )}
        </Panel>
      )}

      {batch.reconciliation && <ReconciliationPanel batch={batch} />}

      {showPages && (
        <Panel
          title="Per page"
          aside={
            <span className="mono-label">
              {anomalies.length > 0 ? (
                <span className="text-review">{anomalies.length} flagged</span>
              ) : (
                'no anomalies'
              )}
            </span>
          }
          bodyClassName="p-0"
        >
          {pages.isPending && <LoadingPanel label="Loading pages" />}
          {pages.isSuccess && (
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-surface-raised">
                  <tr className="border-b border-border text-left">
                    <th className="mono-label px-3 py-2 font-normal">Page</th>
                    <th className="mono-label px-3 py-2 font-normal">Kind</th>
                    <th className="mono-label px-3 py-2 font-normal">Mode</th>
                    <th className="mono-label px-3 py-2 text-right font-normal">Rows</th>
                    <th className="mono-label px-3 py-2 font-normal">OCR</th>
                    <th className="mono-label px-3 py-2 font-normal">Page score</th>
                    <th className="mono-label px-3 py-2 font-normal">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.data.map((p) => (
                    <tr
                      key={p.pageNumber}
                      className={cn(
                        'border-b border-border last:border-b-0',
                        p.anomalyCode ? 'bg-review-soft' : 'hover:bg-row-hover',
                      )}
                    >
                      <td className="px-3 py-1.5 font-mono tabular-nums text-content">
                        {p.pageNumber}
                      </td>
                      <td className="px-3 py-1.5 text-content-muted">
                        {CLASSIFICATION_LABEL[p.classification]}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-2xs text-content-subtle">
                        {p.tableModeUsed?.toLowerCase() ?? '-'}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-content">
                        {p.rowsExtracted}
                      </td>
                      <td className="px-3 py-1.5">
                        <Confidence value={p.meanOcrConfidence} threshold={0.85} />
                      </td>
                      <td className="px-3 py-1.5">
                        <Confidence value={p.pageConfidence} threshold={0.8} />
                      </td>
                      <td className="px-3 py-1.5 text-2xs text-content-muted">
                        {p.anomalyCode ? ANOMALY_COPY[p.anomalyCode] : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}

/**
 * The action a batch offers depends entirely on which state it is in, so the
 * buttons are derived from status rather than always rendered and disabled.
 * A disabled button that is never enabled is noise.
 */
function BatchActions({
  batch,
  onStart,
  starting,
  onRetry,
  retrying,
  onCancel,
  cancelling,
  confirmCancel,
}: {
  batch: ImportBatchDetail
  onStart: () => void
  starting: boolean
  onRetry: () => void
  retrying: boolean
  onCancel: () => void
  cancelling: boolean
  confirmCancel: boolean
}) {
  const cancellable = !['PROMOTED', 'CANCELLED', 'PROMOTING'].includes(batch.status)

  return (
    <div className="flex items-center gap-2">
      {batch.status === 'AWAITING_MAPPING' && (
        <Link to={`/admin/imports/${batch.id}/mapping`}>
          <Button size="sm">Confirm columns</Button>
        </Link>
      )}
      {batch.status === 'AWAITING_PROMOTE_OK' && (
        <Link to={`/admin/imports/${batch.id}/review`}>
          <Button size="sm">Review {batch.rowsExtracted.toLocaleString('en-GB')} rows</Button>
        </Link>
      )}
      {batch.status === 'AWAITING_CLASSIFY_OK' && (
        <Button size="sm" onClick={onStart} loading={starting}>
          Start extraction
        </Button>
      )}
      {(batch.status === 'PARSE_FAILED' || batch.status === 'PROMOTE_FAILED') && (
        <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>
          Retry
        </Button>
      )}
      {cancellable && (
        <Button size="sm" variant={confirmCancel ? 'danger' : 'ghost'} onClick={onCancel} loading={cancelling}>
          {confirmCancel ? 'Confirm cancel' : 'Cancel'}
        </Button>
      )}
    </div>
  )
}

/**
 * The one thing an admin should read before spending an hour on OCR: how much
 * of this register is scanned. Said in a sentence, not left as a ratio to work
 * out from the numbers above.
 */
function ClassificationVerdict({ batch }: { batch: ImportBatchDetail }) {
  const c = batch.classification
  if (!c) return null
  const scannedShare = c.pageCount === 0 ? 0 : c.scannedPages / c.pageCount

  const verdict =
    scannedShare === 0
      ? {
          tone: 'border-l-verified bg-verified-soft',
          text: 'Every page has a text layer. Extraction will be exact and every cell scores 1.0.',
        }
      : scannedShare < 0.2
        ? {
            tone: 'border-l-border-strong bg-pending-soft',
            text: `${c.scannedPages} of ${c.pageCount} pages are scanned and go through OCR. The rest are exact. Expect a handful of rows to need confirming.`,
          }
        : scannedShare < 0.8
          ? {
              tone: 'border-l-review bg-review-soft',
              text: `This is a hybrid document: ${c.textLayerPages} text pages and ${c.scannedPages} scanned. The scanned portion will produce most of the low confidence rows, and licence numbers on those pages are the ones to read carefully.`,
            }
          : {
              tone: 'border-l-review bg-review-soft',
              text: `This register is essentially all scans (${c.scannedPages} of ${c.pageCount} pages). Extraction will be slower and noticeably less accurate, and you should expect to confirm a meaningful share of licence numbers by hand.`,
            }

  return (
    <div className={cn('mt-4 border border-border border-l-2 px-4 py-3', verdict.tone)}>
      <p className="text-body-sm text-content">{verdict.text}</p>
      {c.unreadablePages > 0 && (
        <p className="mt-2 text-body-sm text-rejected">
          {c.unreadablePages} page{c.unreadablePages === 1 ? '' : 's'} could not be read at all and
          will contribute nothing. If those pages hold rows, this import will be incomplete.
        </p>
      )}
    </div>
  )
}

function ExtractionProgress({ batch }: { batch: ImportBatchDetail }) {
  const total = batch.pageCount ?? 0
  const done = batch.pagesDone
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <Panel title="Extraction in progress">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-body-sm tabular-nums text-content">
            page {done} of {total}
          </span>
          <span className="mono-label">
            {batch.rowsExtracted.toLocaleString('en-GB')} rows so far
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 w-full overflow-hidden bg-surface-raised"
        >
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-2xs text-content-muted">
          Progress is pushed by the extraction service as each page finishes. If it stops sending
          for long enough, this batch moves to extraction failed rather than sitting here forever.
          {batch.extractionHeartbeatAt &&
            ` Last heard from at ${formatDateTime(batch.extractionHeartbeatAt)}.`}
        </p>
      </div>
    </Panel>
  )
}

/**
 * Reconciliation. The gap between what the document claims to hold and what came
 * out is the single most useful number here: silent partial extraction is what
 * causes a mass revocation on the next re-verification run, and it is invisible
 * in every other view because the rows that did extract look perfect.
 */
function ReconciliationPanel({ batch }: { batch: ImportBatchDetail }) {
  const r = batch.reconciliation
  if (!r) return null

  const gapIsBad = r.gap !== null && Math.abs(r.gap) > 0

  return (
    <Panel
      title="Reconciliation"
      aside={
        gapIsBad ? (
          <span className="mono-label text-rejected">does not reconcile</span>
        ) : (
          <span className="mono-label text-verified">reconciles</span>
        )
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat
          value={r.declaredRowCount?.toLocaleString('en-GB') ?? 'not stated'}
          label="Document claims"
          hint={r.declaredRowCount === null ? 'No count found in the text' : undefined}
        />
        <Stat value={r.extractedRowCount.toLocaleString('en-GB')} label="Extracted" />
        <Stat
          value={r.rejectedRowCount}
          label="Rejected"
          tone={r.rejectedRowCount > 0 ? 'warn' : 'neutral'}
        />
        <Stat
          value={r.gap === null ? 'n/a' : r.gap > 0 ? `+${r.gap}` : String(r.gap)}
          label="Gap"
          tone={r.gap === null ? 'neutral' : gapIsBad ? 'bad' : 'good'}
        />
        <Stat
          value={r.anomalousPageCount}
          label="Flagged pages"
          tone={r.anomalousPageCount > 0 ? 'warn' : 'neutral'}
          hint={`avg ${r.meanRowsPerPage.toFixed(1)} rows/page`}
        />
      </div>

      {gapIsBad && (
        <p className="mt-3 border border-border border-l-2 border-l-rejected bg-rejected-soft px-4 py-3 text-body-sm text-content">
          This register states it holds {r.declaredRowCount?.toLocaleString('en-GB')} practitioners
          and {(r.extractedRowCount + r.rejectedRowCount).toLocaleString('en-GB')} rows were
          accounted for. Do not promote this batch until the gap is explained. Promoting it marks
          every missing practitioner as absent from the latest batch, and the re-verification job
          will treat that as delisted.
        </p>
      )}

      {r.declaredRowCount === null && r.anomalousPageCount > 0 && (
        <p className="mt-3 border border-border border-l-2 border-l-review bg-review-soft px-4 py-3 text-body-sm text-content">
          The document does not state its own count, so there is nothing to reconcile against.
          Instead, {r.anomalousPageCount} page{r.anomalousPageCount === 1 ? '' : 's'} yielded
          noticeably fewer rows than this document&rsquo;s average of {r.meanRowsPerPage.toFixed(1)}.
          Check those pages in the table below before promoting.
        </p>
      )}
    </Panel>
  )
}
