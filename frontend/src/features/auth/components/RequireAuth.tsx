import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoadingPanel } from '@/components/ui/States'
import { useIsAuthenticated } from '../hooks/useCurrentUser'

/**
 * Route guard for anything that needs an account.
 *
 * Read this before trusting it: **this component enforces nothing.** It sends a
 * signed out visitor to the sign in page instead of showing them a screen of
 * 401s. Anyone who can reach the port can call the endpoints directly and never
 * load this bundle at all.
 *
 * Enforcement is the server's, in SecurityConfig, where every endpoint is
 * denied by default and the practitioner facing ones additionally check that
 * the case being read belongs to the caller. If this file is ever the only
 * thing standing between a stranger and someone's claims, the design is broken
 * somewhere else.
 *
 * <p>What it is genuinely for: the difference between "you need to sign in,
 * here is the form, and you will come straight back here" and a page that
 * renders empty tables with an error toast.
 */
export function RequireAuth() {
  const location = useLocation()
  const { isAuthenticated, isResolving } = useIsAuthenticated()

  // Resolving and signed out are different states, and conflating them
  // redirects on the first render of every guarded page, before /me has had a
  // chance to answer. The person sees a flash of the sign in form and lands
  // back where they started, which reads as a bug.
  if (isResolving) return <LoadingPanel label="Checking your session" />

  if (!isAuthenticated) {
    // The path is carried through so signing in returns you to the screen you
    // asked for, rather than to a generic landing page.
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }

  return <Outlet />
}
