import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { SignUpPage, validateSignUp } from './SignUpPage'

const valid = {
  fullName: 'Meera Iyer',
  email: 'meera@example.com',
  password: 'a sufficiently long passphrase',
}

describe('validateSignUp', () => {
  it('accepts a well formed signup', () => {
    expect(validateSignUp(valid)).toEqual({})
  })

  it('requires every field', () => {
    const errors = validateSignUp({ fullName: '', email: '', password: '' })
    expect(Object.keys(errors).sort()).toEqual(['email', 'fullName', 'password'])
  })

  /**
   * Length and nothing else. Composition rules push people towards Password1!,
   * which satisfies every one of them and is in the first thousand guesses of
   * any real attack.
   */
  it('asks for length rather than character classes', () => {
    expect(validateSignUp({ ...valid, password: 'Sh0rt!' }).password).toBeDefined()
    // No digits, no symbols, no capitals, and genuinely strong.
    expect(validateSignUp({ ...valid, password: 'correct horse battery staple' }).password)
      .toBeUndefined()
  })

  it('rejects a password built from the email or the name', () => {
    // The two guesses an attacker makes early against this specific person.
    expect(validateSignUp({ ...valid, password: 'meera-meera-meera' }).password).toBeDefined()
    expect(validateSignUp({ ...valid, password: 'Meera Iyer forever!!' }).password).toBeDefined()
  })

  it('rejects an address that is not one', () => {
    expect(validateSignUp({ ...valid, email: 'not-an-email' }).email).toBeDefined()
    expect(validateSignUp({ ...valid, email: 'still@wrong' }).email).toBeDefined()
  })
})

describe('SignUpPage', () => {
  it('does not submit an invalid form', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SignUpPage />, { path: '/signup', initialEntries: ['/signup'] })

    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Enter your full name.')).toBeInTheDocument()
  })

  /**
   * The public lookup must never look like it needs an account. Someone who
   * only wants to check a practitioner and signs up to do it has been made to
   * hand over an email address for nothing.
   */
  it('says checking someone else needs no account', async () => {
    renderWithProviders(<SignUpPage />, { path: '/signup', initialEntries: ['/signup'] })
    expect(screen.getByRole('link', { name: /Checking someone else/ })).toHaveAttribute(
      'href',
      '/verify',
    )
  })

  it('carries the requested path across to sign in', () => {
    renderWithProviders(<SignUpPage />, {
      path: '/signup',
      initialEntries: ['/signup?next=%2Fcases'],
    })
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fcases',
    )
  })

  it('drops an off site next rather than carrying it', () => {
    // safeNextPath refuses it, so the link must fall back to plain /login.
    renderWithProviders(<SignUpPage />, {
      path: '/signup',
      initialEntries: ['/signup?next=https%3A%2F%2Fevil.example'],
    })
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })
})
