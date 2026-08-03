import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { render } from '@testing-library/react'

/**
 * A fresh QueryClient per test. Sharing one leaks cached data between tests and
 * produces the worst kind of failure: one that only appears in a particular
 * file order.
 *
 * retry: false so an expected 404 or 409 surfaces immediately instead of being
 * retried three times into a test timeout.
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

interface Options {
  /** Route pattern, when the component reads useParams. */
  path?: string
  initialEntries?: string[]
}

export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const { path = '/', initialEntries = ['/'] } = options
  const queryClient = createTestQueryClient()

  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { ...result, queryClient }
}
