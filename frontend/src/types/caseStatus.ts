/**
 * Mirrors com.herbimmortal.verification.domain.enums.CaseStatus.
 *
 * Hand maintained for now. If it drifts from the backend enum, generate it from
 * the OpenAPI document at /v3/api-docs instead of trying harder to remember.
 */
export const CASE_STATUS = [
  'SUBMITTED',
  'MATCHING',
  'NO_MATCH',
  'RULES_EVAL',
  'AUTO_VERIFIED',
  'MANUAL_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
  'FAILED',
] as const

export type CaseStatus = (typeof CASE_STATUS)[number]

/** Mirrors RuleOutcome. Not a boolean, on purpose. */
export const RULE_OUTCOME = ['PASS', 'REVIEW', 'FAIL', 'SKIPPED'] as const
export type RuleOutcome = (typeof RULE_OUTCOME)[number]

export type Role = 'PRACTITIONER' | 'DEVELOPER' | 'REVIEWER' | 'ADMIN'
