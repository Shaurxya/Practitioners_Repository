import type { CaseStatus } from '@/types/caseStatus'

/** Note the absence of an immortalId field: the practitioner has none yet. */
export interface SubmitVerificationRequest {
  fullName: string
  registrationNumber: string
  council: string
  specialty: string
  /**
   * ISO 3166-1 alpha-2. Feeds the CC segment of the Immortal ID.
   *
   * Sent, but not trusted: the council is the authority for its own country and
   * the server rejects a claim whose two answers disagree. This field exists so
   * that disagreement is visible rather than silently resolved.
   */
  country: string
  /** Single character code feeding the M segment: A, S, U, Y, T. */
  medicalSystem: string
  /**
   * Persona verification, uploaded during step 3 and referenced by id here.
   *
   * Required by this form and optional to the server, which is not an
   * inconsistency. The scheduled re-verification job re-checks an approved
   * practitioner against a fresh registry batch with nobody at a keyboard, so
   * it has no new images to offer. The server answers that with an
   * IDENTITY_DOCUMENTS rule of REVIEW rather than a rejection; a person filling
   * in this form has no such excuse.
   */
  photoIdDocumentId: string | null
  selfieDocumentId: string | null
}

/** Step 1 of the wizard. Only the two fields that key the match. */
export interface LookupRequest {
  council: string
  registrationNumber: string
}

export const LOOKUP_OUTCOME = ['FOUND', 'NOT_FOUND', 'AMBIGUOUS'] as const
export type LookupOutcome = (typeof LOOKUP_OUTCOME)[number]

/**
 * What the register will admit to before identity is proven.
 *
 * Every field is populated on FOUND and is an empty string on the other two.
 * The server sends that shape deliberately: a field present only on the found
 * branch leaks existence through the response shape, which is the version of
 * that bug that survives a review of the values. Do not narrow this type per
 * outcome, and do not make these fields optional.
 *
 * `maskedName` is "A•••• S••••", not a name. It is enough to recognise yourself
 * and not enough to harvest. The bullet run is a fixed width, so it carries no
 * information about how long the real name is.
 *
 * `standing` collapses the register's six statuses into three. SUSPENDED and
 * REVOKED both arrive as NOT_ACTIVE, because at lookup time nobody has proven
 * they are the person on the row, and naming the sanction would disclose a
 * practitioner's disciplinary history to whoever guessed their number.
 */
export interface LookupResult {
  outcome: LookupOutcome
  councilName: string
  maskedName: string
  standing: 'ACTIVE' | 'NOT_ACTIVE' | 'UNKNOWN' | ''
  asOfBatch: string
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
  /** Null on cases submitted before the ID format started carrying them. */
  country: string | null
  medicalSystem: string | null
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
