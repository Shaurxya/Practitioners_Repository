import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
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

  it('accepts the registration number shapes that appear in the real registry', () => {
    // KA35652, kl42804, MH-28409, KL 16405, GJ 14549, and bare digits, since
    // 10.3% of registry rows omit the council prefix entirely.
    for (const number of ['KA35652', 'kl42804', 'MH-28409', 'KL 16405', 'GJ 14549', '28409']) {
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

  it('offers the councils the registry actually recognises', () => {
    renderWithProviders(<SubmitCasePage />)
    expect(screen.getByRole('option', { name: 'Maharashtra Council of Indian Medicine' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Kerala State Medical Council (Indian Systems of Medicine)' })).toBeInTheDocument()
  })

  it('uses plain language, never database vocabulary', () => {
    renderWithProviders(<SubmitCasePage />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Registration number')
    expect(text).not.toContain('license_no')
    expect(text).not.toContain('License')
  })
})
