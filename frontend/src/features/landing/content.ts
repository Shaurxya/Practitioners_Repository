/**
 * Landing page copy and tables, kept out of the component so the page reads as
 * layout and this file reads as the specification it describes. Everything here
 * tracks CLAUDE.md. If the design contract changes, this file changes with it.
 */

export interface Section {
  id: string
  index: string
  title: string
}

export const SECTIONS: Section[] = [
  { id: 'premise', index: '01', title: 'Premise' },
  { id: 'immortal-id', index: '02', title: 'The Immortal ID' },
  { id: 'model', index: '03', title: 'Domain model' },
  { id: 'pipeline', index: '04', title: 'Verification pipeline' },
  { id: 'states', index: '05', title: 'Status machine' },
  { id: 'rules', index: '06', title: 'Rule catalog' },
  { id: 'guarantees', index: '07', title: 'Guarantees' },
  { id: 'api', index: '08', title: 'API surface' },
  { id: 'engineering', index: '09', title: 'Engineering' },
]

export const SPEC_ROWS: Array<[string, string]> = [
  ['Status', 'Design, phase 1'],
  // Was "4 councils, ~31k rows". The council count went stale the moment the
  // registry covered every state, and the row count was never real: no registry
  // has been promoted yet. A published figure about how much data we hold is
  // the last place to keep a number nobody is maintaining.
  ['Registry', 'All states and union territories'],
  ['Throughput', 'Under 500 claims / day'],
  ['Decision', 'Rules, then a human'],
  ['Identifier', 'HI-XXXXX-XXXXX'],
  ['Version', 'Contract v1'],
]

export interface EntityRow {
  name: string
  role: string
  fields: string
  rule: string
}

export const ENTITIES: EntityRow[] = [
  {
    name: 'PRACTITIONER',
    role: 'The account.',
    fields: 'email, role, immortal_id (nullable), current_case_id',
    rule: 'Holds no claimed license number. A claim belongs to an attempt, not to a person, because a rejected practitioner can submit a corrected claim.',
  },
  {
    name: 'REGISTRY_RECORD',
    role: 'One normalized row copied from the council registry.',
    fields:
      'normalized_license_no, normalized_name, council, source_batch, first_seen_at, synced_at, present_in_latest_batch, raw (JSONB)',
    rule: 'Never edited by hand, never written by the verification flow. Natural key is (council, normalized_license_no). Rows that vanish from a batch are flagged, not deleted.',
  },
  {
    name: 'VERIFICATION_CASE',
    role: 'One attempt to verify one practitioner.',
    fields:
      'status, matched_registry_record_id, match_confidence, registry_snapshot (JSONB), claimed fields, decided_by, decision_reason',
    rule: 'Immutable once terminal. At most one open case per practitioner, enforced by a Postgres partial unique index rather than by application logic.',
  },
  {
    name: 'RULE_RESULT',
    role: 'The outcome of one rule against one case.',
    fields: 'rule_code, outcome, detail, evidence (JSONB), evaluated_at',
    rule: 'Outcome is PASS, REVIEW, FAIL or SKIPPED. A boolean cannot express a catalog where the third answer is "ask a person" and the fourth is "this rule could not run".',
  },
  {
    name: 'DOCUMENT',
    role: 'An uploaded certificate or identity scan.',
    fields: 'storage_key, content_type, size_bytes, sha256, status, ocr_result (JSONB)',
    rule: 'Evidence, not truth. Linked to cases through a join table, because one identity scan can support several cases over the years.',
  },
  {
    name: 'AUDIT_EVENT',
    role: 'Append only history of everything that happened.',
    fields:
      'event_type, subject_type, subject_id, actor_type, actor_id, from_status, to_status, reason, metadata (JSONB)',
    rule: 'No foreign key on subject_id, deliberately. The log has to outlive shape changes in the tables it describes.',
  },
]

export interface Step {
  title: string
  detail: string
  branch?: boolean
}

