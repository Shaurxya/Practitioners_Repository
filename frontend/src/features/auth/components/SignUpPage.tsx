import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { ApiRequestError } from '@/lib/apiClient'
import { acceptSession, register } from '../api/authApi'
import { ME_QUERY_KEY } from '../hooks/useCurrentUser'
import { safeNextPath } from './safeNext'

/** Mirrors the server rule in AuthService.validatePassword. The server is the authority. */
const MIN_PASSWORD = 12

export interface SignUpErrors {
  fullName?: string
  email?: string
  password?: string
}

/**
 * Client validation, matching the server's rules so the common mistakes are
 * caught without a round trip.
 *
 * <p>Length and nothing else, deliberately. Composition rules ("one digit, one
 * symbol") push people towards Password1!, which satisfies every one of them
 * and is in the first thousand guesses of any real attack. Length is the
 * property that costs an attacker anything.
 *
 * <p>The two content checks are the ones that catch a password an attacker
 * would try early against this specific person: their own email and their own
 * name.
 */
export function validateSignUp(values: {
  fullName: string
  email: string
  password: string
}): SignUpErrors {
  const errors: SignUpErrors = {}

  if (!values.fullName.trim()) {
    errors.fullName = 'Enter your full name.'
  } else if (values.fullName.trim().length < 2) {
    errors.fullName = 'That name looks too short.'
  }

  if (!values.email.trim()) {
    errors.email = 'Enter your email address.'
  } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email.trim())) {
    errors.email = 'That does not look like an email address.'
  }

  if (!values.password) {
    errors.password = 'Choose a password.'
  } else if (values.password.length < MIN_PASSWORD) {
    errors.password = `Use at least ${MIN_PASSWORD} characters. A short phrase works well.`
  } else {
    const lower = values.password.toLowerCase()
    const localPart = values.email.trim().toLowerCase().split('@')[0] ?? ''
    if (localPart.length > 2 && lower.includes(localPart)) {
      errors.password = 'Your password cannot contain your email address.'
    } else if (values.fullName.trim().length > 3 && lower.includes(values.fullName.trim().toLowerCase())) {
      errors.password = 'Your password cannot contain your name.'
    }
  }

  return errors
}

/**
 * Create an account.
 *
 * <p>Signing up is now the front door to everything the platform does: claiming
 * a registration, reading your own claims, generating an API key. The one thing
 * it is not required for is checking somebody else's Immortal ID, which is
 * public on purpose and linked from here so nobody signs up to do it.
 */
export function SignUpPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const requested = safeNextPath(params.get('next'))

  const [values, setValues] = useState({ fullName: '', email: '', password: '' })
  const [errors, setErrors] = useState<SignUpErrors>({})
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: register,
    onSuccess: (auth) => {
      acceptSession(auth)
      // Seeded rather than refetched. The register response already carries the
      // account, so a /me call here would be a round trip whose answer we hold.
      queryClient.setQueryData(ME_QUERY_KEY, auth.user)
      // Straight in. Making someone type the password they just chose, on the
      // next screen, is friction with no security value.
      void navigate(requested ?? '/account')
    },
    onError: (error) => {
      if (error instanceof ApiRequestError) {
        setFormError(
          error.status === 409
            ? 'An account already exists for that email address.'
            : error.body.message || 'We could not create your account.',
        )
        return
      }
      setFormError('We could not create your account.')
    },
  })

  function set<K extends keyof typeof values>(key: K, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }))
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }))
    if (formError) setFormError(null)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const found = validateSignUp(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    mutation.mutate({
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      password: values.password,
    })
  }

  return (
    <div className="doc mx-auto max-w-sm space-y-8">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          Account
        </p>
        <h1>Create an account</h1>
        <p>
          You need one to claim your registration, follow a claim, or generate an API key.{' '}
          <Link to="/verify" className="underline decoration-border-strong underline-offset-4">
            Checking someone else's Immortal ID
          </Link>{' '}
          needs no account at all.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <TextField
          label="Full name"
          required
          autoComplete="name"
          value={values.fullName}
          error={errors.fullName}
          onChange={(event) => set('fullName', event.target.value)}
        />
        <TextField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={values.email}
          error={errors.email}
          onChange={(event) => set('email', event.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          required
          hint="At least 12 characters. A short phrase you will remember beats a short password you will not."
          autoComplete="new-password"
          value={values.password}
          error={errors.password}
          onChange={(event) => set('password', event.target.value)}
        />

        {formError && (
          <p role="alert" className="text-sm text-rejected">
            {formError}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={mutation.isPending}
          className="w-full"
        >
          {mutation.isPending ? 'Creating your account' : 'Create account'}
        </Button>
      </form>

      <p className="text-body-sm text-content-muted">
        Already have an account?{' '}
        <Link
          to={requested ? `/login?next=${encodeURIComponent(requested)}` : '/login'}
          className="underline decoration-border-strong underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
