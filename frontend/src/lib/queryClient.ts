import { QueryClient } from '@tanstack/react-query'

/**
 * One shared cache for the whole app.
 *
 * retry: false on mutations because submitting a verification case twice is
 * worse than showing an error. Queries keep the default retry.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})
