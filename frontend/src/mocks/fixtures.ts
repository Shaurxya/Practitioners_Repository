import { buildImmortalId } from '@/features/public-verify/immortalId'
import type {
  MatchCandidate,
  ReviewCaseDetail,
  ReviewQueueItem,
} from '@/features/admin-review/types'
import type { PractitionerCaseDetail } from '@/features/verification/types'

/**
 * Seed data for the mock API.
 *
 * Shapes are taken from the real synthetic registry in data/: registration
 * numbers like KA35652 and MH-28409, names carrying qualification suffixes,
 * four councils under thirteen spellings, and a status column that is dirty on
 * purpose. Fixtures that are tidier than the real data hide the bugs the real
 * data will cause.
 */
export const VERIFIED_IMMORTAL_ID = buildImmortalId('K3M7Q8XT2')

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    registryRecordId: crypto.randomUUID(),
    matchedOn: 'EXACT_LICENSE',
    nameScore: 1,
    fullName: 'ANITA SHARMA',
    registrationNumber: 'MH28409',
    council: 'MH',
    specialty: 'Kayachikitsa',
    status: 'ACTIVE',
    validUntil: '2028-03-31',
    sourceBatch: 'batch-20260802-093428',
    syncedAt: '2026-08-02T09:34:28Z',
    presentInLatestBatch: true,
    ...overrides,
  }
}

export const REVIEW_CASES: ReviewCaseDetail[] = [
  {
    caseId: '8f3a1c22-0000-4000-8000-000000000001',
    status: 'MANUAL_REVIEW',
    submittedAt: '2026-07-29T14:02:00Z',
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    claim: {
      fullName: 'Dr. Anita Sharma',
      registrationNumber: 'mh 28409',
      council: 'MH',
      specialty: 'Panchakarma',
      normalizedName: 'ANITA SHARMA',
      normalizedRegistrationNumber: 'MH28409',
    },
    // Two candidates, which is why a human is looking at it.
    candidates: [
      candidate({ registrationNumber: 'MH28409', status: 'SUSPENDED', validUntil: '2026-03-31' }),
      candidate({
        registrationNumber: 'MH28409',
        fullName: 'ANITA SHARMA',
        specialty: 'Kayachikitsa',
        nameScore: 0.94,
        matchedOn: 'FUZZY_NAME',
      }),
    ],
    ruleResults: [
      { ruleCode: 'LICENSE_ACTIVE', outcome: 'FAIL', detail: 'registry status SUSPENDED, expected ACTIVE' },
      { ruleCode: 'NOT_EXPIRED', outcome: 'FAIL', detail: 'valid_until 2026-03-31 is 122 days past' },
      { ruleCode: 'SINGLE_CANDIDATE', outcome: 'REVIEW', detail: '2 candidates matched' },
      { ruleCode: 'NAME_MATCH', outcome: 'PASS', detail: 'similarity 1.00' },
      { ruleCode: 'DOC_CONSISTENT', outcome: 'SKIPPED', detail: 'no OCR available' },
    ],
    audit: [
      { at: '2026-07-29T14:02:00Z', eventType: 'STATUS_CHANGE', actor: 'practitioner:a41c', fromStatus: null, toStatus: 'SUBMITTED', reason: null },
      { at: '2026-07-29T14:02:01Z', eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'SUBMITTED', toStatus: 'MATCHING', reason: null },
      { at: '2026-07-29T14:02:02Z', eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'MATCHING', toStatus: 'RULES_EVAL', reason: '2 candidates' },
      { at: '2026-07-29T14:02:02Z', eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'RULES_EVAL', toStatus: 'MANUAL_REVIEW', reason: '2 FAIL, 1 REVIEW' },
    ],
  },
  {
    caseId: '8f3a1c22-0000-4000-8000-000000000002',
    status: 'NO_MATCH',
    submittedAt: '2026-07-30T09:14:00Z',
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    claim: {
      fullName: 'Rajesh Kumar B.A.M.S.',
      registrationNumber: 'KL-99999',
      council: 'KL',
      specialty: 'Ayurveda',
      normalizedName: 'RAJESH KUMAR',
      normalizedRegistrationNumber: 'KL99999',
    },
    candidates: [],
    ruleResults: [],
    audit: [
      { at: '2026-07-30T09:14:00Z', eventType: 'STATUS_CHANGE', actor: 'practitioner:b722', fromStatus: null, toStatus: 'SUBMITTED', reason: null },
      { at: '2026-07-30T09:14:01Z', eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'MATCHING', toStatus: 'NO_MATCH', reason: 'zero candidates' },
    ],
  },
  {
    caseId: '8f3a1c22-0000-4000-8000-000000000003',
    status: 'MANUAL_REVIEW',
    submittedAt: '2026-07-31T11:40:00Z',
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    claim: {
      fullName: 'Deepa Trivedi',
      registrationNumber: 'KA35652',
      council: 'KA',
      specialty: 'Kayachikitsa',
      normalizedName: 'DEEPA TRIVEDI',
      normalizedRegistrationNumber: 'KA35652',
    },
    candidates: [
      candidate({
        fullName: 'DEEPA TRIVEDI',
        registrationNumber: 'KA35652',
        council: 'KA',
        nameScore: 0.82,
        matchedOn: 'FUZZY_NAME',
        status: 'ACTIVE',
        validUntil: '2027-11-05',
      }),
    ],
    ruleResults: [
      { ruleCode: 'LICENSE_ACTIVE', outcome: 'PASS', detail: 'registry status ACTIVE' },
      { ruleCode: 'NOT_EXPIRED', outcome: 'PASS', detail: 'valid_until 2027-11-05' },
      { ruleCode: 'NAME_MATCH', outcome: 'REVIEW', detail: 'similarity 0.82, below the 0.90 auto threshold' },
      { ruleCode: 'SINGLE_CANDIDATE', outcome: 'PASS', detail: '1 candidate' },
    ],
    audit: [
      { at: '2026-07-31T11:40:00Z', eventType: 'STATUS_CHANGE', actor: 'practitioner:c913', fromStatus: null, toStatus: 'SUBMITTED', reason: null },
      { at: '2026-07-31T11:40:02Z', eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'RULES_EVAL', toStatus: 'MANUAL_REVIEW', reason: '1 REVIEW' },
    ],
  },
]

