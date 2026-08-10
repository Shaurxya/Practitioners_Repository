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

  /**
   * The four fixed characters are the whole reason this format spends them on
   * meaning instead of entropy. If the answer does not show what they say, the
   * trade bought nothing.
   */
  it('shows what the ID decodes to, not just the string', async () => {
    renderPage(`/verify?immortalId=${VERIFIED_IMMORTAL_ID}`)
    await screen.findByText('Verified as of 14 July 2026')

    expect(screen.getByText('India')).toBeInTheDocument()
    expect(screen.getByText('Ayurveda')).toBeInTheDocument()
  })

  it('refuses a country we hold no register for, before the network', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    server.events.on('request:start', ({ request }) => calls.push(request.url))

    renderPage()
    // Well formed, and still impossible: ZZ is not a country in the table, so
    // no generator of ours could have produced this. Without a check character
    // the reference data is the only signal left that an ID is not ours.
    await user.type(screen.getByLabelText(/Immortal ID/), 'HI-26ZZA-K3M7Q')
    await user.click(screen.getByRole('button', { name: 'Check' }))

    expect(await screen.findByText(/ZZ/)).toBeInTheDocument()
    await waitFor(() => {
      expect(calls.filter((url) => url.includes('/public/verify'))).toHaveLength(0)
    })
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
    // Well formed and correctly decodable, just never issued. The point of the
    // test is that the answer is identical to an unverified one.
    const unknown = buildImmortalId(2026, 'IN', 'A', 'AAAAA')
    renderPage(`/verify?immortalId=${unknown}`)
    expect(await screen.findByText('This ID is not currently verified.')).toBeInTheDocument()
  })

  it('rejects a malformed ID without touching the network', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    server.events.on('request:start', ({ request }) => calls.push(request.url))

    renderPage()
    // HI-ZZZZZ-ZZZZZ is the old format's shape with a broken check character,
    // so it is neither a current ID nor a legacy one.
    await user.type(screen.getByLabelText(/Immortal ID/), 'HI-ZZZZZ-ZZZZZ')
    await user.click(screen.getByRole('button', { name: 'Check' }))

    expect(await screen.findByText(/not a valid Immortal ID/)).toBeInTheDocument()
    await waitFor(() => {
      expect(calls.filter((url) => url.includes('/public/verify'))).toHaveLength(0)
    })
  })
})
