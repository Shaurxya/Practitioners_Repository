import { useQuery } from '@tanstack/react-query'
import { fetchCase, fetchMyCases } from '../api/verificationApi'
import { isTerminalOutcome } from '../outcome'

/**
 * Backoff schedule, in milliseconds, indexed by how many times the query has
 * resolved. Verification is synchronous today so the first poll usually returns
 * a terminal outcome, which is the point: this code does not change when phase
 * 9 makes it asynchronous.
 *
 * Tight at first because most cases finish in seconds, then widening so a case
 * sitting in manual review for a day does not generate 28,800 requests.
 */
export function pollIntervalFor(updateCount: number): number | false {
  if (updateCount < 15) return 2_000 // first ~30s
  if (updateCount < 35) return 5_000 // to ~2min
  if (updateCount < 67) return 15_000 // to ~10min
  if (updateCount < 87) return 60_000 // to ~30min
  return false // stop, the screen offers a manual refresh
}

export function useVerificationCase(caseId: string | undefined) {
  return useQuery({
    queryKey: ['verification-case', caseId],
    queryFn: () => fetchCase(caseId as string),
    enabled: Boolean(caseId),
    // Someone who closed the tab and came back should see current state
    // immediately rather than waiting for the next tick.
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return 2_000
      if (isTerminalOutcome(data.outcomeCode)) return false
      return pollIntervalFor(query.state.dataUpdateCount)
    },
  })
}

export function useMyCases() {
  return useQuery({
    queryKey: ['my-cases'],
    queryFn: fetchMyCases,
  })
}