export function toQueueItem(detail: ReviewCaseDetail): ReviewQueueItem {
  return {
    caseId: detail.caseId,
    status: detail.status,
    claimedFullName: detail.claim.fullName,
    claimedRegistrationNumber: detail.claim.registrationNumber,
    council: detail.claim.council,
    routedReasons: detail.ruleResults
      .filter((rule) => rule.outcome === 'FAIL' || rule.outcome === 'REVIEW')
      .map((rule) => rule.ruleCode),
    submittedAt: detail.submittedAt,
  }
}

export const PRACTITIONER_CASES: PractitionerCaseDetail[] = [
  {
    caseId: '7c11aa00-0000-4000-8000-000000000001',
    status: 'APPROVED',
    outcomeCode: 'VERIFIED',
    submittedAt: '2026-07-14T08:00:00Z',
    decidedAt: '2026-07-14T08:00:12Z',
    claim: {
      fullName: 'Anita Sharma',
      registrationNumber: 'MH-28409',
      council: 'MH',
      specialty: 'Panchakarma',
    },
    progress: [
      { step: 'SUBMITTED', state: 'DONE' },
      { step: 'CHECKING', state: 'DONE' },
      { step: 'REVIEW', state: 'SKIPPED' },
      { step: 'DECISION', state: 'DONE' },
    ],
    verifiedAsOf: '2026-07-14',
    registrySourceBatch: 'council-2026-07-14',
    immortalId: VERIFIED_IMMORTAL_ID,
  },
]
