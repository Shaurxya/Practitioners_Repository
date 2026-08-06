import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { cn } from '@/lib/cn'
import { useConfirmMapping, useMapping } from '../hooks/useImports'
import { CANONICAL_FIELDS } from '../types'
import type { CanonicalField } from '../types'
import { Confidence } from './Indicators'

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
 * Without these three a row cannot become a registry record.
 *
 * Council is the fourth thing a row needs and is deliberately not here. It comes
 * from the batch, chosen at upload, because a council publishes its own register
 * and does not reprint its name on every line. Requiring it as a column made
 * this screen unfinishable for every single council register, which is most of
 * them. It stays selectable below for the registers that do print it.
 */
const REQUIRED_FIELDS: CanonicalField[] = ['licenseNo', 'fullName', 'status']

/**
 * Map detected columns onto canonical fields, once per parser profile.
 *
 * The server proposes a mapping from the header text and never applies it. A
 * mismapped column is the worst failure this pipeline has, because it does not
 * look like a failure: every row parses, every confidence is high, and the
 * specialty column quietly becomes the licence number for the whole register.
 * The cost of confirming is thirty seconds, once per register.
 */
export function ColumnMappingPage() {
  const { batchId } = useParams()
  const navigate = useNavigate()
  const query = useMapping(batchId)
  const confirm = useConfirmMapping(batchId)

  const [map, setMap] = useState<Record<number, CanonicalField | ''>>({})
  const [saveToProfile, setSaveToProfile] = useState(true)
  const [statusAbsent, setStatusAbsent] = useState(false)

  // Seed from the proposal once it arrives, then leave it alone: refetching
  // must not throw away edits the admin has already made.
  useEffect(() => {
    if (!query.data) return
    setMap(
      Object.fromEntries(
        query.data.detectedColumns.map((c) => [c.index, c.proposedField ?? '']),
      ),
    )
  }, [query.data])

  if (query.isPending) return <LoadingPanel label="Loading detected columns" />
  if (query.isError || !query.data) {
    return <ErrorState {...errorCopy(query.error)} onRetry={() => void query.refetch()} />
  }

  const proposal = query.data
  const assigned = Object.values(map).filter(Boolean) as CanonicalField[]
  const duplicated = assigned.filter((f, i) => assigned.indexOf(f) !== i)

  // Status is the one required field an admin can discharge by assertion rather
  // than by mapping, because some registers genuinely do not publish one.
  const statusMapped = assigned.includes('status')
  const missing = REQUIRED_FIELDS.filter(
    (f) => !assigned.includes(f) && !(f === 'status' && statusAbsent),
  )
  const canConfirm = missing.length === 0 && duplicated.length === 0

  function submit() {
    const columnMap = Object.fromEntries(
      Object.entries(map)
        .filter(([, field]) => field !== '')
        .map(([index, field]) => [Number(index), field as CanonicalField]),
    ) as Record<number, CanonicalField>

    confirm.mutate(
      { columnMap, saveToProfile, statusAbsent: statusAbsent && !statusMapped },
      { onSuccess: () => void navigate(`/admin/imports/${batchId}`) },
    )
  }

  return (
    <div className="space-y-4 pt-8">
      <header className="border-b-2 border-ink pb-3">
        <Link
          to={`/admin/imports/${batchId}`}
          className="mono-label mb-1 block text-content-muted hover:text-content"
        >
          ← Back to batch
        </Link>
        <h1 className="text-heading-md font-bold tracking-tight text-content">Column mapping</h1>
        <p className="mt-1 max-w-2xl text-body-sm text-content-muted">
          Confirmed once, then reused for every future upload of this register. Nothing is parsed
          until you confirm, and the proposal below is a suggestion from the header text, not a
          decision.
        </p>
      </header>

      {proposal.shapeMismatch && (
        <div
          role="alert"
          className="border border-border border-l-2 border-l-rejected bg-rejected-soft px-5 py-4"
        >
          <p className="text-body-md font-medium text-content">
            This document does not match profile {proposal.profileName}
          </p>
          <p className="mt-1.5 max-w-2xl text-body-sm text-content-muted">
            {proposal.shapeMismatch.detail} The council has reformatted the register. Remap the
            columns below, or fix the profile if this is a permanent change.
          </p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="border border-border bg-surface px-3 py-2">
              <dt className="mono-label">Profile expects</dt>
              <dd className="mt-1 font-mono text-2xs text-content-muted">
                {proposal.shapeMismatch.expected.join(' | ')}
              </dd>
            </div>
            <div className="border border-border bg-surface px-3 py-2">
              <dt className="mono-label">Document has</dt>
              <dd className="mt-1 font-mono text-2xs text-content-muted">
                {proposal.shapeMismatch.found.join(' | ')}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/*
        Shown as a fact with its source attached, not as a silent default. If
        this is wrong the whole batch lands under the wrong half of the natural
        key, and the only moment anyone would notice is now.
      */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border border-border bg-surface-raised px-4 py-3">
        <span className="mono-label">Council for every row</span>
        <span className="font-mono text-xs text-content">{proposal.councilCode}</span>
        <span className="text-body-sm text-content-muted">
          {proposal.councilName}, from the batch. Map a council column below only if this register
          prints one, which overrides this per row.
        </span>
      </div>

      <Panel title="Detected columns" bodyClassName="p-0">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-surface-raised text-left">
              <th className="mono-label px-3 py-2 font-normal">#</th>
              <th className="mono-label px-3 py-2 font-normal">Header text</th>
              <th className="mono-label px-3 py-2 font-normal">Sample values</th>
              <th className="mono-label px-3 py-2 font-normal">Proposal</th>
              <th className="mono-label px-3 py-2 font-normal">Maps to</th>
            </tr>
          </thead>
          <tbody>
            {proposal.detectedColumns.map((column) => {
              const chosen = map[column.index] ?? ''
              const isDuplicate = chosen !== '' && duplicated.includes(chosen)
              return (
                <tr
                  key={column.index}
                  className={cn(
                    'border-b border-border align-top last:border-b-0',
                    isDuplicate && 'bg-rejected-soft',
                  )}
                >
                  <td className="px-3 py-2.5 font-mono tabular-nums text-content-subtle">
                    {column.index}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-content">{column.headerText}</td>
                  <td className="px-3 py-2.5">
                    <ul className="space-y-0.5 font-mono text-2xs text-content-muted">
                      {column.sampleValues.slice(0, 3).map((value, i) => (
                        <li key={i} className="truncate">
                          {value}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2.5">
                    <Confidence value={column.proposalConfidence} threshold={0.85} />
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      aria-label={`Map column ${column.index} (${column.headerText})`}
                      value={chosen}
                      onChange={(e) =>
                        setMap((prev) => ({
                          ...prev,
                          [column.index]: e.target.value as CanonicalField | '',
                        }))
                      }
                      className="h-8 w-full min-w-40 rounded-[--radius-control] border border-border-strong bg-surface px-2 text-xs text-content outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <option value="">Ignore this column</option>
                      {CANONICAL_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABEL[field]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>

      {/*
        Offered only when no column claims status, so it cannot quietly override
        a register that does publish one. The consequence is spelled out rather
        than left to be discovered on the first verification: UNKNOWN is not a
        neutral value, it is the reason every practitioner from this batch will
        be sent to a person.
      */}
      {!statusMapped && (
        <div className="border border-border border-l-2 border-l-review bg-review-soft px-4 py-3">
          <label className="flex items-start gap-2.5 text-body-sm text-content">
            <input
              type="checkbox"
              checked={statusAbsent}
              onChange={(e) => setStatusAbsent(e.target.checked)}
              className="mt-0.5 size-3.5 accent-[--color-accent]"
            />
            <span>
              This register does not publish a standing status
              <span className="mt-1 block text-body-sm text-content-muted">
                Tick this only if the document genuinely has no active, suspended or removed
                column. Every row promotes as UNKNOWN, which is not treated as good standing:
                LICENSE_ACTIVE routes an UNKNOWN registry status to a human rather than passing or
                failing it, so every practitioner matched to this batch goes to the review queue on
                their first verification.
              </span>
            </span>
          </label>
        </div>
      )}

      {(missing.length > 0 || duplicated.length > 0) && (
        <div className="border border-border border-l-2 border-l-review bg-review-soft px-4 py-3">
          {missing.length > 0 && (
            <p className="text-body-sm text-content">
              Not mapped yet: {missing.map((f) => FIELD_LABEL[f]).join(', ')}. A row without these
              cannot become a registry record.
            </p>
          )}
          {duplicated.length > 0 && (
            <p className="mt-1 text-body-sm text-content">
              Mapped twice: {duplicated.map((f) => FIELD_LABEL[f]).join(', ')}. Each canonical field
              takes exactly one column.
            </p>
          )}
        </div>
      )}

      {confirm.isError && <ErrorState {...errorCopy(confirm.error)} />}

      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={submit} disabled={!canConfirm} loading={confirm.isPending}>
          Confirm mapping and extract
        </Button>
        <label className="flex items-center gap-2 text-body-sm text-content-muted">
          <input
            type="checkbox"
            checked={saveToProfile}
            onChange={(e) => setSaveToProfile(e.target.checked)}
            className="size-3.5 accent-[--color-accent]"
          />
          Save this mapping to the profile, so the next upload of this register skips this screen
        </label>
      </div>
    </div>
  )
}
