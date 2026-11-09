import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { apiRequest } from '@/lib/apiClient'
import { useCurrentUser } from '../hooks/useCurrentUser'

function validRequest(params: URLSearchParams): boolean {
  const required = ['client_id', 'redirect_uri', 'immortal_id', 'state', 'code_challenge', 'code_challenge_method']
  return required.every((key) => params.getAll(key).length === 1 && Boolean(params.get(key)))
    && params.get('code_challenge_method') === 'S256'
    && /^[A-Za-z0-9_-]{32,200}$/.test(params.get('state') ?? '')
    && /^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') ?? '')
}

export function PublishingLoginPage() {
  const [params] = useSearchParams()
  const user = useCurrentUser()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const complete = validRequest(params)
  useEffect(() => {
    const element = document.createElement('meta')
    element.name = 'referrer'; element.content = 'no-referrer'; document.head.append(element)
    return () => element.remove()
  }, [])
  async function confirm() {
    if (!complete) return
    setBusy(true); setError('')
    try {
      const result = await apiRequest<{ redirectUrl: string }>('/api/v1/publishing/authorize', {
        method: 'POST', body: JSON.stringify({
          clientId: params.get('client_id'), redirectUri: params.get('redirect_uri'),
          immortalId: params.get('immortal_id'), state: params.get('state'),
          codeChallenge: params.get('code_challenge'), codeChallengeMethod: params.get('code_challenge_method'),
        }),
      })
      window.location.replace(result.redirectUrl)
    } catch { setError('Unable to confirm this ID. It must belong to this account and have current approval and an active registry registration. You can retry or complete verification first.') }
    finally { setBusy(false) }
  }
  if (!complete) return <section className="doc mx-auto max-w-xl space-y-6">
    <h1>Start sign-in again</h1>
    <p role="alert">This publishing sign-in request is incomplete or invalid. Return to the publishing website and start a new Immortal ID sign-in.</p>
  </section>

  return <section className="doc mx-auto max-w-xl space-y-6">
    <header className="page-head page-head--ruled"><p className="mono-label">Account confirmation</p><h1>Confirm publishing sign-in</h1></header>
    <p className="text-content-muted">You are signed into HerbImmortal as {user.data?.email}.</p>
    <p>Continue to HerbImmortal publishing using <strong>{params.get('immortal_id')}</strong>?</p>
    <p className="text-content-muted">Your account name, email and current practitioner identity will be shared to create or connect your publishing account. Your password stays on this verification service.</p>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <Button onClick={confirm} loading={busy}>Confirm my account and continue</Button>
    <p className="text-content-muted">To cancel, close this page. No publishing session is created until you confirm.</p>
  </section>
}
