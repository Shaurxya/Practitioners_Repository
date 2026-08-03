import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { server } from '@/mocks/server'
import { VERIFIED_IMMORTAL_ID } from '@/mocks/fixtures'
import { buildImmortalId } from '../immortalId'
import { PublicVerifyPage } from './PublicVerifyPage'

function renderPage(entry = '/verify') {
  return renderWithProviders(<PublicVerifyPage />, { path: '/verify', initialEntries: [entry] })
}

describe('PublicVerifyPage', () => {
  it('returns a minimal verified payload for a known ID', async () => {
    renderPage(`/verify?immortalId=${VERIFIED_IMMORTAL_ID}`)

    expect(await screen.findByText('Verified as of 14 July 2026')).toBeInTheDocument()
    expect(screen.getByText('A. Sharma')).toBeInTheDocument()
    expect(screen.getByText('council-2026-07-14')).toBeInTheDocument()
  })

  it('reveals nothing beyond name, council, date and batch', async () => {
    renderPage(`/verify?immortalId=${VERIFIED_IMMORTAL_ID}`)
    await screen.findByText('Verified as of 14 July 2026')

    const text = document.body.textContent ?? ''
    // No registration number, no case history, no internal codes.
    for (const leak of ['MH28409', 'MH-28409', 'MANUAL_REVIEW', 'NAME_MATCH', 'candidate']) {
      expect(text).not.toContain(leak)
    }
  })

  it('makes an unknown ID indistinguishable from an unverified one', async () => {
    const unknown = buildImmortalId('AAAAAAAAA')
    renderPage(`/verify?immortalId=${unknown}`)
    expect(await screen.findByText('This ID is not currently verified.')).toBeInTheDocument()
  })

  it('rejects a malformed ID without touching the network', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    server.events.on('request:start', ({ request }) => calls.push(request.url))

    renderPage()
    await user.type(screen.getByLabelText(/Immortal ID/), 'HI-ZZZZZ-ZZZZZ')
    await user.click(screen.getByRole('button', { name: 'Check' }))

    expect(
      await screen.findByText('That is not a valid Immortal ID. Check the characters and try again.'),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(calls.filter((url) => url.includes('/public/verify'))).toHaveLength(0)
    })
  })
})