export const PIPELINE: Step[] = [
  {
    title: 'Intake',
    detail:
      'POST /api/v1/verifications validates the payload, persists a case in SUBMITTED and answers 202 with the case id. An Idempotency-Key header means a double click returns the same case instead of opening a second one.',
  },
  {
    title: 'Normalization',
    detail:
      'The claim and the registry row pass through one shared class: uppercase, strip titles, collapse whitespace, drop punctuation, canonicalize the license format. Results are stored, not computed per query, so they can be indexed.',
  },
  {
    title: 'Matching',
    detail:
      'Exact match on council plus normalized license number, then a fuzzy fallback that scores candidate names. Returns a list of candidates, never an Optional. Duplicates in a public registry are real and the reviewer needs to see them side by side.',
  },
  {
    title: 'Zero candidates',
    detail:
      'The case goes NO_MATCH and straight to a human. Nothing about "found or not found" is left to a rule, because that would be two mechanisms deciding the same fact.',
    branch: true,
  },
  {
    title: 'Rule evaluation',
    detail:
      'Every rule in the catalog runs against every candidate. Seven in memory checks, so there is no cost argument for short circuiting, and running them all means the review console can show a reviewer the checks that passed as well as the ones that did not.',
  },
  {
    title: 'Decision',
    detail:
      'Deterministic and order independent. Any FAIL rejects. Otherwise any REVIEW routes to a human. Otherwise everything passed or was skipped, and the case goes AUTO_VERIFIED then APPROVED in the same transaction. A SKIPPED result for a rule marked required is promoted to REVIEW.',
  },
  {
    title: 'Human review',
    detail:
      'The reviewer sees the claim, every candidate registry row, every rule result with its evidence, and the documents. Approve or reject, with a mandatory reason that lands in the audit log.',
  },
]

export const IN_FLIGHT = [
  'SUBMITTED',
  'MATCHING',
  'NO_MATCH',
  'RULES_EVAL',
  'MANUAL_REVIEW',
  'AUTO_VERIFIED',
  'FAILED',
]

export const TERMINAL = ['APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED']

export const TRANSITIONS: Array<[string, string]> = [
  ['SUBMITTED', 'MATCHING'],
  ['SUBMITTED', 'FAILED'],
  ['MATCHING', 'NO_MATCH'],
  ['MATCHING', 'RULES_EVAL'],
  ['MATCHING', 'FAILED'],
  ['NO_MATCH', 'MANUAL_REVIEW'],
  ['RULES_EVAL', 'AUTO_VERIFIED'],
  ['RULES_EVAL', 'MANUAL_REVIEW'],
  ['RULES_EVAL', 'REJECTED'],
  ['RULES_EVAL', 'FAILED'],
  ['MANUAL_REVIEW', 'APPROVED'],
  ['MANUAL_REVIEW', 'REJECTED'],
  ['AUTO_VERIFIED', 'APPROVED'],
  ['APPROVED', 'EXPIRED'],
  ['APPROVED', 'REVOKED'],
  ['FAILED', 'MATCHING'],
]

export interface RuleRow {
  code: string
  check: string
  pass: string
  review: string
  fail: string
  required: boolean
}

export const RULES: RuleRow[] = [
  {
    code: 'LICENSE_ACTIVE',
    check: 'Registry status is active',
    pass: 'Active',
    review: '',
    fail: 'Anything else',
    required: true,
  },
  {
    code: 'NOT_EXPIRED',
    check: 'valid_until is in the future',
    pass: 'Future date',
    review: 'Inside a 30 day grace window',
    fail: 'Past the grace window',
    required: true,
  },
  {
    code: 'NOT_SANCTIONED',
    check: 'Not suspended or revoked',
    pass: 'Clean',
    review: '',
    fail: 'Suspended or revoked',
    required: true,
  },
  {
    code: 'NAME_MATCH',
    check: 'Similarity of claimed name to registry name',
    pass: 'At or above 0.90',
    review: '0.75 to 0.90',
    fail: 'Below 0.75',
    required: true,
  },
  {
    code: 'SINGLE_CANDIDATE',
    check: 'Exactly one registry row matched',
    pass: '1 candidate',
    review: '2 or more',
    fail: '',
    required: true,
  },
  {
    code: 'DOC_CONSISTENT',
    check: 'License number read off the document equals the claim',
    pass: 'Equal',
    review: 'Mismatch, or no OCR available',
    fail: '',
    required: false,
  },
]

