import { apiRequest } from '@/lib/apiClient'
import type { Page } from '@/types/api'
import type {
  LookupRequest,
  LookupResult,
  PractitionerCaseDetail,
  PractitionerCaseSummary,
  SubmitVerificationRequest,
} from '../types'

/**
 * Step 1: does the register hold this registration.
 *
 * POST for a read, and it is not a mistake. A registration number in a query
 * string ends up in the browser history, the access log and the referrer header
 * of any outbound link on the page. The body keeps it out of all three.
 *
 * Budgeted server side at 20 an hour per account, so a 429 here is expected
 * traffic rather than an error to retry. Nothing about the result is trusted at
 * submit: the server re-matches from scratch, because a registry batch can be
 * promoted between the two calls.
 */
export function lookupRegistration(body: LookupRequest): Promise<LookupResult> {
  return apiRequest<LookupResult>('/api/v1/verifications/lookup', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

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
