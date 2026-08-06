import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { setAccessToken } from '@/lib/authToken'
import { fetchCurrentUser, login } from '../api/authApi'

/**
 * The form only. Real authentication lands in phase 8, and this deliberately
 * does not pretend otherwise: there is no route guard behind it yet.
 *
 * One rule already applied: a failed login says the same thing whether the
 * email exists or not. The server side of that has a matching obligation, and a
 * harder one, since skipping the password hash for an unknown email leaks
 * existence through response timing even when the words are identical.
 */
export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  /**
   * Where to go after signing in. RequireAdmin puts the screen you asked for
   * here, so a bookmarked console URL survives the round trip through login.
   *
   * Only same origin paths are honoured. An unvalidated `next` is an open
   * redirect: a link to our own login page carrying next=https://evil.example
   * would send someone who trusts this domain somewhere else, having just typed
   * their password.
   */
  const next = params.get('next') ?? ''
  const requested = next.startsWith('/') && !next.startsWith('//') ? next : null

  const mutation = useMutation({
    mutationFn: login,
    /**
     * Signing in has to land somewhere the account can act.
     *
     * Sending everyone to "/" put an admin on the public marketing page with no
     * sign they were signed in and no route to the console, which is
     * indistinguishable from the login having failed. So the role decides:
     * fetched here rather than read from the token, because the token is opaque
     * to the client and the server is the only thing allowed to say what an
     * account may do.
     *
     * A requested path still wins. That is the bookmarked console URL surviving
     * the round trip through RequireAdmin, and it is already validated as same
     * origin above.
     *
     * fetchQuery rather than a bare call, so the result is seeded into the same
     * ['me'] cache RequireAdmin reads. Without that the guard refetches on
     * arrival and the console flashes its loading state for no reason.
     */
    onSuccess: async (auth) => {
      setAccessToken(auth.accessToken)
      const user = await queryClient.fetchQuery({
        queryKey: ['me'],
        queryFn: fetchCurrentUser,
      })
      void navigate(requested ?? (user.role === 'ADMIN' ? '/admin' : '/cases'))
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
    </div>
  )
}
