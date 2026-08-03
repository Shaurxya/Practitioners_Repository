import type { CaseStatus, RuleOutcome } from '@/types/caseStatus'

/**
 * Console side types. These carry everything, including registry data, and
 * must never be reused by a practitioner facing view. See
 * features/verification/types.ts for the deliberately narrower shape.
 */

export interface ReviewQueueItem {
  caseId: string
  status: CaseStatus
  claimedFullName: string
  claimedRegistrationNumber: string
  council: string
  /** Rule codes that put this case in front of a human. */
  routedReasons: string[]
  submittedAt: string
}

export interface ReviewQueueFilter {
  statuses: CaseStatus[]
  q: string
  from: string
  to: string
  page: number
}

/** One registry row the matcher put forward. Duplicates and ambiguity are real. */
export interface MatchCandidate {
  registryRecordId: string
  matchedOn: 'EXACT_LICENSE' | 'FUZZY_NAME'
  nameScore: number
  fullName: string
  registrationNumber: string
  council: string
  specialty: string
  status: string
  validUntil: string | null
  sourceBatch: string
  syncedAt: string
  presentInLatestBatch: boolean
}

export interface RuleResultView {
  ruleCode: string
  outcome: RuleOutcome
  detail: string
}

export interface AuditEntry {
  at: string
  eventType: string
  actor: string
  fromStatus: CaseStatus | null
  toStatus: CaseStatus | null
  reason: string | null
}

export interface ReviewCaseDetail {
  caseId: string
  status: CaseStatus
  submittedAt: string
  decidedAt: string | null
  decidedBy: string | null
  decisionReason: string | null
  claim: {
    fullName: string
    registrationNumber: string
    council: string
    specialty: string
    normalizedName: string
    normalizedRegistrationNumber: string
  }
  candidates: MatchCandidate[]
  ruleResults: RuleResultView[]
  audit: AuditEntry[]
}

export interface ReviewDecisionRequest {
  decision: 'APPROVE' | 'REJECT'
  reason: string
  /** Which candidate the reviewer approved against. Never chosen for them. */
  registryRecordId: string | null
}

export interface ReviewDecisionResponse {
  caseId: string
  status: CaseStatus
  decidedAt: string
  /**
   * The server knows the queue order, so it hands back the next case in the
   * same round trip. A reviewer clearing forty cases never returns to the list.
   */
  nextCaseId: string | null
}
