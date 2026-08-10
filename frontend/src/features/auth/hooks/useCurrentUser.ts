import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { getAccessToken } from '@/lib/authToken'
import { fetchCurrentUser, logout } from '../api/authApi'
import type { CurrentUser } from '../types'

/** One key, so signing in or out invalidates every consumer at once. */
export const ME_QUERY_KEY = ['me'] as const

/**
 * The signed in account, and the single source of truth for it.
 *
 * Every guard, the masthead and the account page read this one query rather
 * than each fetching /me, so a page with three of them makes one request. React
 * Query dedupes concurrent mounts and serves the rest from cache.
 *
 * <h2>Why it does not run when there is no token</h2>
 *
 * `enabled` is what keeps a signed out visitor from making a request on every
 * page load whose only possible answer is 401. That mattered more once the
 * masthead started rendering on the landing page: without it, the public site's
 * first paint carried a guaranteed failing request.
 */
export function useCurrentUser() {
  return useQuery<CurrentUser>({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchCurrentUser,
    enabled: getAccessToken() !== null,

    // A 401 here is the normal answer for a signed out visitor, not a fault.
    // Retrying it three times delays every page load and fills the console with
    // failures that mean "nobody is signed in".
    retry: false,

    // The role and the Immortal ID change rarely, and this is read by several
    // components on every route change. A minute of staleness costs nothing and
    // removes a request from most navigations.
    staleTime: 60_000,
  })
}

/**
 * Whether the app should even try. Distinguishes "signed out" from "loading",
 * which a guard has to get right or it redirects during the first render.
 */
export function useIsAuthenticated() {
  const user = useCurrentUser()
  const hasToken = getAccessToken() !== null
  return {
    isAuthenticated: hasToken && user.isSuccess,
    isResolving: hasToken && user.isPending,
    user: user.data,
  }
}

/**
 * Signs out here and on the server, then clears the cache.
 *
 * The cache clear is not cosmetic. Query results from the previous account stay
 * in memory otherwise, and the next person to sign in on this machine sees the
 * previous person's claims render for a moment before their own arrive.
 */
export function useSignOut() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      // Removed rather than invalidated: invalidating refetches, and refetching
      // /me without a token is a guaranteed 401 that renders as an error
      // instead of as a signed out header.
      queryClient.clear()
      void navigate('/')
    },
  })
}
