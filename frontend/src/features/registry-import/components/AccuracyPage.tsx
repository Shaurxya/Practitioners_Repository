import { Panel } from '@/components/ui/Panel'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { formatDateTime } from '@/lib/formatters'
import { cn } from '@/lib/cn'
import { useAccuracy } from '../hooks/useImports'
import { CLASSIFICATION_LABEL, Confidence, Stat } from './Indicators'
import type { CanonicalField } from '../types'

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

/**
 * Measured extraction accuracy, built from corrections an admin actually made.
 *
 * This is the only honest answer to "did that parser change help". An estimate
 * is a feeling; this is a before and after on the same documents. It is also
 * biased in a known direction and worth saying so on the page: it measures
 * fields a human looked at, and the diff preview sorts the worst rows first, so
 * real accuracy across the whole register is higher than what is shown here.
 */
export function AccuracyPage() {
  const query = useAccuracy()

  if (query.isPending) return <LoadingPanel label="Loading accuracy" />
  if (query.isError) {
    return <ErrorState {...errorCopy(query.error)} onRetry={() => void query.refetch()} />
  }

  const report = query.data
  if (!report || report.rowsReviewed === 0) {
    return (
      <div className="pt-8">
        <EmptyState
          title="No corrections recorded yet."
          body="Every field you fix in a diff preview lands here with the confidence the parser reported when it got it wrong. After a few batches this tells you exactly where the parser is weak."
        />
      </div>
    )
  }

  const overall =
    report.byField.length === 0
      ? 1
      : report.byField.reduce((sum, f) => sum + f.accuracy, 0) / report.byField.length
  const calibrationBugs = report.byField.reduce((sum, f) => sum + f.highConfidenceMisses, 0)

  return (
    <div className="space-y-4 pt-8">
      <header className="border-b-2 border-ink pb-3">
        <h1 className="text-heading-md font-bold tracking-tight text-content">
          Extraction accuracy
        </h1>
        <p className="mt-1 max-w-3xl text-body-sm text-content-muted">
          Measured against corrections, not estimated. Read it knowing what it is: these are fields
          a human reviewed, and the diff preview puts the worst rows first, so accuracy across the
          whole register is higher than the numbers below.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={report.batchesCovered} label="Batches" />
        <Stat value={report.rowsReviewed.toLocaleString('en-GB')} label="Rows reviewed" />
        <Stat
          value={`${(overall * 100).toFixed(1)}%`}
          label="Mean field accuracy"
          tone={overall > 0.98 ? 'good' : overall > 0.95 ? 'warn' : 'bad'}
        />
        <Stat
          value={calibrationBugs}
          label="Calibration bugs"
          tone={calibrationBugs > 0 ? 'bad' : 'good'}
          hint="High confidence and still wrong"
        />
      </div>

      <Panel title="By field" bodyClassName="p-0">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-raised text-left">
              <th className="mono-label px-3 py-2 font-normal">Field</th>
              <th className="mono-label px-3 py-2 text-right font-normal">Extracted</th>
              <th className="mono-label px-3 py-2 text-right font-normal">Corrected</th>
              <th className="mono-label px-3 py-2 font-normal">Accuracy</th>
              <th className="mono-label px-3 py-2 text-right font-normal">Confident and wrong</th>
            </tr>
          </thead>
          <tbody>
            {[...report.byField]
              .sort((a, b) => a.accuracy - b.accuracy)
              .map((field) => (
                <tr key={field.field} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-content">
                    {FIELD_LABEL[field.field]}
                    {field.field === 'licenseNo' && (
                      <span className="ml-2 font-mono text-2xs text-content-subtle">
                        natural key
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-content-muted">
                    {field.extractedCount.toLocaleString('en-GB')}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-content">
                    {field.correctedCount}
                  </td>
                  <td className="px-3 py-2">
                    <Confidence value={field.accuracy} threshold={0.98} />
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right font-mono tabular-nums',
                      field.highConfidenceMisses > 0 ? 'text-rejected' : 'text-content-subtle',
                    )}
                  >
                    {field.highConfidenceMisses}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="By page kind">
        <div className="grid gap-2 sm:grid-cols-3">
          {report.byClassification.map((row) => (
            <Stat
              key={row.classification}
              value={`${(row.accuracy * 100).toFixed(1)}%`}
              label={CLASSIFICATION_LABEL[row.classification]}
              tone={row.accuracy > 0.98 ? 'good' : row.accuracy > 0.95 ? 'warn' : 'bad'}
              hint={`${row.correctedCount} corrections over ${row.rowsReviewed.toLocaleString('en-GB')} rows`}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Recent corrections" bodyClassName="p-0">
        <div className="max-h-[26rem] overflow-auto">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-surface-raised">
              <tr className="border-b border-border text-left">
                <th className="mono-label px-3 py-2 font-normal">When</th>
                <th className="mono-label px-3 py-2 font-normal">Batch</th>
                <th className="mono-label px-3 py-2 font-normal">Field</th>
                <th className="mono-label px-3 py-2 font-normal">Extracted</th>
                <th className="mono-label px-3 py-2 font-normal">Corrected to</th>
                <th className="mono-label px-3 py-2 font-normal">Confidence</th>
                <th className="mono-label px-3 py-2 font-normal">Page</th>
              </tr>
            </thead>
            <tbody>
              {report.recentCorrections.map((correction) => {
                // A wrong value the parser was sure about is a calibration bug and
                // matters more than a wrong value it flagged, which is the system
                // working as designed.
                const confident =
                  correction.extractedConfidence !== null && correction.extractedConfidence >= 0.95
                return (
                  <tr
                    key={correction.id}
                    className={cn(
                      'border-b border-border last:border-b-0',
                      confident && 'bg-rejected-soft',
                    )}
                  >
                    <td className="px-3 py-2 text-content-muted">
                      {formatDateTime(correction.correctedAt)}
                    </td>
                    <td className="px-3 py-2 font-mono text-2xs text-content-muted">
                      {correction.batchLabel}
                    </td>
                    <td className="px-3 py-2 text-content">{FIELD_LABEL[correction.field]}</td>
                    <td className="px-3 py-2 font-mono text-rejected line-through">
                      {correction.extractedValue ?? 'blank'}
                    </td>
                    <td className="px-3 py-2 font-mono text-content">{correction.correctedValue}</td>
                    <td className="px-3 py-2">
                      <Confidence value={correction.extractedConfidence} threshold={0.95} />
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums text-content-subtle">
                      {correction.sourcePage}
                      <span className="ml-1">
                        {correction.pageClassification === 'SCANNED' ? 'ocr' : 'txt'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
