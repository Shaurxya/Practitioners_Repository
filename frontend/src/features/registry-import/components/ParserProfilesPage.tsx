import { Panel } from '@/components/ui/Panel'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { formatDateTime } from '@/lib/formatters'
import { useProfiles } from '../hooks/useImports'

/**
 * Parser profiles: everything the extraction service is told about a register's
 * shape, in one place, per register.
 *
 * This is deliberately a read view for now. A profile is created by confirming
 * a column mapping on a real document, which is the only context in which the
 * regexes and the vocabulary can be judged, and editing one blind here is how
 * you break next quarter's import without noticing.
 */
export function ParserProfilesPage() {
  const query = useProfiles()

  if (query.isPending) return <LoadingPanel label="Loading profiles" />
  if (query.isError) {
    return <ErrorState {...errorCopy(query.error)} onRetry={() => void query.refetch()} />
  }

  const profiles = query.data ?? []

  return (
    <div className="space-y-4 pt-8">
      <header className="border-b-2 border-ink pb-3">
        <h1 className="text-heading-md font-bold tracking-tight text-content">Parser profiles</h1>
        <p className="mt-1 max-w-2xl text-body-sm text-content-muted">
          One per register shape. Everything below is sent to the extraction service in the request
          body, so the service itself holds no knowledge of any council. Two copies of a status
          vocabulary would drift, and a drifted vocabulary maps active practitioners to unknown with
          no error anywhere.
        </p>
      </header>

      {profiles.length === 0 && (
        <EmptyState
          title="No profiles yet."
          body="A profile is created the first time you confirm a column mapping on a register."
        />
      )}

      {profiles.map((profile) => (
        <Panel
          key={profile.id}
          title={profile.name}
          aside={
            <span className="mono-label">
              {profile.councilCode} / {profile.batchCount} batch
              {profile.batchCount === 1 ? '' : 'es'} /{' '}
              {profile.confirmedAt ? `confirmed ${formatDateTime(profile.confirmedAt)}` : 'unconfirmed'}
            </span>
          }
        >
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Row label="Table mode" value={profile.tableMode.toLowerCase()} />
            <Row label="Licence format" value={profile.licenseFormatRegex} mono />
            <Row
              label="Date convention"
              value={profile.dateConvention}
              hint="03/04/2019 is unresolvable without this. Guessing puts expiry dates a decade out."
            />
            <Row label="Date patterns" value={profile.datePatterns.join('  ')} mono />
            <Row
              label="Min licence confidence"
              value={profile.minLicenseCharConfidence.toFixed(3)}
              hint="Below this, a licence number is never auto accepted."
            />
            <Row label="Min field confidence" value={profile.minFieldConfidence.toFixed(3)} />
          </dl>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mono-label mb-1.5">Column map</p>
              <ul className="space-y-0.5 font-mono text-2xs text-content-muted">
                {Object.entries(profile.columnMap).map(([index, field]) => (
                  <li key={index}>
                    {index} → {field}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mono-label mb-1.5">Status vocabulary</p>
              <ul className="space-y-0.5 font-mono text-2xs text-content-muted">
                {Object.entries(profile.statusVocabulary).map(([raw, canonical]) => (
                  <li key={raw}>
                    {raw} → {canonical}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-2xs text-content-subtle">
                A status not in this map is a reject. There is no default, because a defaulted
                status is how a suspended practitioner reads as active.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <p className="mono-label mb-1.5">Header patterns, checked on every upload</p>
            <p className="font-mono text-2xs text-content-muted">
              {profile.headerPatterns.join('  |  ')}
            </p>
          </div>
        </Panel>
      ))}
    </div>
  )
}

function Row({
  label,
  value,
  mono,
  hint,
}: {
  label: string
  value: string
  mono?: boolean
  hint?: string
}) {
  return (
    <div>
      <dt className="mono-label">{label}</dt>
      <dd className={mono ? 'mt-0.5 font-mono text-2xs text-content' : 'mt-0.5 text-body-sm text-content'}>
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-2xs text-content-subtle">{hint}</p>}
    </div>
  )
}
