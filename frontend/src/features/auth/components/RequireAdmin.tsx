import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingPanel } from '@/components/ui/States'
import { useCurrentUser } from '../hooks/useCurrentUser'

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
 *   2. identity     one admin account, password hash from configuration, short
 *                   lived JWT, no users table because there is exactly one user
 *   3. authorization @PreAuthorize("hasRole('ADMIN')") on every admin endpoint,
 *                   plus a single allowed subject in configuration
 *   4. this file    so an unauthenticated browser gets a sign in page rather
 *                   than seven screens of empty tables and 401s
 *
 * The value of layer 4 is entirely in the last line. If it is ever the only
 * thing standing between a stranger and the promote button, the design is
 * broken somewhere in layers 1 to 3.
 */
export function RequireAdmin() {
  const location = useLocation()
  const user = useCurrentUser()

  if (user.isPending) return <LoadingPanel label="Checking your session" />

  if (user.isError || !user.data) {
    // The path is carried through so signing in returns you to the screen you
    // asked for, not to the console root.
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  if (user.data.role !== 'ADMIN') {
    // 404 rather than a "you are not allowed" screen, matching the ownership
    // rule in section 7.3: the console does not confirm to a signed in
    // practitioner that an admin console exists at this URL.
    return <Navigate to="/404" replace />
  }

  return <Outlet />
}
