import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '@/test/utils'
import { server } from '@/mocks/server'
import { PRACTITIONER_CASES, VERIFIED_IMMORTAL_ID } from '@/mocks/fixtures'
import { CaseStatusPage } from './CaseStatusPage'

const approved = PRACTITIONER_CASES[0]!

function renderCase(caseId: string) {
  return renderWithProviders(<CaseStatusPage />, {
    path: '/cases/:caseId',
    initialEntries: [`/cases/${caseId}`],
  })
}

describe('CaseStatusPage', () => {
  it('shows verified as of a date and the register batch, never a bare tick', async () => {
    renderCase(approved.caseId)

    expect(await screen.findByText('Verified as of 14 July 2026')).toBeInTheDocument()
    expect(screen.getByText(/council-2026-07-14/)).toBeInTheDocument()
  })

  it('shows the Immortal ID once issued', async () => {
    renderCase(approved.caseId)
    expect(await screen.findByText(VERIFIED_IMMORTAL_ID)).toBeInTheDocument()
  })

  it('shows a marked placeholder when no Immortal ID has been issued yet', async () => {
    server.use(
      http.get('/api/v1/verifications/:caseId', () =>
        HttpResponse.json({ ...approved, immortalId: null }),
      ),
    )
    renderCase(approved.caseId)
    expect(await screen.findByText(/Not yet issued/)).toBeInTheDocument()
  })

  it('explains a failure in plain language with a next action', async () => {
    server.use(
      http.get('/api/v1/verifications/:caseId', () =>
        HttpResponse.json({
          ...approved,
          status: 'REJECTED',
          outcomeCode: 'COULD_NOT_VERIFY',
          verifiedAsOf: null,
          registrySourceBatch: null,
          immortalId: null,
        }),
      ),
    )
    renderCase(approved.caseId)

    expect(await screen.findByText('We could not verify this claim')).toBeInTheDocument()
    expect(screen.getByText(/contact support/i)).toBeInTheDocument()
  })

  it('reveals nothing about the registry on a failure', async () => {
    server.use(
      http.get('/api/v1/verifications/:caseId', () =>
        HttpResponse.json({
          ...approved,
          status: 'REJECTED',
          outcomeCode: 'COULD_NOT_VERIFY',
          verifiedAsOf: null,
          registrySourceBatch: null,
          immortalId: null,
        }),
      ),
    )
    renderCase(approved.caseId)
    await screen.findByText('We could not verify this claim')

    const text = document.body.textContent ?? ''
    for (const leak of ['NAME_MATCH', 'NOT_EXPIRED', 'SUSPENDED', 'candidate', 'registry row']) {
      expect(text).not.toContain(leak)
    }
  })

  it('shows a designed error state when the case cannot be loaded', async () => {
    renderCase('does-not-exist')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Not found')).toBeInTheDocument()
  })
})
