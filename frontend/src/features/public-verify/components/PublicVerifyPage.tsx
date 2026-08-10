import type { FormEvent } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { ImmortalIdDisplay } from '@/components/ui/ImmortalIdDisplay'
import { DetailRow, Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingPanel } from '@/components/ui/States'
import { formatDate } from '@/lib/formatters'
import { useCountries, useMedicalSystems } from '@/features/verification/referenceData'
import { usePublicVerification } from '../hooks/usePublicVerification'
import { validateImmortalId } from '../immortalId'

/**
 * The only screen the open internet reaches. Plain, fast, no login.
 *
 * The ID is checked here before any request goes out, so a malformed one costs
 * the backend nothing. That is a load control, not a security control: the
 * server validates it again and is the authority.
 *
 * This format has no check character, so the shape is most of what the browser
 * can verify. The reference data it already loaded gives it the rest: an ID
 * naming a country we hold no register for, or a medical system that is not
 * ours, cannot be one we issued, and saying which part is wrong is the closest
 * this format gets to what the old check character did for free.
 */
export function PublicVerifyPage() {
  const [params, setParams] = useSearchParams()
  const submitted = params.get('immortalId') ?? ''
  const [value, setValue] = useState(submitted)
  const [formError, setFormError] = useState<string | null>(null)

  const query = usePublicVerification(submitted)
  const countries = useCountries()
  const systems = useMedicalSystems()

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = value.trim().toUpperCase()
    const problem = validateImmortalId(trimmed, {
      // Undefined while loading rather than an empty array, so a slow reference
      // fetch relaxes the check instead of failing every ID typed in the first
      // second the page is open.
      countryCodes: countries.data?.map((c) => c.code),
      medicalSystemCodes: systems.data?.map((s) => s.code),
    })
    if (problem) {
      setFormError(problem)
      setParams({})
      return
    }
    setFormError(null)
    setParams({ immortalId: trimmed })
  }

  return (
    <div className="doc space-y-8">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          Public lookup
        </p>
        <h1>Check a practitioner</h1>
        <p>
          Enter an Immortal ID to see whether that practitioner is verified right now. No account,
          and the answer carries the date and the registry batch it came from.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grow">
          <TextField
            label="Immortal ID"
            hint="Fourteen characters, in the form HI-26INA-K3M7Q."
            mono
            placeholder="HI-26INA-K3M7Q"
            value={value}
            error={formError ?? undefined}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button type="submit" variant="primary" size="lg">
          Check
        </Button>
      </form>

      {submitted && query.isPending && <LoadingPanel label="Checking" />}

      {submitted && query.isError && (
        <ErrorState
          title="Could not check that ID"
          body="The service did not respond. Try again in a moment."
          onRetry={() => void query.refetch()}
        />
      )}

      {submitted && query.isSuccess && (
        <Panel title="Result">
          {query.data.status === 'VERIFIED' ? (
            <>
              {/* Never a bare tick. The claim is always "as of" a date, against
                  a named register batch. */}
              <p className="text-lg font-semibold text-content">
                Verified as of {formatDate(query.data.verifiedAsOf)}
              </p>
              <dl className="mt-3 divide-y divide-border">
                <DetailRow label="Name" value={query.data.displayName} />
                <DetailRow label="Council" value={query.data.council} />
                <DetailRow label="Country" value={query.data.country} />
                <DetailRow label="System of medicine" value={query.data.medicalSystem} />
                <DetailRow
                  label="Register batch"
                  value={<span className="font-mono">{query.data.registrySourceBatch}</span>}
                />
                {/* The same renderer the portal and the console use. An
                    identifier printed three different ways on three screens is
                    how a permanent identifier starts looking untrustworthy. */}
                <DetailRow
                  label="Immortal ID"
                  value={<ImmortalIdDisplay immortalId={query.data.immortalId} size="sm" />}
                />
              </dl>
            </>
          ) : (
            // An unknown ID and an unverified one are deliberately the same
            // response, so this endpoint cannot confirm which IDs exist.
            <p className="text-base text-content">
              This ID is not currently verified.
            </p>
          )}
        </Panel>
      )}
    </div>
  )
}
