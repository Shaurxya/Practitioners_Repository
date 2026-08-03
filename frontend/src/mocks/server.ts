import { setupServer } from 'msw/node'
import { handlers } from './handlers'

/**
 * Node interceptor for tests. Components then exercise the real apiClient,
 * the real fetch call and the real error branches, instead of a mocked hook
 * that cannot tell you whether any of that wiring works.
 */
export const server = setupServer(...handlers)
