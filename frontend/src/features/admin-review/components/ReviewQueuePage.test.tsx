import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '@/test/utils'
import { server } from '@/mocks/server'
import { ReviewQueuePage } from './ReviewQueuePage'

function renderQueue(entry = '/admin') {
  return renderWithProviders(<ReviewQueuePage />, { path: '/admin', initialEntries: [entry] })
}

describe('ReviewQueuePage', () => {
  it('lists cases waiting for a human', async () => {
    renderQueue()
    expect(await screen.findByText('Dr. Anita Sharma')).toBeInTheDocument()
    expect(screen.getByText('Deepa Trivedi')).toBeInTheDocument()
  })

  it('shows why each case landed in the queue', async () => {
    renderQueue()
    expect(await screen.findByText(/LICENSE_ACTIVE/)).toBeInTheDocument()
  })

  it('sends filters to the server rather than filtering in the browser', async () => {
    const seen: string[] = []
    server.use(
      http.get('/api/v1/admin/review', ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json({
          content: [],
          totalElements: 0,
          totalPages: 1,
          number: 0,
          size: 25,
        })
      }),
    )

    renderQueue('/admin?q=sharma&status=MANUAL_REVIEW')

    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[0]).toContain('q=sharma')
    expect(seen[0]).toContain('status=MANUAL_REVIEW')
    // Server side pagination and sort, always.
    expect(seen[0]).toContain('page=0')
    expect(seen[0]).toContain('size=25')
    expect(seen[0]).toContain('sort=submittedAt%2Casc')
  })

  it('says the team is caught up when nothing is waiting', async () => {
    server.use(
      http.get('/api/v1/admin/review', () =>
        HttpResponse.json({
          content: [],
          totalElements: 0,
          totalPages: 1,
          number: 0,
          size: 25,
        }),
      ),
    )
    renderQueue()
    expect(await screen.findByText('No cases waiting. The queue is clear.')).toBeInTheDocument()
  })

  it('distinguishes an empty filter result from an empty queue', async () => {
    renderQueue('/admin?q=nobodyhasthisname')
    expect(await screen.findByText('No cases match these filters.')).toBeInTheDocument()
  })

  it('shows a designed error state when the queue cannot be loaded', async () => {
    server.use(
      http.get('/api/v1/admin/review', () => HttpResponse.error()),
    )
    renderQueue()
    expect(await screen.findByText('Could not load the queue')).toBeInTheDocument()
  })

  it('moves the selection with j and k without touching the mouse', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findByText('Dr. Anita Sharma')

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('j')
    await waitFor(() => expect(rows[1]).toHaveAttribute('aria-selected', 'true'))

    await user.keyboard('k')
    await waitFor(() => expect(rows[0]).toHaveAttribute('aria-selected', 'true'))
  })

  it('focuses the search box on /', async () => {
    const user = userEvent.setup()
    renderQueue()
    await screen.findByText('Dr. Anita Sharma')

    await user.keyboard('/')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByPlaceholderText('Name or registration number'),
      ),
    )
  })
})
