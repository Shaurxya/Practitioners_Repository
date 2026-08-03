import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { decideCase, fetchReviewCase, fetchReviewQueue } from '../api/adminReviewApi'
import type { ReviewDecisionRequest, ReviewQueueFilter } from '../types'

export function useReviewQueue(filter: ReviewQueueFilter) {
  return useQuery({
    queryKey: ['review-queue', filter],
    queryFn: () => fetchReviewQueue(filter),
    // Keeps the previous page on screen while the next one loads, so the table
    // does not collapse to a spinner on every keystroke in the search box.
    placeholderData: (previous) => previous,
  })
}

export function useReviewCase(caseId: string | undefined) {
  return useQuery({
    queryKey: ['review-case', caseId],
    queryFn: () => fetchReviewCase(caseId as string),
    enabled: Boolean(caseId),
  })
}

/**
 * Deliberately not an optimistic update.
 *
 * Optimistic updates suit a server that is a formality. Here a 409 is a normal
 * outcome, because two reviewers opening the same case is normal. Showing
 * "Approved", advancing to the next case, then yanking the reviewer back to say
 * it did not happen is worse than waiting 250ms. The reviewer is never shown an
 * outcome that might be reversed.
 */
export function useDecideCase(caseId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (decision: ReviewDecisionRequest) => decideCase(caseId as string, decision),
    onSuccess: (result) => {
      // Counts stay honest.
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] })
      void queryClient.invalidateQueries({ queryKey: ['review-case', result.caseId] })
    },
  })
}
