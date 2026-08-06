import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/States'
import { ApiRequestError } from '@/lib/apiClient'
import { submitCase } from '../api/verificationApi'
import { SPECIALTIES, councilOptions, looksLikeRegistrationNumber, useCouncils } from '../councils'
import type { ClaimAlreadyOpen, SubmitVerificationRequest } from '../types'

type Errors = Partial<Record<keyof SubmitVerificationRequest, string>>

/**
 * Client validation mirrors the server's Bean Validation rules so the common
 * mistakes are caught without a round trip. The server stays the authority.
 *
 * What this does NOT do is normalize. Uppercasing or stripping punctuation here
 * would create a second implementation of Normalizer that drifts from the Java
 * one, and the resulting mismatches are unreproducible from the logs.
 */
export function validateClaim(values: SubmitVerificationRequest): Errors {
  const errors: Errors = {}

  if (!values.fullName.trim()) {
    errors.fullName = 'Enter your full name as it appears on the register.'
  } else if (values.fullName.trim().length < 3) {
    errors.fullName = 'That name looks too short. Enter it as printed on your certificate.'
  }

  if (!values.registrationNumber.trim()) {
    errors.registrationNumber = 'Enter your registration number.'
  } else if (!looksLikeRegistrationNumber(values.registrationNumber)) {
    errors.registrationNumber =
      'That does not look like a registration number. Check your certificate.'
  }

  if (!values.council) errors.council = 'Select the council you are registered with.'
  if (!values.specialty) errors.specialty = 'Select your specialty.'

  return errors
}

const EMPTY: SubmitVerificationRequest = {
  fullName: '',
  registrationNumber: '',
  council: '',
  specialty: '',
}

export function SubmitCasePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const councils = useCouncils()
  const [values, setValues] = useState<SubmitVerificationRequest>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [alreadyOpen, setAlreadyOpen] = useState<ClaimAlreadyOpen | null>(null)

  const mutation = useMutation({
    mutationFn: submitCase,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['my-cases'] })
      void navigate(`/cases/${created.caseId}`)
    },
    onError: (error) => {
      // A practitioner who forgot they already submitted needs taking to the
      // thing they forgot, not a disabled button with no explanation.
      if (error instanceof ApiRequestError && error.status === 409) {
        const body = error.body as unknown as ClaimAlreadyOpen
        if (body?.caseId) setAlreadyOpen(body)
      }
    },
  })

  function set<K extends keyof SubmitVerificationRequest>(key: K, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }))
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found = validateClaim(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    mutation.mutate(values)
  }

  const conflict = mutation.error instanceof ApiRequestError && mutation.error.status === 409
  const failedForOtherReason = mutation.isError && !conflict

  return (
    <div className="doc space-y-8 pb-4">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          Claim
        </p>
        <h1>Verify your registration</h1>
        <p>
          Enter your details exactly as they appear on the official register. We check them against
          your council's records, not against your certificate.
        </p>
      </header>

      {alreadyOpen && (
        <div role="status" className="border border-border border-l-2 border-l-ink bg-surface-raised p-4">
          <p className="text-body-md font-medium text-content">You already have a claim in progress</p>
          <p className="mt-1 text-body-sm text-content-muted">
            You can only have one claim open at a time.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="mt-3"
            onClick={() => void navigate(`/cases/${alreadyOpen.caseId}`)}
          >
            View that claim
          </Button>
        </div>
      )}

      {failedForOtherReason && (
        <ErrorState
          title="We could not submit your claim"
          body="This is a problem at our end, not with your details."
          onRetry={() => mutation.mutate(values)}
          retryLabel="Submit again"
        />
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-7">
        <TextField
          label="Full name"
          hint="As printed on your registration certificate, including any initials."
          required
          autoComplete="name"
          value={values.fullName}
          error={errors.fullName}
          onChange={(event) => set('fullName', event.target.value)}
        />

        <TextField
          label="Registration number"
          hint="Copy it exactly as your council prints it, for example MH-12345 or NR/AY/GA/0000001. Dashes, slashes and spaces do not matter."
          required
          mono
          autoCapitalize="characters"
          value={values.registrationNumber}
          error={errors.registrationNumber}
          onChange={(event) => set('registrationNumber', event.target.value)}
        />

        <SelectField
          label="Council"
          required
          placeholder={
            councils.isPending
              ? 'Loading councils'
              : councils.isError
                ? 'Could not load councils, reload the page'
                : 'Select your council'
          }
          options={councilOptions(councils.data)}
          value={values.council}
          error={errors.council}
          onChange={(value) => set('council', value)}
        />

        <SelectField
          label="Specialty"
          required
          placeholder="Select your specialty"
          options={SPECIALTIES.map((s) => ({ value: s, label: s }))}
          value={values.specialty}
          error={errors.specialty}
          onChange={(value) => set('specialty', value)}
        />

        {/* Expectation setting sits next to the button, not in a toast after.
            A claim that goes silent is the main reason people email support. */}
        <div className="border-l-2 border-border-strong bg-surface-raised px-4 py-3 text-body-sm text-content-muted">
          Most claims are checked within a minute. If we need a person to look at yours, that
          usually takes one working day. You can close this page and come back to it.
        </div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={mutation.isPending}
          className="w-full sm:w-auto"
        >
          {mutation.isPending ? 'Submitting' : 'Submit claim'}
        </Button>
      </form>
    </div>
  )
}