export const TENETS: Array<[string, string]> = [
  [
    'Nothing is hard deleted.',
    'Corrections append to the audit log. A registry row that disappears is flagged absent, not removed.',
  ],
  [
    'Every decision stores a registry snapshot.',
    'The matched row as it looked at that moment, in JSONB. If the council edits the record next month, we can still show what we saw.',
  ],
  [
    'Verified status is read live.',
    'Practitioner status is derived from the current case, every time it is asked for. There is no is_verified boolean anywhere, in this service or downstream, because a cached flag is exactly how a revoked practitioner keeps reading as valid.',
  ],
  [
    'No bare green tick.',
    'The public answer is "verified as of 14 July 2026, source council-2026-07-14". A tick with no date is a claim about the present that the data cannot support.',
  ],
  [
    'Documents are encrypted at rest and every read is logged.',
    'Access is role restricted and each view of a document body writes its own audit event.',
  ],
  [
    'The public endpoint is cached and rate limited.',
    'A directory of licensed practitioners is worth scraping. Nine random characters of identifier put enumeration out of reach, and the limiter is the second line, not the only one.',
  ],
  [
    'Verification is asynchronous from intake onward.',
    'No HTTP thread ever blocks on OCR or fuzzy matching. Phase 5 runs synchronously as a deliberate temporary exception and phase 9 removes it.',
  ],
  [
    'Ambiguity routes to a human.',
    'Full automation is not a v1 goal. Two candidate rows with the same name is not a problem to be scored away, it is a question for a reviewer.',
  ],
]

export interface Route {
  method: string
  path: string
  note: string
}

export interface RouteGroup {
  label: string
  routes: Route[]
}

export const API: RouteGroup[] = [
  {
    label: 'Identity',
    routes: [
      { method: 'POST', path: '/api/v1/auth/register', note: 'Create a practitioner account' },
      { method: 'POST', path: '/api/v1/auth/login', note: 'Access token plus refresh token' },
      {
        method: 'POST',
        path: '/api/v1/auth/refresh',
        note: 'Short lived access tokens, so a revocation takes effect in minutes',
      },
      { method: 'GET', path: '/api/v1/me', note: 'The caller, including immortal_id when issued' },
    ],
  },
  {
    label: 'Verification',
    routes: [
      {
        method: 'POST',
        path: '/api/v1/verifications',
        note: '202 with a case id, Idempotency-Key honoured',
      },
      {
        method: 'GET',
        path: '/api/v1/verifications/{id}',
        note: 'Status, rule results, next action. A case that is not yours is a 404, not a 403',
      },
      { method: 'GET', path: '/api/v1/verifications', note: 'Your own cases, paginated' },
      { method: 'POST', path: '/api/v1/documents/presign', note: 'Direct to storage upload URL' },
      { method: 'POST', path: '/api/v1/documents/confirm', note: 'Attach an uploaded object to a case' },
    ],
  },
  {
    label: 'Review console',
    routes: [
      { method: 'GET', path: '/api/v1/admin/review', note: 'The MANUAL_REVIEW queue' },
      { method: 'GET', path: '/api/v1/admin/review/{id}', note: 'Claim against registry against document' },
      { method: 'POST', path: '/api/v1/admin/review/{id}/decide', note: 'Approve or reject, reason mandatory' },
      {
        method: 'POST',
        path: '/api/v1/admin/practitioners/{immortalId}/revoke',
        note: 'The transition the state machine always had and the API did not',
      },
      { method: 'GET', path: '/api/v1/admin/cases', note: 'Every status, filterable, for support questions' },
    ],
  },
  {
    label: 'Consumers',
    routes: [
      {
        method: 'GET',
        path: '/api/v1/public/verify?immortalId=',
        note: 'No auth, cached, rate limited',
      },
      {
        method: 'GET',
        path: '/api/v1/internal/practitioners/{immortalId}',
        note: 'Service auth, on its own prefix so the gateway can gate it by path',
      },
    ],
  },
]

