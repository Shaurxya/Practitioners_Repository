/**
 * Runs before every test file. Registers the extra matchers from jest-dom,
 * such as toBeInTheDocument, on Vitest's expect, and stands up the mock API.
 *
 * onUnhandledRequest: 'error' is deliberate. A component that calls an endpoint
 * nobody wrote a handler for fails the test loudly instead of hanging on a
 * pending promise and timing out with a message about nothing in particular.
 */
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from '@/mocks/server'
import { resetMockData } from '@/mocks/handlers'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  resetMockData()
})

afterAll(() => server.close())
