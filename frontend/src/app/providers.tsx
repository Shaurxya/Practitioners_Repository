import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { setSessionExpiredHandler } from '@/lib/apiClient'

/**
 * Every context provider the app needs, in one place.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  useSessionExpiryRedirect()
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/**
 * What happens when a session ends for real.
 *
 * <p>apiClient refreshes silently on a 401, so an expired access token is
 * invisible. This is the other case: the refresh token is gone or was revoked,
 * which happens on sign out elsewhere, an account lock, or the server detecting
 * a stolen token. Without this the page keeps rendering, every query on it
 * fails, and the person sees four error panels rather than one sign in form.
 *
 * <p>A full navigation rather than a router push, deliberately. Every cached
 * query belongs to a session that no longer exists, and a reload is the one
 * thing guaranteed to leave nothing of it behind. This is a rare event, so the
 * cost of a reload is not worth optimising away.
 *
 * <p>Registered outside React's tree because apiClient is a plain module with no
 * access to hooks or to the router.
 */
function useSessionExpiryRedirect() {
  useEffect(() => {
    setSessionExpiredHandler(() => {
      queryClient.clear()
      const here = window.location.pathname + window.location.search

      // Public pages must not bounce. Someone reading the landing page with a
      // stale token in another tab has not asked to sign in, and throwing them
      // at a login form would be baffling.
      const isPublic = ['/', '/verify', '/about', '/developers', '/login', '/signup'].some(
        (path) => here === path || here.startsWith(`${path}?`),
      )
      if (isPublic) return

      window.location.assign(`/login?next=${encodeURIComponent(here)}`)
    })
    return () => setSessionExpiredHandler(null)
  }, [])
}
