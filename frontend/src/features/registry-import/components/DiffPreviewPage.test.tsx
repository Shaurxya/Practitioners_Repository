import { describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '@/test/utils'
import { server } from '@/mocks/server'
import { BATCHES } from '@/mocks/importFixtures'
import type { ImportBatchDetail } from '../types'
import { DiffPreviewPage } from './DiffPreviewPage'

function renderPreview(entry = '/admin/imports/b-mh-aug/review') {
  return renderWithProviders(<DiffPreviewPage />, {
    path: '/admin/imports/:batchId/review',
    initialEntries: [entry],
  })
}

describe('DiffPreviewPage', () => {
  it('asks the server for the worst rows first, rather than sorting in the browser', async () => {
    const seen: string[] = []
    server.use(
      http.get('/api/v1/admin/imports/:batchId/staging', ({ request }) => {
        seen.push(new URL(request.url).search)
        return HttpResponse.json({
          content: [],
          totalElements: 0,
          totalPages: 1,
          number: 0,
          size: 50,
        })
      }),
    )

    renderPreview()
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[0]).toContain('sort=rowConfidence%2Casc')
    // Defaults to the rows that need a decision, not to all twelve thousand.
    expect(seen[0]).toContain('needsConfirmation=true')
  })

  it('puts the lowest confidence licence number at the top and flags it', async () => {
    renderPreview()

    // The 0.61 row is the worst in the fixture: O read for 0 twice.
    expect(await screen.findByText('MH/O4471/2O18')).toBeInTheDocument()

    const rows = screen.getAllByRole('row')
    // Row 0 is the header, so the first data row is the worst scoring one.
    expect(within(rows[1] as HTMLElement).getByText('MH/O4471/2O18')).toBeInTheDocument()
  })

  it('names the specific reason a licence number is held, not just "low confidence"', async () => {
    const user = userEvent.setup()
    renderPreview()

    await screen.findByText('MH/O4471/2O18')
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0] as HTMLElement)

    expect(
      await screen.findByText(/characters OCR commonly confuses/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/does not match this register/i)).toBeInTheDocument()
  })

  it('marks the diff stale after a correction, because the natural key may have moved', async () => {
    const user = userEvent.setup()
    renderPreview()

    await screen.findByText('MH/O4471/2O18')
    await user.click(screen.getAllByRole('button', { name: 'Open' })[0] as HTMLElement)

    const field = await screen.findByLabelText('Correct Licence number')
    await user.type(field, 'MH/04471/2018')
    await user.click(screen.getByRole('button', { name: 'Save corrections' }))

    expect(
      await screen.findByText(/been corrected since the diff was computed/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recompute diff' })).toBeInTheDocument()

    // And the warning survives the corrected row dropping out of the default
    // filter, which is exactly when it would be easiest to lose.
    expect(screen.queryByText('MH/O4471/2O18')).not.toBeInTheDocument()
    expect(screen.getByText(/Recompute it first/)).toBeInTheDocument()
  })

  /**
   * b-mh-aug is the fixture that deliberately does not reconcile, and that is a
   * separate blocker doing its job. These two tests are about the confirmation
   * gate, so they run against the same batch with the count gap closed.
   */
  function reconciling() {
    const original = BATCHES.find((b) => b.id === 'b-mh-aug') as ImportBatchDetail
    const batch = {
      ...structuredClone(original),
      reconciliation: { ...structuredClone(original.reconciliation!), gap: 0 },
    }
    server.use(http.get('/api/v1/admin/imports/b-mh-aug', () => HttpResponse.json(batch)))
    return batch
  }

  /**
   * Partial promotion. Held rows no longer hold the batch hostage, but the
   * admin has to be told before the click that some are staying behind:
   * "Promote" reads as "promote all of it", and someone who does not know
   * otherwise closes the tab believing the import is finished.
   */
  it('promotes the ready rows and says how many are staying behind', async () => {
    reconciling()
    renderPreview()
    await screen.findByText('MH/O4471/2O18')

    expect(screen.getByRole('button', { name: /Promote to live registry/ })).toBeEnabled()
    expect(screen.getByText(/7 still need confirming and stay here/i)).toBeInTheDocument()
  })

  /**
   * The held rows are the entire point of holding them. If promotion cleared
   * the screen, the nine rows a person still has to read would be invisible and
   * the batch would look finished.
   */
  it('leaves the held rows on the page after promoting', async () => {
    const user = userEvent.setup()
    reconciling()
    renderPreview()
    await screen.findByText('MH/O4471/2O18')

    await user.click(screen.getByRole('button', { name: /Promote to live registry/ }))
    await user.type(
      screen.getByLabelText(/Reason, recorded in the audit log/i),
      'First pass of the August register.',
    )
    await user.click(screen.getByRole('button', { name: 'Confirm promotion' }))

    expect(await screen.findByText(/7 rows held back and still listed below/i)).toBeInTheDocument()
    // Still the worst row on the screen, still not in the registry.
    expect(screen.getByText('MH/O4471/2O18')).toBeInTheDocument()
  })
})
