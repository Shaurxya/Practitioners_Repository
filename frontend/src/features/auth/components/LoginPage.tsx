import type { FormEvent } from 'react'
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { setAccessToken } from '@/lib/authToken'
import { login } from '../api/authApi'

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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (auth) => {
      setAccessToken(auth.accessToken)
      void navigate('/')
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
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-xl font-semibold text-content">Sign in</h1>

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
