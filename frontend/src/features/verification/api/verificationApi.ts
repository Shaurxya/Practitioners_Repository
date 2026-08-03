import { apiRequest } from '@/lib/apiClient'
import type { Page } from '@/types/api'
import type {
  PractitionerCaseDetail,
  PractitionerCaseSummary,
  SubmitVerificationRequest,
} from '../types'

/**
 * Returns 202 Accepted with the case in SUBMITTED. The outcome arrives through
 * polling, never in this response body, so this stays correct when phase 9
 * moves verification onto a background executor.
 *
 * Raw values go on the wire. Normalization lives in one place on the server, in
 * Normalizer. A second implementation in TypeScript would drift from it and
 * produce failures nobody can reproduce from the logs.
 */
export function submitCase(body: SubmitVerificationRequest): Promise<PractitionerCaseDetail> {
  return apiRequest<PractitionerCaseDetail>('/api/v1/verifications', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function fetchCase(caseId: string): Promise<PractitionerCaseDetail> {
  return apiRequest<PractitionerCaseDetail>(`/api/v1/verifications/${caseId}`)
}

export function fetchMyCases(): Promise<Page<PractitionerCaseSummary>> {
  return apiRequest<Page<PractitionerCaseSummary>>('/api/v1/verifications')
}
