import { useQuery } from '@tanstack/react-query'
import { fetchCurrentUser } from '../api/authApi'

/**
 * Query keys are arrays so they can be invalidated by prefix.
 * Invalidating ['me'] refetches this everywhere it is mounted.
 */
export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: fetchCurrentUser,
    // A 401 here is the normal answer for a signed out visitor, not a fault.
    // Retrying it three times delays every public page load and fills the
    // console with failures that mean "nobody is signed in".
    retry: false,
  })
}
