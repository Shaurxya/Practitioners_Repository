import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '@/test/utils'
import { server } from '@/mocks/server'
import { REVIEW_CASES } from '@/mocks/fixtures'
import { ReviewDetailPage } from './ReviewDetailPage'

const ambiguous = REVIEW_CASES[0]!
const noMatch = REVIEW_CASES[1]!

function renderDetail(caseId: string) {
  return renderWithProviders(<ReviewDetailPage />, {
    path: '/admin/review/:caseId',
    initialEntries: [`/admin/review/${caseId}`],
  })
}

describe('ReviewDetailPage', () => {
  it('loads everything the reviewer needs in one request', async () => {
    const calls: string[] = []
    server.events.on('request:start', ({ request }) => calls.push(new URL(request.url).pathname))

    renderDetail(ambiguous.caseId)
    await screen.findByText('LICENSE_ACTIVE')

    // Claim, candidates, rules and audit all arrive together. No waterfall.
    expect(calls.filter((path) => path.startsWith('/api/v1/admin/review'))).toHaveLength(1)
  })

  it('shows every candidate rather than silently choosing one', async () => {
    renderDetail(ambiguous.caseId)
    expect(await screen.findByText(/2 matched, pick one/)).toBeInTheDocument()
  })

  it('marks fields that differ and leaves matching fields quiet', async () => {
    renderDetail(ambiguous.caseId)
    await screen.findByText('LICENSE_ACTIVE')

    expect(screen.getByText('▲ not active')).toBeInTheDocument()
    expect(screen.getByText('▲ expired')).toBeInTheDocument()
    expect(screen.getAllByText('✓ same').length).toBeGreaterThan(0)
  })

  it('shows the rule results with their outcomes', async () => {
    renderDetail(ambiguous.caseId)
    expect(await screen.findByText('SINGLE_CANDIDATE')).toBeInTheDocument()
    expect(screen.getByText('2 candidates matched')).toBeInTheDocument()
  })

  it('refuses a blank reason before the request is sent', async () => {
    const user = userEvent.setup()
    let posted = false
    server.use(
      http.post('/api/v1/admin/review/:caseId/decide', () => {
        posted = true
        return HttpResponse.json({}, { status: 200 })
      }),
    )

    renderDetail(ambiguous.caseId)
    await screen.findByText('LICENSE_ACTIVE')

    await user.click(screen.getByRole('button', { name: /^Approve/ }))
    await user.click(screen.getByRole('button', { name: /Confirm approve/ }))

    expect(await screen.findByText('Add a reason before deciding. At least a sentence.')).toBeInTheDocument()
    expect(posted).toBe(false)
  })

  it('tells the reviewer when someone else already decided the case', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/v1/admin/review/:caseId/decide', () =>
        HttpResponse.json(
          { code: 'ALREADY_DECIDED', message: 'already decided', timestamp: '' },
          { status: 409 },
        ),
      ),
    )

    renderDetail(ambiguous.caseId)
    await screen.findByText('LICENSE_ACTIVE')

    await user.type(
      screen.getByLabelText(/Reason/),
      'License suspended by the board and not renewed.',
    )
    await user.click(screen.getByRole('button', { name: /^Reject/ }))
    await user.click(screen.getByRole('button', { name: /Confirm reject/ }))

    expect(
      await screen.findByText('This case was already decided by someone else.'),
    ).toBeInTheDocument()
  })

  it('arms and confirms from the keyboard alone', async () => {
    const user = userEvent.setup()
    renderDetail(ambiguous.caseId)
    await screen.findByText('LICENSE_ACTIVE')

    await user.keyboard('a')
    expect(await screen.findByRole('button', { name: /Confirm approve/ })).toBeInTheDocument()

    // Escape cancels rather than deciding.
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Confirm approve/ })).not.toBeInTheDocument(),
    )
  })

  it('switches candidate with a number key', async () => {
    const user = userEvent.setup()
    renderDetail(ambiguous.caseId)
    await screen.findByText(/2 matched, pick one/)

    const tabs = screen.getAllByRole('button', { name: /MH28409/ })
    expect(tabs[0]).toHaveAttribute('aria-pressed', 'true')

    await user.keyboard('2')
    await waitFor(() => expect(tabs[1]).toHaveAttribute('aria-pressed', 'true'))
  })

  it('handles a case with no candidates without pretending there is one', async () => {
    renderDetail(noMatch.caseId)
    expect(await screen.findByText('No registry rows matched this claim')).toBeInTheDocument()
  })
})
