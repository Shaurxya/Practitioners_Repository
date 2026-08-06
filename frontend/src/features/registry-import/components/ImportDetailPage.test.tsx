import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { ImportDetailPage } from './ImportDetailPage'

function renderBatch(batchId: string) {
  return renderWithProviders(<ImportDetailPage />, {
    path: '/admin/imports/:batchId',
    initialEntries: [`/admin/imports/${batchId}`],
  })
}

describe('ImportDetailPage', () => {
  /**
   * The failure this whole screen exists for. The register's last fifty pages
   * yielded nothing, every row that did extract is perfect, and the only two
   * things that notice are the count reconciliation and the page level score.
   */
  it('refuses to let a batch that does not reconcile look clean', async () => {
    renderBatch('b-mh-aug')

    expect(await screen.findByText('does not reconcile')).toBeInTheDocument()
    expect(screen.getByText(/-543/)).toBeInTheDocument()
    expect(
      screen.getByText(/the re-verification job will treat that as delisted/i),
    ).toBeInTheDocument()
  })

  it('flags the pages that yielded nothing', async () => {
    renderBatch('b-mh-aug')

    // The fixture kills pages 263 to 312, so exactly 50 pages report zero rows.
    const dead = await screen.findAllByText('No rows extracted from this page')
    expect(dead).toHaveLength(50)
  })

  it('warns before extraction that a register is all scans', async () => {
    renderBatch('b-kl-jul')

    expect(await screen.findByText(/essentially all scans/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start extraction' })).toBeInTheDocument()
    // Unreadable pages are called out separately: they contribute nothing at all.
    expect(screen.getByText(/could not be read at all/i)).toBeInTheDocument()
  })

  it('gives a reformatted register its own actionable failure, not a generic error', async () => {
    renderBatch('b-gj-jul')

    expect(
      await screen.findByText('This document does not match its parser profile'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nothing was parsed on a guess/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
