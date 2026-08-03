import type { CaseStatus } from '@/types/caseStatus'

/** Note the absence of an immortalId field: the practitioner has none yet. */
export interface SubmitVerificationRequest {
  fullName: string
  registrationNumber: string
  council: string
  specialty: string
}

/**
 * Practitioner facing outcome codes.
 *
 * These are NOT rule codes, and the difference is the privacy boundary. Mapping
 * NOT_EXPIRED or NAME_MATCH straight to a message would confirm that a guessed
 * registration number exists on the register, which turns this endpoint into a
 * lookup oracle. The server collapses every pre approval failure into
 * COULD_NOT_VERIFY. Specific codes only appear after an approval, where the
 * practitioner has already been matched and the facts are their own.
 */
export const OUTCOME_CODE = [
  'IN_PROGRESS',
  'IN_REVIEW',
  'VERIFIED',
  'COULD_NOT_VERIFY',
  'NUMBER_FORMAT',
  'SYSTEM_ERROR',
  'LAPSED',
  'WITHDRAWN',
] as const

export type OutcomeCode = (typeof OUTCOME_CODE)[number]

/** Steps shown in the portal tracker. Deliberately coarser than CaseStatus. */
export const PROGRESS_STEP = ['SUBMITTED', 'CHECKING', 'REVIEW', 'DECISION'] as const
export type ProgressStep = (typeof PROGRESS_STEP)[number]
export type ProgressState = 'DONE' | 'ACTIVE' | 'PENDING' | 'SKIPPED' | 'ERROR'

export interface ProgressEntry {
  step: ProgressStep
  state: ProgressState
}

export interface ClaimView {
  fullName: string
  registrationNumber: string
  council: string
  specialty: string
}

/** One row in "my claims". */
export interface PractitionerCaseSummary {
  caseId: string
  status: CaseStatus
  outcomeCode: OutcomeCode
  submittedAt: string
  decidedAt: string | null
  claim: ClaimView
}

/**
 * The status screen payload.
 *
 * Absent on purpose, and it must stay absent: matchedRegistryRecordId,
 * candidates, matchConfidence, ruleResults, registrySnapshot. Those live only
 * on the admin response. Two shapes built from the same case, never sharing a
 * type, so adding a field for the console cannot leak it here.
 */
export interface PractitionerCaseDetail {
  caseId: string
  status: CaseStatus
  outcomeCode: OutcomeCode
  submittedAt: string
  decidedAt: string | null
  claim: ClaimView
  progress: ProgressEntry[]
  /** Set only when approved. */
  verifiedAsOf: string | null
  registrySourceBatch: string | null
  /** Null until the first approval issues one. Every read path must handle this. */
  immortalId: string | null
}

/** 409 body when a practitioner already has an open claim. */
export interface ClaimAlreadyOpen {
  code: 'CLAIM_ALREADY_OPEN'
  caseId: string
  submittedAt: string
}
