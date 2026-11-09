import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/utils'
import { apiRequest } from '@/lib/apiClient'
import { PublishingLoginPage } from './PublishingLoginPage'

vi.mock('@/lib/apiClient', () => ({ apiRequest: vi.fn() }))
vi.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ data: { email: 'demo@example.test' } }),
}))

function request() {
  return new URLSearchParams({
    client_id: 'publishing-org',
    redirect_uri: 'http://localhost:5001/api/auth/immortal/callback',
    immortal_id: 'HI-26INA-DEMO1',
    state: 's'.repeat(43),
    code_challenge: 'c'.repeat(43),
    code_challenge_method: 'S256',
  })
}

function page(params: URLSearchParams) {
  renderWithProviders(<PublishingLoginPage />, {
    path: '/publishing/confirm', initialEntries: [`/publishing/confirm?${params}`],
  })
}

describe('publishing account confirmation', () => {
  beforeEach(() => { vi.mocked(apiRequest).mockReset() })

  it('shows the identity and disclosure without automatically authorizing', () => {
    page(request())
    expect(screen.getByRole('heading', { name: 'Confirm publishing sign-in' })).toBeInTheDocument()
    expect(screen.getByText('HI-26INA-DEMO1')).toBeInTheDocument()
    expect(screen.getByText(/demo@example.test/)).toBeInTheDocument()
    expect(screen.getByText(/Your password stays/)).toBeInTheDocument()
    expect(apiRequest).not.toHaveBeenCalled()
    expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer')
  })

  it.each(['missing', 'duplicate', 'plain'])('rejects a %s authorization request', (kind) => {
    const params = request()
    if (kind === 'missing') params.delete('state')
    if (kind === 'duplicate') params.append('redirect_uri', 'https://unregistered.example/callback')
    if (kind === 'plain') params.set('code_challenge_method', 'plain')
    page(params)
    expect(screen.getByRole('heading', { name: 'Start sign-in again' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(apiRequest).not.toHaveBeenCalled()
  })

  it('submits the original binding only after confirmation and reports ownership failure', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('Account does not own this ID'))
    const user = userEvent.setup()
    page(request())
    await user.click(screen.getByRole('button', { name: 'Confirm my account and continue' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('It must belong to this account'))
    const [path, init] = vi.mocked(apiRequest).mock.calls[0]!
    expect(path).toBe('/api/v1/publishing/authorize')
    expect(JSON.parse(init!.body as string)).toEqual({
      clientId: 'publishing-org', redirectUri: 'http://localhost:5001/api/auth/immortal/callback',
      immortalId: 'HI-26INA-DEMO1', state: 's'.repeat(43),
      codeChallenge: 'c'.repeat(43), codeChallengeMethod: 'S256',
    })
    expect(screen.getByRole('button')).toBeEnabled()
  })
})
