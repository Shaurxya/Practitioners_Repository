import type { FormEvent } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { DetailRow, Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingPanel } from '@/components/ui/States'
import { formatDate } from '@/lib/formatters'
import { usePublicVerification } from '../hooks/usePublicVerification'
import { looksLikeImmortalId } from '../immortalId'

/**
 * The only screen the open internet reaches. Plain, fast, no login.
 *
 * The check character is validated here before any request goes out, so a
 * malformed ID costs the backend nothing. That is a load control, not a
 * security control: the server validates it again.
 */
export function PublicVerifyPage() {
  const [params, setParams] = useSearchParams()
  const submitted = params.get('immortalId') ?? ''
  const [value, setValue] = useState(submitted)
  const [formError, setFormError] = useState<string | null>(null)

  const query = usePublicVerification(submitted)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = value.trim().toUpperCase()
    if (!looksLikeImmortalId(trimmed)) {
      setFormError('That is not a valid Immortal ID. Check the characters and try again.')
      setParams({})
      return
    }
    setFormError(null)
    setParams({ immortalId: trimmed })
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-content">Check a practitioner</h1>
        <p className="text-base text-content-muted">
          Enter an Immortal ID to see whether that practitioner is currently verified.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grow">
          <TextField
            label="Immortal ID"
            mono
            placeholder="HI-K3M7Q-8XT2A"
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
                <DetailRow
                  label="Register batch"
                  value={<span className="font-mono">{query.data.registrySourceBatch}</span>}
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
