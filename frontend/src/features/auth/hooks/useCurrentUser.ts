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
  })
}
