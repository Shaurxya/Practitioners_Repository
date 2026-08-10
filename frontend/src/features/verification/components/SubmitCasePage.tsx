import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/States'
import { IdentityStep } from '@/features/documents/components/IdentityStep'
import { ApiRequestError } from '@/lib/apiClient'
import { lookupRegistration, submitCase } from '../api/verificationApi'
import { SPECIALTIES, councilOptions, looksLikeRegistrationNumber, useCouncils } from '../councils'
import {
  countryOptions,
  medicalSystemOptions,
  useCountries,
  useMedicalSystems,
} from '../referenceData'
import type { ClaimAlreadyOpen, LookupResult, SubmitVerificationRequest } from '../types'

type Errors = Partial<Record<keyof SubmitVerificationRequest, string>>

/**
 * Client validation mirrors the server's Bean Validation rules so the common
 * mistakes are caught without a round trip. The server stays the authority.
 *
 * What this does NOT do is normalize. Uppercasing or stripping punctuation here
 * would create a second implementation of Normalizer that drifts from the Java
 * one, and the resulting mismatches are unreproducible from the logs.
 *
 * Still validates the whole claim in one function even though the form now
 * collects it across two steps. The steps are a presentation decision; what
 * makes a claim valid is not, and splitting this would let the two halves
 * disagree about it.
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

  if (!values.country) errors.country = 'Select the country you are registered in.'
  if (!values.council) errors.council = 'Select the council you are registered with.'
  if (!values.medicalSystem) {
    // Not optional and not defaultable. This character is written permanently
    // into the Immortal ID, and a guessed default would be indistinguishable
    // afterwards from a deliberate answer.
    errors.medicalSystem = 'Select the system of medicine you practise.'
  }
  if (!values.specialty) errors.specialty = 'Select your specialty.'

  if (!values.photoIdDocumentId) {
    errors.photoIdDocumentId = 'Upload a photo ID.'
  }
  if (!values.selfieDocumentId) {
    errors.selfieDocumentId = 'Upload a photo of yourself.'
  }

  return errors
}

/** The three fields step 1 needs. The rest are not asked for until step 2. */
const FIND_FIELDS = ['country', 'council', 'registrationNumber'] as const

function validateFind(values: SubmitVerificationRequest): Errors {
  const all = validateClaim(values)
  const errors: Errors = {}
  for (const field of FIND_FIELDS) {
    if (all[field]) errors[field] = all[field]
  }
  return errors
}

/** The fields step 2 asks for. Identity is step 3 and validated there. */
const CONFIRM_FIELDS = ['fullName', 'medicalSystem', 'specialty'] as const

function validateConfirm(values: SubmitVerificationRequest): Errors {
  const all = validateClaim(values)
  const errors: Errors = {}
  for (const field of CONFIRM_FIELDS) {
    if (all[field]) errors[field] = all[field]
  }
  return errors
}

const EMPTY: SubmitVerificationRequest = {
  fullName: '',
  registrationNumber: '',
  council: '',
  specialty: '',
  country: '',
  medicalSystem: '',
  photoIdDocumentId: null,
  selfieDocumentId: null,
}

type Step = 'FIND' | 'CONFIRM' | 'IDENTITY'

const STEP_TITLES: Record<Step, string> = {
  FIND: 'Find your registration',
  CONFIRM: 'Confirm it is you',
  IDENTITY: 'Prove it is you',
}

const STEP_NUMBERS: Record<Step, number> = { FIND: 1, CONFIRM: 2, IDENTITY: 3 }

/**
 * What the register said, in the words a claimant needs.
 *
 * Note what is not here: a registry row, a name, a candidate count. The server
 * sends a masked name on FOUND and empty strings on everything else, and this
 * panel is built so that no branch can render a field the server did not fill.
 */
function LookupPanel({ result }: { result: LookupResult }) {
  if (result.outcome === 'NOT_FOUND') {
    return (
      <div role="status" className="border border-border border-l-2 border-l-ink bg-surface-raised p-4">
        <p className="text-body-md font-medium text-content">
          We could not find that registration
        </p>
        <p className="mt-1 text-body-sm text-content-muted">
          Check the number against your certificate. If it is correct, your council's latest
          records may not have reached us yet. You can still submit the claim and a person will
          check it.
        </p>
      </div>
    )
  }

  if (result.outcome === 'AMBIGUOUS') {
    return (
      <div role="status" className="border border-border border-l-2 border-l-ink bg-surface-raised p-4">
        <p className="text-body-md font-medium text-content">
          That number matches more than one entry
        </p>
        <p className="mt-1 text-body-sm text-content-muted">
          This happens when a register holds duplicates. Submit your claim as normal and a
          reviewer will work out which entry is yours.
        </p>
      </div>
    )
  }

  return (
    <div role="status" className="border border-border border-l-2 border-l-ink bg-surface-raised p-4">
      <p className="text-body-md font-medium text-content">Registration found</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body-sm">
        <dt className="text-content-muted">Council</dt>
        <dd className="text-content">{result.councilName}</dd>
        <dt className="text-content-muted">On the register</dt>
        <dd className="font-mono text-content">{result.maskedName}</dd>
        <dt className="text-content-muted">Standing</dt>
        <dd className="text-content">
          {result.standing === 'ACTIVE'
            ? 'Active'
            : result.standing === 'UNKNOWN'
              ? 'This register does not publish a standing status'
              : 'Not currently active'}
        </dd>
        <dt className="text-content-muted">As of</dt>
        <dd className="font-mono text-content">{result.asOfBatch}</dd>
      </dl>
      {/* Says why the name is masked, in the place where someone wonders. The
          alternative is a person assuming we hold the wrong name for them. */}
      <p className="mt-3 text-body-sm text-content-muted">
        The name is hidden because you have not proved yet that it is yours. Enter it in full on
        the next step and we will check it against the register.
      </p>
    </div>
  )
}

