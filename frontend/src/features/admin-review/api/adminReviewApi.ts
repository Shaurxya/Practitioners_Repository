import { apiRequest } from '@/lib/apiClient'
import type { Page } from '@/types/api'
import type {
  ReviewCaseDetail,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  ReviewQueueFilter,
  ReviewQueueItem,
} from '../types'

export const QUEUE_PAGE_SIZE = 25

/**
 * Filtering and pagination are server side, always. This table grows without
 * limit and fetching everything to filter in the browser stops working long
 * before anyone notices it is the problem.
 */
export function buildQueueParams(filter: ReviewQueueFilter): URLSearchParams {
  const params = new URLSearchParams()
  for (const status of filter.statuses) params.append('status', status)
  if (filter.q) params.set('q', filter.q)
  if (filter.from) params.set('from', filter.from)
  if (filter.to) params.set('to', filter.to)
  params.set('page', String(filter.page))
  params.set('size', String(QUEUE_PAGE_SIZE))
  // Oldest first: the oldest unreviewed case is the one someone is waiting on.
  params.set('sort', 'submittedAt,asc')
  return params
}

export function fetchReviewQueue(filter: ReviewQueueFilter): Promise<Page<ReviewQueueItem>> {
  return apiRequest<Page<ReviewQueueItem>>(`/api/v1/admin/review?${buildQueueParams(filter)}`)
}

/** One request returns everything a reviewer needs. No waterfall of calls. */
export function fetchReviewCase(caseId: string): Promise<ReviewCaseDetail> {
  return apiRequest<ReviewCaseDetail>(`/api/v1/admin/review/${caseId}`)
}

export function decideCase(
  caseId: string,
  decision: ReviewDecisionRequest,
): Promise<ReviewDecisionResponse> {
  return apiRequest<ReviewDecisionResponse>(`/api/v1/admin/review/${caseId}/decide`, {
    method: 'POST',
    body: JSON.stringify(decision),
  })
}
