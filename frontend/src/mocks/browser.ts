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
 * to the Vite proxy and reaches Spring.
 *
 * Auth used to be excluded from this, because Spring had no /auth/login and
 * taking sign in away would have locked the console rather than made it real.
 * It has one now, with a users table behind it, so auth goes through with the
 * rest. Leaving it mocked would be worse than useless: the mock accounts do not
 * exist in Postgres, so a token minted by the fixture would be rejected by
 * every endpoint the same fixture no longer intercepts, and the console would
 * appear to sign in and then fail on every request.
 */
const useRealImports = import.meta.env.VITE_REAL_IMPORTS === 'true'
const useRealVerify = import.meta.env.VITE_REAL_VERIFY === 'true'

/**
 * Everything the Spring verification pipeline now owns.
 *
 * Countries and medical systems belong on this list the moment councils does,
 * and not one release later. All three are read by the same form, and two of
 * them feed the Immortal ID: a council list from Spring next to a medical
 * system list from a fixture is a form whose two halves can disagree about what
 * exists, and the disagreement writes a character into a permanent identifier.
 */
const REAL_VERIFY_PATHS = [
  '/api/v1/verifications',
  '/api/v1/admin/review',
  '/api/v1/public/verify',
  // Identity documents. On this list from the moment claims are, and not one
  // release later: a mocked upload returns a document id that Postgres has
  // never heard of, and the claim it is attached to is then rejected by a
  // server that cannot find it. Two halves of one form disagreeing about
  // whether a passport exists.
  '/api/v1/documents',
  '/api/v1/councils',
  '/api/v1/countries',
  '/api/v1/medical-systems',
  // Accounts. All of these are real from phase 8 onwards.
  '/api/v1/auth',
  '/api/v1/me',
  '/api/v1/internal',
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