export function SubmitCasePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const councils = useCouncils()
  const countries = useCountries()
  const medicalSystems = useMedicalSystems()
  const [step, setStep] = useState<Step>('FIND')
  const [values, setValues] = useState<SubmitVerificationRequest>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [lookup, setLookup] = useState<LookupResult | null>(null)
  const [alreadyOpen, setAlreadyOpen] = useState<ClaimAlreadyOpen | null>(null)

  const lookupMutation = useMutation({
    mutationFn: lookupRegistration,
    onSuccess: setLookup,
  })

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
    setValues((previous) => ({
      ...previous,
      [key]: value,
      // Changing country invalidates the council underneath it. Leaving a
      // Maharashtra council selected under "United States" would send the
      // server a claim it can only reject, and the person would have no way to
      // see why: both fields look answered.
      ...(key === 'country' ? { council: '' } : {}),
    }))
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }))
    // Any edit to the three fields that key the match invalidates the answer we
    // got for the old ones. Leaving the panel up would show a result for a
    // registration number no longer on screen.
    if (FIND_FIELDS.includes(key as (typeof FIND_FIELDS)[number])) setLookup(null)
  }

  function handleFind(event: FormEvent) {
    event.preventDefault()
    const found = validateFind(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    lookupMutation.mutate({
      council: values.council,
      registrationNumber: values.registrationNumber,
    })
  }

  function handleConfirm(event: FormEvent) {
    event.preventDefault()
    const found = validateConfirm(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setStep('IDENTITY')
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found = validateClaim(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    mutation.mutate(values)
  }

  // Empty until a country is chosen, rather than every council in the register.
  // The placeholder already says "Select a country first", and a select that
  // says that while listing thirty six options is telling the person something
  // the control itself contradicts.
  const availableCouncils = values.country ? councilOptions(councils.data, values.country) : []

  const conflict = mutation.error instanceof ApiRequestError && mutation.error.status === 409
  const failedForOtherReason = mutation.isError && !conflict

  const rateLimited =
    lookupMutation.error instanceof ApiRequestError && lookupMutation.error.status === 429
  const lookupFailed = lookupMutation.isError && !rateLimited

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
        <p className="mono-label mt-4" aria-label={`Step ${STEP_NUMBERS[step]} of 3`}>
          Step {STEP_NUMBERS[step]} of 3
          <span className="text-content-muted"> {STEP_TITLES[step]}</span>
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

      {step === 'FIND' && (
        <form onSubmit={handleFind} noValidate className="space-y-7">
          {/* Country before council, because it narrows the council list. Both
              answers reach the server and the server checks them against each
              other: the council knows which country it registers in, and the
              browser is not the authority on that. */}
          <SelectField
            label="Country of registration"
            hint="Where the body that registered you is based. This becomes part of your permanent ID."
            required
            placeholder={
              countries.isPending
                ? 'Loading countries'
                : countries.isError
                  ? 'Could not load countries, reload the page'
                  : 'Select your country'
            }
            options={countryOptions(countries.data)}
            value={values.country}
            error={errors.country}
            onChange={(value) => set('country', value)}
          />

          <SelectField
            label="Council"
            required
            placeholder={
              councils.isPending
                ? 'Loading councils'
                : councils.isError
                  ? 'Could not load councils, reload the page'
                  : !values.country
                    ? 'Select a country first'
                    : availableCouncils.length === 0
                      ? 'No councils on record for that country yet'
                      : 'Select your council'
            }
            options={availableCouncils}
            value={values.council}
            error={errors.council}
            onChange={(value) => set('council', value)}
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

          {rateLimited && (
            <div role="alert" className="border border-border border-l-2 border-l-ink bg-surface-raised p-4">
              <p className="text-body-md font-medium text-content">Too many lookups</p>
              <p className="mt-1 text-body-sm text-content-muted">
                You have used this hour's searches. Wait an hour, or submit the claim anyway and a
                person will check it.
              </p>
            </div>
          )}

          {lookupFailed && (
            <ErrorState
              title="We could not check the register"
              body="This is a problem at our end. You can try again, or submit your claim anyway."
              onRetry={() =>
                lookupMutation.mutate({
                  council: values.council,
                  registrationNumber: values.registrationNumber,
                })
              }
              retryLabel="Try again"
            />
          )}

          {lookup && <LookupPanel result={lookup} />}

          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              variant={lookup ? 'secondary' : 'primary'}
              size="lg"
              loading={lookupMutation.isPending}
            >
              {lookupMutation.isPending ? 'Checking the register' : 'Find my registration'}
            </Button>

            {/* Available whether or not the lookup found anything. Zero
                candidates means NO_MATCH means a person looks at it, so
                somebody genuinely registered whose row has not been imported
                yet must still be able to get in front of one. */}
            {(lookup || rateLimited || lookupFailed) && (
              <Button variant="primary" size="lg" onClick={() => setStep('CONFIRM')}>
                {lookup?.outcome === 'FOUND' ? 'This is me, continue' : 'Continue anyway'}
              </Button>
            )}
          </div>
        </form>
      )}

      {step === 'CONFIRM' && (
        <form onSubmit={handleConfirm} noValidate className="space-y-7">
          {lookup?.outcome === 'FOUND' && (
            <div className="border-l-2 border-border-strong bg-surface-raised px-4 py-3 text-body-sm text-content-muted">
              The register holds <span className="font-mono text-content">{lookup.maskedName}</span>{' '}
              for {values.registrationNumber} at {lookup.councilName}.
            </div>
          )}

          {/* Typed, never prefilled from the lookup, and this is the whole
              reason the name is masked rather than shown. A prefilled name
              would score NAME_MATCH 1.00 against a string we handed the
              claimant, and that rule is required. Producing the unmasked name
              from knowledge is the evidence. */}
          <TextField
            label="Full name"
            hint="As printed on your registration certificate, including any initials."
            required
            autoComplete="name"
            value={values.fullName}
            error={errors.fullName}
            onChange={(event) => set('fullName', event.target.value)}
          />

          {/* One of five, and it is written permanently into the Immortal ID:
              HI-26INA is Ayurveda, HI-26INU is Unani. Specialty below is the
              finer answer and changes nothing about the identifier. */}
          <SelectField
            label="System of medicine"
            hint="Ayurveda, Siddha, Unani, Yoga or Traditional Chinese Medicine. This becomes part of your permanent ID and cannot be changed later."
            required
            placeholder={
              medicalSystems.isPending
                ? 'Loading systems'
                : medicalSystems.isError
                  ? 'Could not load systems, reload the page'
                  : 'Select your system of medicine'
            }
            options={medicalSystemOptions(medicalSystems.data)}
            value={values.medicalSystem}
            error={errors.medicalSystem}
            onChange={(value) => set('medicalSystem', value)}
          />

          <SelectField
            label="Specialty"
            hint="Your branch within that system. Recorded on the claim, not in your ID."
            required
            placeholder="Select your specialty"
            options={SPECIALTIES.map((s) => ({ value: s, label: s }))}
            value={values.specialty}
            error={errors.specialty}
            onChange={(value) => set('specialty', value)}
          />

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" size="lg">
              Continue
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setStep('FIND')}>
              Back
            </Button>
          </div>
        </form>
      )}

      {step === 'IDENTITY' && (
        <form onSubmit={handleSubmit} noValidate className="space-y-7">
          <IdentityStep
            photoIdDocumentId={values.photoIdDocumentId}
            selfieDocumentId={values.selfieDocumentId}
            onChange={(field, documentId) => set(field, documentId)}
          />

          {(errors.photoIdDocumentId || errors.selfieDocumentId) && (
            <p role="alert" className="text-body-sm text-content">
              {errors.photoIdDocumentId ?? errors.selfieDocumentId}
            </p>
          )}

          {failedForOtherReason && (
            <ErrorState
              title="We could not submit your claim"
              body="This is a problem at our end, not with your details."
              onRetry={() => mutation.mutate(values)}
              retryLabel="Submit again"
            />
          )}

          {/* Expectation setting sits next to the button, not in a toast after.
              A claim that goes silent is the main reason people email support.
              It says "a person" plainly, because with no liveness provider
              configured that is exactly what happens to every claim, and
              promising a minute would be a promise we do not keep. */}
          <div className="border-l-2 border-border-strong bg-surface-raised px-4 py-3 text-body-sm text-content-muted">
            Most claims are checked within a minute. Because you have sent identity documents, a
            person will also compare them, which usually takes one working day. You can close this
            page and come back to it.
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="primary" size="lg" loading={mutation.isPending}>
              {mutation.isPending ? 'Submitting' : 'Submit claim'}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setStep('CONFIRM')}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
