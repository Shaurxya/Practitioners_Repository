import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ColumnMappingPage } from './ColumnMappingPage'

function renderMapping(batchId: string) {
  return renderWithProviders(<ColumnMappingPage />, {
    path: '/admin/imports/:batchId/mapping',
    initialEntries: [`/admin/imports/${batchId}/mapping`],
  })
}

const confirmButton = () =>
  screen.getByRole('button', { name: 'Confirm mapping and extract' })

describe('ColumnMappingPage', () => {
  /**
   * The regression this file exists for. The MH register prints no council
   * column, because the council publishes it and does not repeat its own name on
   * every line. Requiring council as a mapped column left this screen with no
   * reachable confirm state at all, for the most ordinary document there is.
   */
  it('confirms a register that has no council column', async () => {
    renderMapping('b-new-shape')

    await waitFor(() => expect(confirmButton()).toBeEnabled())
    expect(screen.queryByText(/Not mapped yet/)).not.toBeInTheDocument()
  })

  it('shows which council the rows will be stamped with, and where it came from', async () => {
    renderMapping('b-new-shape')

    expect(await screen.findByText('Council for every row')).toBeInTheDocument()
    expect(screen.getByText('MH')).toBeInTheDocument()
    expect(screen.getByText(/Maharashtra Council of Indian Medicine, from the batch/)).toBeInTheDocument()
  })

  it('blocks confirming while a genuinely required field is unmapped', async () => {
    const user = userEvent.setup()
    renderMapping('b-new-shape')

    await waitFor(() => expect(confirmButton()).toBeEnabled())

    // Column 0 is the licence number, which no batch level default can supply.
    await user.selectOptions(
      screen.getByRole('combobox', { name: /Map column 0/ }),
      '',
    )

    expect(await screen.findByText(/Not mapped yet: Licence number/)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  /**
   * Two columns claiming one field is the silent mismapping this screen exists
   * to prevent: every row parses and the wrong column wins.
   */
  it('blocks confirming when one field is claimed by two columns', async () => {
    const user = userEvent.setup()
    renderMapping('b-new-shape')

    await waitFor(() => expect(confirmButton()).toBeEnabled())

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Map column 2/ }),
      'licenseNo',
    )

    expect(await screen.findByText(/Mapped twice: Licence number/)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()
  })

  /**
   * Gujarat does print a council per row, so the field stays mappable and
   * mapping it must not read as a duplicate of the batch level default.
   */
  it('still allows a council column for registers that print one', async () => {
    const user = userEvent.setup()
    renderMapping('b-gj-jul')

    const column3 = await screen.findByRole('combobox', { name: /Map column 3/ })
    await user.selectOptions(column3, 'council')

    expect(screen.queryByText(/Mapped twice/)).not.toBeInTheDocument()
  })

  /**
   * A register that prints no status blocks until the admin says so explicitly.
   * The assertion is the point: a forgotten mapping and a document that has no
   * status column look identical in the column map and need opposite outcomes.
   */
  it('blocks a register that prints no status column until it is acknowledged', async () => {
    const user = userEvent.setup()
    renderMapping('b-gj-jul')

    expect(await screen.findByText(/Not mapped yet: Status/)).toBeInTheDocument()
    expect(confirmButton()).toBeDisabled()

    await user.click(
      screen.getByRole('checkbox', { name: /does not publish a standing status/i }),
    )

    expect(screen.queryByText(/Not mapped yet/)).not.toBeInTheDocument()
    await waitFor(() => expect(confirmButton()).toBeEnabled())
  })

  it('says what acknowledging costs, rather than leaving it to be discovered', async () => {
    renderMapping('b-gj-jul')

    expect(await screen.findByText(/promotes as UNKNOWN/)).toBeInTheDocument()
    expect(screen.getByText(/goes to the review queue/i)).toBeInTheDocument()
  })

  /** The escape hatch must not be offered against a register that does have one. */
  it('does not offer the acknowledgement once a status column is mapped', async () => {
    renderMapping('b-new-shape')

    await waitFor(() => expect(confirmButton()).toBeEnabled())
    expect(
      screen.queryByRole('checkbox', { name: /does not publish a standing status/i }),
    ).not.toBeInTheDocument()
  })
})
