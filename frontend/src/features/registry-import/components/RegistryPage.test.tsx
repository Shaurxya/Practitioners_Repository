import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { resetMockData } from '@/mocks/handlers'
import { addRegistryRows, licenceKeys, normalizeName } from '@/mocks/verificationEngine'
import { RegistryPage } from './RegistryPage'

function record(over: Partial<Parameters<typeof addRegistryRows>[0][number]> = {}) {
  const licenceRaw = over.licenceRaw ?? 'NR/AY/GA/0000001'
  const councilCode = over.councilCode ?? 'GA'
  const fullNameRaw = over.fullNameRaw ?? 'ANITA R SHARMA'
  return {
    councilCode,
    licenceRaw,
    licenceKeys: licenceKeys(licenceRaw, councilCode),
    fullNameRaw,
    fullNameNormalized: normalizeName(fullNameRaw),
    status: 'ACTIVE',
    validUntil: '2030-03-31',
    specialty: 'Ayurveda',
    sourceBatch: 'ga-2026-08-05',
    ...over,
  }
}

function renderRegistry(entry = '/admin/registry') {
  return renderWithProviders(<RegistryPage />, {
    path: '/admin/registry',
    initialEntries: [entry],
  })
}

beforeEach(() => resetMockData(false))

describe('RegistryPage', () => {
  it('says the registry is empty and how to fill it', async () => {
    renderRegistry()

    expect(await screen.findByText('The registry is empty.')).toBeInTheDocument()
    expect(screen.getByText(/promote the rows you have checked/i)).toBeInTheDocument()
  })

  it('lists records promoted from an import', async () => {
    addRegistryRows([
      record(),
      record({ licenceRaw: 'NR/AY/GA/0000006', fullNameRaw: 'AMIT K PATIL' }),
    ])
    renderRegistry()

    expect(await screen.findByText('NR/AY/GA/0000001')).toBeInTheDocument()
    expect(screen.getByText('AMIT K PATIL')).toBeInTheDocument()
    expect(screen.getByText('2 records')).toBeInTheDocument()
  })

  /**
   * Filtering happens on the server. If the console narrowed a page of results
   * in the browser, the count beside a filter would describe the page rather
   * than the register, which is the number an admin acts on.
   */
  it('searches by name and by registration number', async () => {
    const user = userEvent.setup()
    addRegistryRows([
      record(),
      record({ licenceRaw: 'NR/AY/GA/0000006', fullNameRaw: 'AMIT K PATIL' }),
    ])
    renderRegistry()
    await screen.findByText('AMIT K PATIL')

    await user.type(screen.getByLabelText(/Search by name or registration number/), 'PATIL')

    await waitFor(() => expect(screen.queryByText('ANITA R SHARMA')).not.toBeInTheDocument())
    expect(screen.getByText('AMIT K PATIL')).toBeInTheDocument()
  })

  /** 10.3% of rows omit the council prefix, so both forms have to find the row. */
  it('finds a record whether or not the search carries punctuation', async () => {
    const user = userEvent.setup()
    addRegistryRows([record()])
    renderRegistry()
    await screen.findByText('NR/AY/GA/0000001')

    await user.type(screen.getByLabelText(/Search by name or registration number/), 'NRAYGA0000001')
    await waitFor(() => expect(screen.getByText('NR/AY/GA/0000001')).toBeInTheDocument())
  })

  it('filters by council without mixing two registers together', async () => {
    const user = userEvent.setup()
    addRegistryRows([
      record(),
      record({ councilCode: 'MH', licenceRaw: 'MH-28409', fullNameRaw: 'VIKRAM S JOSHI' }),
    ])
    renderRegistry()
    await screen.findByText('VIKRAM S JOSHI')

    await user.selectOptions(screen.getByLabelText(/Filter by council/), 'MH')

    await waitFor(() => expect(screen.queryByText('ANITA R SHARMA')).not.toBeInTheDocument())
    expect(screen.getByText('VIKRAM S JOSHI')).toBeInTheDocument()
  })

  it('distinguishes an empty filter result from an empty registry', async () => {
    const user = userEvent.setup()
    addRegistryRows([record()])
    renderRegistry()
    await screen.findByText('ANITA R SHARMA')

    await user.type(screen.getByLabelText(/Search by name or registration number/), 'nobodyhere')

    expect(await screen.findByText('No records match these filters.')).toBeInTheDocument()
    expect(screen.queryByText('The registry is empty.')).not.toBeInTheDocument()
  })

  /**
   * A status the register never published must not read as good standing. It is
   * toned as a question, and counted separately from active.
   */
  it('shows an unknown status as its own thing, not as active', async () => {
    addRegistryRows([record({ status: 'UNKNOWN', validUntil: null })])
    renderRegistry()

    const row = (await screen.findByText('NR/AY/GA/0000001')).closest('tr') as HTMLElement
    expect(within(row).getByText('UNKNOWN')).toBeInTheDocument()
    // No expiry published, shown as absent rather than as a date.
    expect(within(row).getByText('–')).toBeInTheDocument()
  })

  it('shows which batch each record came from', async () => {
    addRegistryRows([record({ sourceBatch: 'ga-2026-08-05' })])
    renderRegistry()

    expect(await screen.findByText('ga-2026-08-05')).toBeInTheDocument()
  })
})
