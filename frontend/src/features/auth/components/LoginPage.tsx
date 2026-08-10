import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { acceptSession, login } from '../api/authApi'
import { ME_QUERY_KEY } from '../hooks/useCurrentUser'
import { safeNextPath } from './safeNext'

/**
 * Sign in.
 *
 * One rule visible here and enforced on both sides: a failed sign in says the
 * same thing whether the email exists or not. The server has the harder half of
 * that obligation and meets it, since skipping the password hash for an unknown
 * email would leak existence through response timing even with identical words.
 * See AuthService.decoyHash.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  /**
   * Where to go after signing in. The guards put the screen you asked for here,
   * so a bookmarked console URL survives the round trip through sign in.
   *
   * Validated in safeNext, shared with the sign up page: an unvalidated `next`
   * is an open redirect.
   */
  const requested = safeNextPath(params.get('next'))

  const mutation = useMutation({
    mutationFn: login,
    /**
     * Signing in has to land somewhere the account can act.
     *
     * Sending everyone to "/" put an admin on the public marketing page with no
     * sign they were signed in and no route to the console, which is
     * indistinguishable from the sign in having failed. So the role decides,
     * and the role comes from the server rather than from anything the client
     * decoded: the token is opaque here on purpose.
     *
     * A requested path still wins. That is the bookmarked console URL surviving
     * the round trip through a guard, already validated as same origin.
     *
     * The account arrives with the tokens now, so this seeds the ['me'] cache
     * directly instead of fetching it. That removes a round trip from every
     * sign in, and removes the loading flash the guards used to show on arrival.
     */
    onSuccess: (auth) => {
      acceptSession(auth)
      queryClient.setQueryData(ME_QUERY_KEY, auth.user)
      const canReview = auth.user.role === 'ADMIN' || auth.user.role === 'REVIEWER'
      void navigate(requested ?? (canReview ? '/admin' : '/cases'))
    },
    onError: () => {
      setFormError('That email and password do not match an account.')
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    if (!email.trim() || !password) {
      setFormError('Enter your email and password.')
      return
    }
    mutation.mutate({ email: email.trim(), password })
  }

  return (
    <div className="doc mx-auto max-w-sm space-y-8">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          Account
        </p>
        <h1>Sign in</h1>
      </header>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <TextField
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <TextField
          label="Password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
          {mutation.isPending ? 'Signing in' : 'Sign in'}
        </Button>
      </form>

      <p className="text-body-sm text-content-muted">
        No account yet?{' '}
        <Link
          to={requested ? `/signup?next=${encodeURIComponent(requested)}` : '/signup'}
          className="underline decoration-border-strong underline-offset-4"
        >
          Create one
        </Link>
      </p>
    </div>
  )
}
