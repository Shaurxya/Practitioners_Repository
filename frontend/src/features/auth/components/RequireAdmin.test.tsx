import { afterEach, describe, expect, it } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { render, screen } from '@testing-library/react'
import { createTestQueryClient } from '@/test/utils'
import { clearAccessToken, setAccessToken } from '@/lib/authToken'
import { RequireAdmin } from './RequireAdmin'

/**
 * The guard is only worth testing against a /me that can actually say no. It
 * used to sit in front of a mock that returned the admin account
 * unconditionally, with no token involved, so it admitted everyone and the
 * console was effectively public while looking guarded.
 */
/** Renders where the guard sent us, so the `next` round trip is assertable. */
function SignInProbe() {
  const { search } = useLocation()
  return <p>Sign in page{search}</p>
}

function renderGuard(entry = '/admin') {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin/*" element={<RequireAdmin />}>
            <Route index element={<p>Console contents</p>} />
          </Route>
          <Route path="/login" element={<SignInProbe />} />
          <Route path="/404" element={<p>Not found page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ADMIN_TOKEN = 'mock.access.admin@herbimmortal.test'
const PRACTITIONER_TOKEN = 'mock.access.anita@example.com'

afterEach(() => clearAccessToken())

describe('RequireAdmin', () => {
  it('sends a signed out visitor to the sign in page', async () => {
    renderGuard()

    expect(await screen.findByText(/Sign in page/)).toBeInTheDocument()
    expect(screen.queryByText('Console contents')).not.toBeInTheDocument()
  })

  it('admits an admin', async () => {
    setAccessToken(ADMIN_TOKEN)
    renderGuard()

    expect(await screen.findByText('Console contents')).toBeInTheDocument()
  })

  /**
   * 404 rather than "you are not allowed", matching the ownership rule in
   * section 7.3: the console does not confirm to a signed in practitioner that
   * an admin console exists at this URL.
   */
  it('does not confirm the console exists to a signed in practitioner', async () => {
    setAccessToken(PRACTITIONER_TOKEN)
    renderGuard()

    expect(await screen.findByText('Not found page')).toBeInTheDocument()
    expect(screen.queryByText('Console contents')).not.toBeInTheDocument()
  })

  it('carries the requested path through, so a bookmarked console URL survives', async () => {
    renderGuard('/admin/imports/some-batch')
    expect(
      await screen.findByText('Sign in page?next=%2Fadmin%2Fimports%2Fsome-batch'),
    ).toBeInTheDocument()
  })
})
