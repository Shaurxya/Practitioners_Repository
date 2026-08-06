import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { SubmitCasePage, validateClaim } from './SubmitCasePage'

describe('validateClaim', () => {
  const valid = {
    fullName: 'Anita Sharma',
    registrationNumber: 'MH-28409',
    council: 'MH',
    specialty: 'Panchakarma',
  }

  it('accepts a well formed claim', () => {
    expect(validateClaim(valid)).toEqual({})
  })

  it('requires every field', () => {
    const errors = validateClaim({ fullName: '', registrationNumber: '', council: '', specialty: '' })
    expect(Object.keys(errors)).toHaveLength(4)
  })

  /**
   * Every council numbers its register differently, so this check cannot be a
   * shape. The old rule allowed at most two leading letters and six digits,
   * which rejected the NCISM national format and told a Goa practitioner that
   * their own registration number was not one.
   */
  it('accepts the registration number shapes that appear in the real registry', () => {
    for (const number of [
      'KA35652',
      'kl42804',
      'MH-28409',
      'KL 16405',
      'GJ 14549',
      '28409', // 10.3% of registry rows omit the council prefix entirely
      'NR/AY/GA/0000001', // NCISM provisional national register
      'nr/ay/mh/0012345',
      'NR-AY-KL-0004821',
    ]) {
      expect(validateClaim({ ...valid, registrationNumber: number }).registrationNumber).toBeUndefined()
    }
  })

  it('rejects input that cannot be a registration number', () => {
    for (const number of ['abc', '12', 'not a number at all']) {
      expect(validateClaim({ ...valid, registrationNumber: number }).registrationNumber).toBeDefined()
    }
  })
})

describe('SubmitCasePage', () => {
  it('sets expectations about what happens next, on the form itself', () => {
    renderWithProviders(<SubmitCasePage />)
    expect(screen.getByText(/Most claims are checked within a minute/)).toBeInTheDocument()
  })

  it('does not submit an invalid claim', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await user.click(screen.getByRole('button', { name: 'Submit claim' }))
    expect(await screen.findByText('Enter your full name as it appears on the register.')).toBeInTheDocument()
  })

  /**
   * The list comes from the server, not from a constant in this bundle. It was
   * hardcoded to the four councils V2 seeded, so when a migration added the
   * remaining states this form silently went on offering four and a
   * practitioner registered in Goa could not describe themselves at all.
   */
  /** Scoped to the council select: the form also has a specialty one. */
  async function councilOptions() {
    const select = await screen.findByRole('combobox', { name: /Council/ })
    await within(select).findByRole('option', { name: 'Maharashtra Council of Indian Medicine' })
    return within(select).getAllByRole('option')
  }

  it('offers every council the registry holds, not a hardcoded few', async () => {
    renderWithProviders(<SubmitCasePage />)
    const options = await councilOptions()
    const labels = options.map((o) => o.textContent ?? '')

    expect(labels).toContain('Goa Board of Indian System of Medicine and Homoeopathy')
    expect(labels).toContain('Tamil Nadu')
    expect(labels).toContain('West Bengal')
    // 36 states and union territories, plus the placeholder.
    expect(options).toHaveLength(37)
  })

  it('sorts councils by the name a person reads, not by code', async () => {
    renderWithProviders(<SubmitCasePage />)
    const labels = (await councilOptions()).slice(1).map((o) => o.textContent ?? '')

    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
  })

  it('uses plain language, never database vocabulary', () => {
    renderWithProviders(<SubmitCasePage />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Registration number')
    expect(text).not.toContain('license_no')
    expect(text).not.toContain('License')
  })
})
