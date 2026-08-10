import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingPanel } from '@/components/ui/States'
import { useIsAuthenticated } from '../hooks/useCurrentUser'

/**
 * Route guard for the admin console.
 *
 * Read this before trusting it: **this component enforces nothing.** It hides
 * screens from a browser. Anyone who can reach the port can call the endpoints
 * directly with curl and never load this bundle at all. Access control is the
 * server's job and lives in four layers:
 *
 *   1. network      the extraction sidecar binds to loopback and is never
 *                   published in docker compose
 *   2. identity     real accounts in a users table, BCrypt password hashes,
 *                   short lived JWTs and revocable refresh tokens
 *   3. authorization SecurityConfig denies by default, /api/v1/admin/** needs
 *                   REVIEWER or ADMIN, and the import endpoints need ADMIN
 *                   because promoting a batch decides who counts as licensed
 *   4. this file    so an unauthenticated browser gets a sign in page rather
 *                   than seven screens of empty tables and 401s
 *
 * The value of layer 4 is entirely in the last line. If it is ever the only
 * thing standing between a stranger and the promote button, the design is
 * broken somewhere in layers 1 to 3.
 */
export function RequireAdmin() {
  const location = useLocation()
  const { isAuthenticated, isResolving, user } = useIsAuthenticated()

  if (isResolving) return <LoadingPanel label="Checking your session" />

  if (!isAuthenticated || !user) {
    // The path is carried through so signing in returns you to the screen you
    // asked for, not to the console root.
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  // Reviewers work the queue, so the console is theirs too. The endpoints the
  // console calls draw the finer line: /api/v1/admin/imports is ADMIN only, so
  // a reviewer reaching the imports screen sees it refuse, which is the correct
  // place for that refusal to come from.
  if (user.role !== 'ADMIN' && user.role !== 'REVIEWER') {
    // 404 rather than a "you are not allowed" screen, matching the ownership
    // rule in section 7.3: the console does not confirm to a signed in
    // practitioner that an admin console exists at this URL.
    return <Navigate to="/404" replace />
  }

  return <Outlet />
}