export const STACK: Array<[string, string]> = [
  ['Language', 'Java 21'],
  ['Framework', 'Spring Boot 3, Maven'],
  ['Database', 'PostgreSQL 16, Flyway migrations'],
  ['Persistence', 'Spring Data JPA, Hibernate'],
  ['Auth', 'Spring Security, JWT with refresh'],
  ['Frontend', 'React, TypeScript, TanStack Query, Tailwind'],
  ['Objects', 'S3 compatible, MinIO locally'],
  ['Tests', 'JUnit 5, Mockito, Testcontainers'],
]

export interface Phase {
  n: string
  deliverable: string
  state: string
  mvp: boolean
}

export const PHASES: Phase[] = [
  { n: '01', deliverable: 'Scaffold, Docker Compose, Flyway, health endpoint', state: 'In progress', mvp: true },
  { n: '02', deliverable: 'Registry ingestion with indexes', state: 'Blocked on D2', mvp: true },
  { n: '03', deliverable: 'Signup, submit a case, read a case', state: 'Planned', mvp: true },
  { n: '04', deliverable: 'Status machine and audit log', state: 'Blocked on D1', mvp: true },
  { n: '05', deliverable: 'Exact license matching, hardcoded rules', state: 'Planned', mvp: true },
  { n: '06', deliverable: 'Review console and admin endpoints', state: 'Planned', mvp: true },
  { n: '07', deliverable: 'Fuzzy name scoring, full rule catalog', state: 'Planned', mvp: false },
  { n: '08', deliverable: 'Security, JWT, roles, ownership checks', state: 'Planned', mvp: false },
  { n: '09', deliverable: 'Async processing, presigned uploads, OCR', state: 'Planned', mvp: false },
  { n: '10', deliverable: 'Re-verification job, public API with limits', state: 'Planned', mvp: false },
  { n: '11', deliverable: 'Full lifecycle test suite', state: 'Planned', mvp: false },
]

export interface Decision {
  id: string
  question: string
  answer: string
  blocks: string
}

export const DECISIONS: Decision[] = [
  {
    id: 'D1',
    question: 'Does re-verification reuse the case or open a new one?',
    answer:
      'A new case. EXPIRED stays terminal, current_case_id moves. Reuse would overwrite decided_at and the registry snapshot, which breaks the second guarantee.',
    blocks: 'Phase 4',
  },
  {
    id: 'D2',
    question: 'Full snapshot per registry batch, or deltas?',
    answer:
      'Open. If batches are full snapshots, absence means delisted and present_in_latest_batch is meaningful. If they are deltas, absence means nothing and that column must not exist.',
    blocks: 'Phase 2',
  },
  {
    id: 'D3',
    question: 'Is there a grace window on an expired license?',
    answer:
      'Thirty days, routing to review rather than failing. Renewals lag the registry, and hard failing on day one rejects genuine practitioners and generates support load.',
    blocks: 'Phase 7',
  },
  {
    id: 'D4',
    question: 'How does the platform authenticate to the internal lookup?',
    answer:
      'A rotatable static key plus an IP allowlist for v1. Client credentials are correct long term but that is an authorization server to run for a single consumer. Revisit at the second.',
    blocks: 'Phase 10',
  },
  {
    id: 'D5',
    question: 'Where does the public rate limiter keep its state?',
    answer:
      'In memory at one instance. The moment there are two, limits multiply by instance count and the buckets move to Redis.',
    blocks: 'Phase 10',
  },
]
