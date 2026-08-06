import { setupWorker } from 'msw/browser'
import { handlers } from './handlers'
import { importHandlers } from './importHandlers'

/**
 * Service worker used in dev only, started from main.tsx behind a flag.
 *
 * Two switches, because the backend arrived one feature at a time and turning
 * mocks off wholesale would take down whatever Spring has not reached yet.
 *
 *   VITE_REAL_IMPORTS  registry import: upload, classify, map, extract, promote
 *   VITE_REAL_VERIFY   claims, the review queue, and the public verify endpoint
 *
 * A dropped handler is not intercepted, so the request falls through the worker
 * to the Vite proxy and reaches Spring. Auth stays mocked in both cases: Spring
 * has no /auth/login or /me yet, and taking sign in away would lock the console
 * rather than make it real.
 */
const useRealImports = import.meta.env.VITE_REAL_IMPORTS === 'true'
const useRealVerify = import.meta.env.VITE_REAL_VERIFY === 'true'

/** Everything the Spring verification pipeline now owns. */
const REAL_VERIFY_PATHS = [
  '/api/v1/verifications',
  '/api/v1/admin/review',
  '/api/v1/public/verify',
  '/api/v1/councils',
]

function isRealVerifyPath(handler: (typeof handlers)[number]): boolean {
  // Matched on the declared route rather than on identity, so adding a handler
  // under one of these prefixes cannot silently re-mock a live endpoint.
  const path = String((handler as { info?: { path?: unknown } }).info?.path ?? '')
  return REAL_VERIFY_PATHS.some((prefix) => path.startsWith(prefix))
}

const active = handlers.filter((handler) => {
  if (useRealImports && importHandlers.includes(handler)) return false
  if (useRealVerify && isRealVerifyPath(handler)) return false
  return true
})

export const worker = setupWorker(...active)
