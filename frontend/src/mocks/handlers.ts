import { HttpResponse, http } from 'msw'
import type { ReviewCaseDetail } from '@/features/admin-review/types'
import type { PractitionerCaseDetail } from '@/features/verification/types'
import { PRACTITIONER_CASES, REVIEW_CASES, VERIFIED_IMMORTAL_ID, toQueueItem } from './fixtures'
import type { CaseStatus } from '@/types/caseStatus'
import { COUNCILS, COUNTRIES, MEDICAL_SYSTEMS, councilCountry, councilName } from './councils'
import { importHandlers, resetImportMockData } from './importHandlers'
import {
  decide,
  evaluate,
  issueImmortalId,
  licenceKeys,
  matchClaim,
  normalizeName,
  resetIssuedImmortalIds,
} from './verificationEngine'

/**
 * Mock API matching the designed contract.
 *
 * Two jobs. In the browser it lets the portal and the console be used before
 * the Spring endpoints exist, which is the only way to find out whether the
 * screens actually work. In tests it means components exercise the real fetch
 * path and the real error handling rather than a stubbed hook.
 *
 * This deletes when the backend lands. It is not a fallback and must never be
 * enabled by default: main.tsx starts it only when VITE_USE_MOCKS is "true".
 */

/**
 * The app starts EMPTY. Everything on screen got there because someone put it
 * there in this session: a claim submitted on the public site, a register
 * uploaded in the console.
 *
 * Demo rows are useful in exactly one place, a test that needs a known
 * starting point, and harmful everywhere else. A console that opens with three
 * invented practitioners waiting for review teaches the wrong thing about what
 * the product does, and worse, it makes an empty state that never gets
 * designed, because nobody ever sees it.
 *
 * Tests opt in with resetMockData(true). See src/test/setup.ts.
 */
let reviewCases: ReviewCaseDetail[] = []
let practitionerCases: PractitionerCaseDetail[] = []

/**
 * Immortal IDs already issued, keyed on the registration number.
 *
 * Section 8.1: issued exactly once, on the FIRST approval, permanent and
 * immutable. Re-approval after an expiry or a revocation returns the same ID,
 * so it cannot live on the case, which is one attempt and terminal.
 */
let issuedImmortalIds: Record<string, string> = {}

/**
 * Mock accounts. Passwords live in PASSWORDS below, never on these objects.
 *
 *   admin@herbimmortal.com    ADMIN         admin@password
 *   admin@herbimmortal.test   ADMIN         devpassword
 *   anita@example.com         PRACTITIONER  devpassword
 *
 * These are development credentials in a git tracked file, which is only
 * acceptable because this module is a mock that deletes when Spring Security
 * lands. Phase 8 stores an argon2 or bcrypt hash in configuration and this file
 * goes with the rest of mocks/. Nothing here should ever be copied forward.
 *
 * Nobody is signed in at boot. /api/v1/me answers 401 without a valid bearer
 * token, which is what makes RequireAdmin mean anything: it used to guard the
 * console against a /me that unconditionally returned the admin, so the guard
 * passed for everyone and the console was effectively public.
 */
const ACCOUNTS = {
  'admin@herbimmortal.com': {
    id: 'a41c0000-0000-4000-8000-0000000000a0',
    email: 'admin@herbimmortal.com',
    fullName: 'Shaurya Sharma',
    role: 'ADMIN' as const,
    immortalId: null,
  },
  'admin@herbimmortal.test': {
    id: 'a41c0000-0000-4000-8000-0000000000ad',
    email: 'admin@herbimmortal.test',
    fullName: 'Shaurya Sharma',
    role: 'ADMIN' as const,
    immortalId: null,
  },
  'anita@example.com': {
    id: 'a41c0000-0000-4000-8000-000000000001',
    email: 'anita@example.com',
    fullName: 'Anita Sharma',
    role: 'PRACTITIONER' as const,
    immortalId: VERIFIED_IMMORTAL_ID,
  },
}

/**
 * Kept out of the account objects on purpose.
 *
 * ACCOUNTS is what /api/v1/me serializes straight back to the browser. A
 * password field on those objects would be published to the client on every
 * page load, which is the classic way this leaks: not through a mistake at the
 * call site, but because the secret was sitting inside a record that something
 * else was already designed to return whole.
 *
 * Per account rather than one shared string, so changing one credential cannot
 * silently change the others.
 */
const PASSWORDS: Record<keyof typeof ACCOUNTS, string> = {
  'admin@herbimmortal.com': 'admin@password',
  'admin@herbimmortal.test': 'devpassword',
  'anita@example.com': 'devpassword',
}

type AccountEmail = keyof typeof ACCOUNTS

type MockAccount = {
  id: string
  email: string
  fullName: string
  role: 'ADMIN' | 'REVIEWER' | 'PRACTITIONER'
  immortalId: string | null
}

/**
 * Accounts created by signing up during this session, on top of the fixed three.
 *
 * Held separately from ACCOUNTS so a test that signs someone up cannot mutate
 * the seeded accounts other tests rely on. Cleared by resetMockData.
 */
let registered: Record<string, MockAccount> = {}

/** API keys per account, so the account screen has something to list. */
let apiKeys: Record<string, Array<{
  id: string
  name: string
  prefix: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  lastUsedAt: string | null
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
}>> = {}

function accountByEmail(email: string): MockAccount | null {
  return (ACCOUNTS as Record<string, MockAccount>)[email] ?? registered[email] ?? null
}

/**
 * The session payload, matching the real one: tokens AND the account.
 *
 * Returning the account here is what lets the client seed its ['me'] cache
 * without a second round trip, so the mock has to carry it or the mocked app
 * takes a slower path than the real one and the difference goes unnoticed.
 */
function sessionFor(email: string) {
  const account = accountByEmail(email)
  return {
    accessToken: `${TOKEN_PREFIX}${email}`,
    refreshToken: `mock.refresh.${email}`,
    expiresInSeconds: 900,
    user: { ...account, authenticatedBy: 'SESSION' },
  }
}

/**
 * The token carries the account, so /me can answer without a session table.
 * A real JWT carries the subject the same way; this is the same idea with the
 * signature left out, which is fine precisely because it is a mock and must
 * never be mistaken for one.
 */
const TOKEN_PREFIX = 'mock.access.'

function accountFromRequest(request: Request) {
  const header = request.headers.get('Authorization') ?? ''
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length)
  if (!token.startsWith(TOKEN_PREFIX)) return null
  const email = token.slice(TOKEN_PREFIX.length)
  return accountByEmail(email)
}

const unauthorized = () =>
  HttpResponse.json(
    { code: 'UNAUTHENTICATED', message: 'Sign in to continue', timestamp: new Date().toISOString() },
    { status: 401 },
  )

/**
 * Seeded only when a test asks for it. The running app starts empty so the
 * console shows what this admin actually did, never a demo dataset.
 */
export function resetMockData(seeded = false) {
  reviewCases = seeded ? structuredClone(REVIEW_CASES) : []
  practitionerCases = seeded ? structuredClone(PRACTITIONER_CASES) : []
  issuedImmortalIds = {}
  registered = {}
  apiKeys = {}
  resetIssuedImmortalIds()
  resetImportMockData(seeded)
}

const OPEN_STATUSES = new Set(['SUBMITTED', 'MATCHING', 'RULES_EVAL', 'NO_MATCH', 'MANUAL_REVIEW'])

export const handlers = [
  // ---- admin review ------------------------------------------------------
  http.get('/api/v1/admin/review', ({ request }) => {
    const url = new URL(request.url)
    const statuses = url.searchParams.getAll('status')
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const page = Number(url.searchParams.get('page') ?? '0')
    const size = Number(url.searchParams.get('size') ?? '25')

    // Filtering happens here, server side, exactly as the real endpoint must.
    let rows = reviewCases.filter((c) => statuses.length === 0 || statuses.includes(c.status))
    if (q) {
      rows = rows.filter(
        (c) =>
          c.claim.fullName.toLowerCase().includes(q) ||
          c.claim.registrationNumber.toLowerCase().includes(q),
      )
    }
    rows = [...rows].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))

    const start = page * size
    return HttpResponse.json({
      content: rows.slice(start, start + size).map(toQueueItem),
      totalElements: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / size)),
      number: page,
      size,
    })
  }),

  http.get('/api/v1/admin/review/:caseId', ({ params }) => {
    const found = reviewCases.find((c) => c.caseId === params['caseId'])
    if (!found) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'No such case', timestamp: new Date().toISOString() },
        { status: 404 },
      )
    }
    return HttpResponse.json(found)
  }),

  http.post('/api/v1/admin/review/:caseId/decide', async ({ params, request }) => {
    const body = (await request.json()) as { decision: string; reason: string }
    const index = reviewCases.findIndex((c) => c.caseId === params['caseId'])
    const found = reviewCases[index]

    if (index < 0 || !found) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'No such case', timestamp: new Date().toISOString() },
        { status: 404 },
      )
    }
    // Two reviewers opening the same case is normal. The second one is told.
    if (found.decidedAt !== null) {
      return HttpResponse.json(
        {
          code: 'ALREADY_DECIDED',
          message: 'This case was already decided',
          timestamp: new Date().toISOString(),
        },
        { status: 409 },
      )
    }
    if (!body.reason || body.reason.trim().length < 10) {
      return HttpResponse.json(
        { code: 'REASON_REQUIRED', message: 'A reason is required', timestamp: new Date().toISOString() },
        { status: 400 },
      )
    }

    const status = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    const decidedAt = new Date().toISOString()

    // Section 8.1: issued on the FIRST approval, and never reissued. Keyed on
    // the registration number rather than the case, so a later expiry and
    // re-approval returns the same identifier.
    if (status === 'APPROVED' && !issuedImmortalIds[found.claim.registrationNumber]) {
      issuedImmortalIds[found.claim.registrationNumber] = issueImmortalId({
        // The council is the authority for the country, not the claim. A
        // browser that sent the wrong one must not be able to put it into a
        // permanent identifier.
        countryCode: councilCountry(found.claim.council),
        medicalSystemCode: found.claim.medicalSystem || 'A',
      })
    }
    const issuedId = issuedImmortalIds[found.claim.registrationNumber] ?? null

    reviewCases[index] = {
      ...found,
      status,
      decidedAt,
      decidedBy: 'dev.reviewer',
      decisionReason: body.reason,
      // The console shows it too. A reviewer who just approved someone needs to
      // see the identifier that approval created, not go looking for it.
      immortalId: status === 'APPROVED' ? issuedId : found.immortalId,
    }

    /**
     * The same decision, applied to the case the practitioner is watching.
     *
     * These are two views of one case, and before this the decision moved only
     * the reviewer's copy: an admin approved, the case left the queue, and the
     * practitioner's page sat on "Reviewed by our team, in progress" forever
     * with no Immortal ID. The approval had no effect on the only person it was
     * about.
     */
    const owner = practitionerCases.findIndex((c) => c.caseId === found.caseId)
    if (owner >= 0) {
      const current = practitionerCases[owner] as PractitionerCaseDetail
      const approved = status === 'APPROVED'

      practitionerCases[owner] = {
        ...current,
        status,
        outcomeCode: approved ? 'VERIFIED' : 'COULD_NOT_VERIFY',
        decidedAt,
        immortalId: approved ? issuedId : null,
        verifiedAsOf: approved ? decidedAt.slice(0, 10) : null,
        registrySourceBatch: approved ? (current.registrySourceBatch ?? 'manual-review') : null,
        progress: [
          { step: 'SUBMITTED', state: 'DONE' },
          { step: 'CHECKING', state: 'DONE' },
          { step: 'REVIEW', state: 'DONE' },
          { step: 'DECISION', state: approved ? 'DONE' : 'ERROR' },
        ],
      }
    }

    const next = reviewCases.find((c) => OPEN_STATUSES.has(c.status) && c.caseId !== found.caseId)
    return HttpResponse.json({
      caseId: found.caseId,
      status,
      decidedAt,
      nextCaseId: next?.caseId ?? null,
    })
  }),

  // ---- practitioner ------------------------------------------------------
  http.get('/api/v1/verifications', () =>
    HttpResponse.json({
      content: practitionerCases.map((c) => ({
        caseId: c.caseId,
        status: c.status,
        outcomeCode: c.outcomeCode,
        submittedAt: c.submittedAt,
        decidedAt: c.decidedAt,
        claim: c.claim,
      })),
      totalElements: practitionerCases.length,
      totalPages: 1,
      number: 0,
      size: 20,
    }),
  ),

  http.get('/api/v1/verifications/:caseId', ({ params }) => {
    const found = practitionerCases.find((c) => c.caseId === params['caseId'])
    if (!found) {
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: 'No such case', timestamp: new Date().toISOString() },
        { status: 404 },
      )
    }
    return HttpResponse.json(found)
  }),

  /**
   * Step 1 of the wizard. Mirrors RegistryLookupService, including what it
   * refuses to say.
   *
   * The masking is duplicated from the Java rather than shared, which is
   * normally the mistake Normalizer's class comment warns about. It is
   * tolerable here only because this file deletes when the backend lands, and
   * because a mask that drifted would produce a visibly wrong string rather
   * than a silent matching failure.
   *
   * No rate limit. The budget is a server concern and a mock that enforced it
   * would make every twenty first test in a run fail for a reason unrelated to
   * what it tests. Tests that need the 429 path override this handler.
   */
  http.post('/api/v1/verifications/lookup', async ({ request }) => {
    const body = (await request.json()) as { council: string; registrationNumber: string }

    const empty = (outcome: string) =>
      HttpResponse.json({
        outcome,
        councilName: '',
        maskedName: '',
        standing: '',
        asOfBatch: '',
      })

    if (!body.registrationNumber?.trim()) {
      return HttpResponse.json(
        {
          code: 'BAD_REQUEST',
          message: 'Enter your registration number.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      )
    }

    // fullName is irrelevant here: the lookup keys on licence and council only,
    // and the name is the thing being withheld.
    const candidates = matchClaim({
      fullName: '',
      registrationNumber: body.registrationNumber,
      council: body.council,
    })

    if (candidates.length === 0) return empty('NOT_FOUND')
    if (candidates.length > 1) return empty('AMBIGUOUS')

    const row = candidates[0]!.row
    return HttpResponse.json({
      outcome: 'FOUND',
      councilName: councilName(body.council),
      // First character of each part, then a fixed four bullets. Fixed width so
      // the mask carries nothing about how long the real name is.
      maskedName: row.fullNameNormalized
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => `${part[0]}••••`)
        .join(' '),
      // Six registry statuses collapse to three. SUSPENDED and REVOKED both
      // arrive as NOT_ACTIVE: nobody has proved yet that they are the person on
      // the row, so naming the sanction would disclose it to whoever guessed
      // the number.
      standing: row.status === 'ACTIVE' ? 'ACTIVE' : row.status === 'UNKNOWN' ? 'UNKNOWN' : 'NOT_ACTIVE',
      asOfBatch: row.sourceBatch,
    })
  }),

  /**
   * Identity document upload.
   *
   * Mirrors the server's refusals, including the magic byte check, because the
   * wizard's error handling is most of what this step is. What it deliberately
   * does NOT mirror is encryption: there is nothing to encrypt against here and
   * pretending otherwise would teach the wrong thing about where that happens.
   */
  http.post('/api/v1/documents', async ({ request }) => {
    const bad = (message: string) =>
      HttpResponse.json(
        { code: 'BAD_REQUEST', message, timestamp: new Date().toISOString() },
        { status: 400 },
      )

    const form = await request.formData()
    const file = form.get('file')
    const kind = String(form.get('kind') ?? '')

    if (!(file instanceof File)) return bad('Choose a file to upload.')
    if (!['PHOTO_ID', 'SELFIE', 'REGISTRATION_CERTIFICATE'].includes(kind)) {
      return bad(`Unknown document kind: ${kind}`)
    }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      return bad('Upload a JPEG, PNG or PDF.')
    }
    if (file.size > 10 * 1024 * 1024) {
      return bad('That file is larger than 10 MB. Try a smaller photo.')
    }

    // The declared type is whatever the browser chose to send, so the server
    // checks the leading bytes too, and so does this.
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
    const looksRight =
      (file.type === 'image/jpeg' && head[0] === 0xff && head[1] === 0xd8) ||
      (file.type === 'image/png' && head[0] === 0x89 && head[1] === 0x50) ||
      (file.type === 'application/pdf' && head[0] === 0x25 && head[1] === 0x50)
    if (!looksRight) {
      return bad(`That file does not look like a ${file.type}. Upload a JPEG, PNG or PDF.`)
    }

    return HttpResponse.json({
      documentId: crypto.randomUUID(),
      kind,
      sizeBytes: file.size,
    })
  }),

  http.post('/api/v1/verifications', async ({ request }) => {
    const claim = (await request.json()) as PractitionerCaseDetail['claim']

    /**
     * The council is the authority for its own country, so a claim whose two
     * answers disagree is rejected rather than silently resolved. Either half
     * could be the mistake, and preferring one would hide a broken form: the
     * practitioner would end up with a permanent ID naming a country they never
     * chose.
     */
    if (claim.country && councilCountry(claim.council) !== claim.country) {
      return HttpResponse.json(
        {
          code: 'BAD_REQUEST',
          message: `${councilName(claim.council)} registers in ${councilCountry(claim.council)}, not ${claim.country}`,
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      )
    }

    if (!claim.medicalSystem || !MEDICAL_SYSTEMS.some((s) => s.code === claim.medicalSystem)) {
      return HttpResponse.json(
        {
          code: 'BAD_REQUEST',
          message: `Unknown medical system code: ${claim.medicalSystem}`,
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      )
    }

    const open = practitionerCases.find((c) => OPEN_STATUSES.has(c.status))
    if (open) {
      return HttpResponse.json(
        { code: 'CLAIM_ALREADY_OPEN', caseId: open.caseId, submittedAt: open.submittedAt },
        { status: 409 },
      )
    }

    /**
     * Normalize, match, run the catalog, decide. Synchronously, because the
     * whole pipeline is an indexed lookup plus six comparisons over rows
     * already in memory: there is nothing here worth making a person wait for.
     *
     * The real thing is asynchronous from intake onward (non negotiable 7), and
     * this stands in for the queue landing almost immediately. What it must not
     * do is what it did before, which was leave the case in SUBMITTED forever so
     * the portal showed "Checking your details" with nothing behind it.
     */
    const candidates = matchClaim(claim)
    const ruleResults = evaluate(candidates)
    const decision = decide(candidates, ruleResults)
    const now = new Date().toISOString()

    const approved = decision === 'APPROVED'
    const status: CaseStatus =
      decision === 'APPROVED'
        ? 'APPROVED'
        : decision === 'REJECTED'
          ? 'REJECTED'
          : decision === 'NO_MATCH'
            ? 'NO_MATCH'
            : 'MANUAL_REVIEW'

    /**
     * Issued once, on the first approval, and never reissued. Held on the
     * account rather than the case, so it survives a later expiry or revocation
     * exactly as section 8.1 requires.
     */
    if (approved && !issuedImmortalIds[claim.registrationNumber]) {
      issuedImmortalIds[claim.registrationNumber] = issueImmortalId({
        countryCode: councilCountry(claim.council),
        medicalSystemCode: claim.medicalSystem ?? 'A',
      })
    }
    const immortalId = approved ? (issuedImmortalIds[claim.registrationNumber] as string) : null
    const matched = candidates[0]?.row ?? null

    const created: PractitionerCaseDetail = {
      caseId: crypto.randomUUID(),
      status,
      outcomeCode: approved
        ? 'VERIFIED'
        : decision === 'REJECTED'
          ? 'COULD_NOT_VERIFY'
          : 'IN_REVIEW',
      submittedAt: now,
      decidedAt: decision === 'MANUAL_REVIEW' || decision === 'NO_MATCH' ? null : now,
      claim,
      progress: [
        { step: 'SUBMITTED', state: 'DONE' },
        { step: 'CHECKING', state: 'DONE' },
        {
          step: 'REVIEW',
          state: decision === 'MANUAL_REVIEW' || decision === 'NO_MATCH' ? 'ACTIVE' : 'SKIPPED',
        },
        {
          step: 'DECISION',
          state: decision === 'MANUAL_REVIEW' || decision === 'NO_MATCH' ? 'PENDING' : 'DONE',
        },
      ],
      verifiedAsOf: approved ? now.slice(0, 10) : null,
      registrySourceBatch: approved ? (matched?.sourceBatch ?? null) : null,
      immortalId,
    }
    practitionerCases = [created, ...practitionerCases]

    /**
     * The console only sees what a person actually has to decide.
     *
     * An approved or rejected case is finished, and putting it in the review
     * queue would make the queue a log rather than a worklist. Everything is
     * still reachable through /admin/cases, which exists precisely so a
     * reviewer can look up a case that is not in the queue.
     */
    if (decision === 'MANUAL_REVIEW' || decision === 'NO_MATCH') {
      reviewCases = [
        {
          caseId: created.caseId,
          status,
          submittedAt: now,
          decidedAt: null,
          decidedBy: null,
          decisionReason: null,
          immortalId: null,
          claim: {
            ...claim,
            country: claim.country ?? '',
            medicalSystem: claim.medicalSystem ?? '',
            normalizedName: normalizeName(claim.fullName),
            normalizedRegistrationNumber: licenceKeys(claim.registrationNumber, claim.council)[0] ?? '',
          },
          candidates: candidates.map((c) => ({
            registryRecordId: `${c.row.councilCode}-${c.row.licenceRaw}`,
            registrationNumber: c.row.licenceRaw,
            fullName: c.row.fullNameRaw,
            council: c.row.councilCode,
            specialty: c.row.specialty ?? '',
            status: c.row.status,
            validUntil: c.row.validUntil ?? '',
            nameScore: c.nameScore,
            matchedOn: c.matchedOn,
            sourceBatch: c.row.sourceBatch,
          })),
          ruleResults,
          audit: [
            { at: now, eventType: 'STATUS_CHANGE', actor: 'practitioner', fromStatus: null, toStatus: 'SUBMITTED', reason: null },
            { at: now, eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'SUBMITTED', toStatus: 'MATCHING', reason: null },
            candidates.length === 0
              ? { at: now, eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'MATCHING', toStatus: 'NO_MATCH', reason: '0 candidates' }
              : { at: now, eventType: 'STATUS_CHANGE', actor: 'system', fromStatus: 'MATCHING', toStatus: 'RULES_EVAL', reason: `${candidates.length} candidate${candidates.length === 1 ? '' : 's'}` },
            {
              at: now,
              eventType: 'STATUS_CHANGE',
              actor: 'system',
              fromStatus: candidates.length === 0 ? 'NO_MATCH' : 'RULES_EVAL',
              toStatus: 'MANUAL_REVIEW',
              reason:
                candidates.length === 0
                  ? 'zero candidates always routes to a person'
                  : ruleResults
                      .filter((r) => r.outcome === 'REVIEW' || r.outcome === 'FAIL')
                      .map((r) => `${r.ruleCode} ${r.outcome}`)
                      .join(', '),
            },
          ],
        } as ReviewCaseDetail,
        ...reviewCases,
      ]
    }

    // 202: accepted. The decision is already made here because the pipeline is
    // an in memory lookup, but the contract stays 202 so the portal keeps
    // polling and the real asynchronous version needs no client change.
    return HttpResponse.json(created, { status: 202 })
  }),

  // ---- public ------------------------------------------------------------
  http.get('/api/v1/public/verify', ({ request }) => {
    const id = new URL(request.url).searchParams.get('immortalId') ?? ''

    /**
     * Answers from the cases this system actually approved, rather than one
     * hardcoded ID. An unknown ID and an unverified one produce the same body,
     * so this endpoint cannot be used to discover which IDs exist.
     *
     * Read live from the current case, never from a stored flag: non negotiable
     * 3 is that a revoked practitioner stops reading as verified everywhere the
     * moment the case flips.
     */
    const approved = practitionerCases.find(
      (c) => c.immortalId === id && c.status === 'APPROVED',
    )

    if (!approved) {
      // Byte for byte the same keys as a verified answer. A missing key would
      // leak existence through the response shape rather than its values, which
      // is the version of this bug that survives a review of the values.
      return HttpResponse.json({
        immortalId: id,
        displayName: '',
        status: 'NOT_VERIFIED',
        verifiedAsOf: '',
        registrySourceBatch: '',
        council: '',
        country: '',
        countryCode: '',
        medicalSystem: '',
      })
    }

    // Initial plus surname, which is all a verification answer needs to show.
    const parts = approved.claim.fullName.trim().split(/\s+/)
    const displayName =
      parts.length > 1
        ? `${parts[0]?.[0]}. ${parts[parts.length - 1]}`
        : (parts[0] ?? '')

    const countryCode = councilCountry(approved.claim.council)
    const systemCode = approved.claim.medicalSystem ?? ''

    return HttpResponse.json({
      immortalId: id,
      displayName,
      status: 'VERIFIED',
      verifiedAsOf: approved.verifiedAsOf ?? '',
      registrySourceBatch: approved.registrySourceBatch ?? '',
      council: councilName(approved.claim.council),
      // Read from the case, not decoded from the string in the query. Decoding
      // would make the caller's own input the source of the answer.
      country: COUNTRIES.find((c) => c.code === countryCode)?.name ?? countryCode,
      countryCode,
      medicalSystem: MEDICAL_SYSTEMS.find((s) => s.code === systemCode)?.name ?? systemCode,
    })
  }),

  // ---- auth --------------------------------------------------------------
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    const email = body.email.trim().toLowerCase() as AccountEmail
    // Both halves checked together, and one response for either failing.
    // Answering differently for an unknown email turns this endpoint into a way
    // to find out who holds an account.
    if (!(email in ACCOUNTS) || PASSWORDS[email] !== body.password) {
      return HttpResponse.json(
        { code: 'BAD_CREDENTIALS', message: 'Invalid credentials', timestamp: new Date().toISOString() },
        { status: 401 },
      )
    }
    return HttpResponse.json(sessionFor(email))
  }),

  /**
   * Signing up, mocked.
   *
   * Mirrors the real rules the client depends on: minimum length, duplicate
   * detection on the normalized address, and PRACTITIONER regardless of what
   * the body asks for. A mock that granted a role from the request would let
   * the console's guard be tested against a lie.
   */
  http.post('/api/v1/auth/register', async ({ request }) => {
    const body = (await request.json()) as {
      email: string
      password: string
      fullName: string
    }
    const email = body.email.trim().toLowerCase()

    if (!body.password || body.password.length < 12) {
      return HttpResponse.json(
        { code: 'BAD_REQUEST', message: 'Use a password of at least 12 characters.', timestamp: new Date().toISOString() },
        { status: 400 },
      )
    }
    if (email in ACCOUNTS || email in registered) {
      return HttpResponse.json(
        { code: 'EMAIL_IN_USE', message: 'An account already exists for that email address.', timestamp: new Date().toISOString() },
        { status: 409 },
      )
    }

    registered[email] = {
      id: crypto.randomUUID(),
      email,
      fullName: body.fullName.trim(),
      role: 'PRACTITIONER',
      immortalId: null,
    }
    return HttpResponse.json(sessionFor(email), { status: 201 })
  }),

  http.post('/api/v1/auth/refresh', async ({ request }) => {
    const body = (await request.json()) as { refreshToken?: string }
    const email = (body.refreshToken ?? '').replace('mock.refresh.', '')
    if (!accountByEmail(email)) return unauthorized()
    return HttpResponse.json(sessionFor(email))
  }),

  // Always 204. A client that has decided to end its session has already
  // discarded the credential; answering 401 only reveals whether it was live.
  http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),

  http.post('/api/v1/auth/logout-all', ({ request }) =>
    accountFromRequest(request) ? HttpResponse.json({ sessionsEnded: 1 }) : unauthorized(),
  ),

  http.get('/api/v1/me', ({ request }) => {
    const account = accountFromRequest(request)
    return account
      ? HttpResponse.json({ ...account, authenticatedBy: 'SESSION' })
      : unauthorized()
  }),

  http.get('/api/v1/me/sessions', ({ request }) =>
    accountFromRequest(request)
      ? HttpResponse.json([
          {
            id: 'session-0000-4000-8000-000000000001',
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            userAgent: navigator.userAgent,
            ipAddress: '127.0.0.1',
          },
        ])
      : unauthorized(),
  ),

  // ---- API keys ----------------------------------------------------------
  http.get('/api/v1/me/api-keys', ({ request }) => {
    const account = accountFromRequest(request)
    if (!account) return unauthorized()
    return HttpResponse.json(apiKeys[account.email] ?? [])
  }),

  http.post('/api/v1/me/api-keys', async ({ request }) => {
    const account = accountFromRequest(request)
    if (!account) return unauthorized()
    const body = (await request.json()) as { name?: string }
    if (!body.name?.trim()) {
      return HttpResponse.json(
        { code: 'BAD_REQUEST', message: 'Give the key a name you will recognise later.', timestamp: new Date().toISOString() },
        { status: 400 },
      )
    }

    // Generated the way the real one is, so what the screen shows here is the
    // shape a developer will actually paste into their configuration.
    const body36 = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b % 64])
      .join('')
    const full = `hi_live_${body36}`

    const record = {
      id: crypto.randomUUID(),
      name: body.name.trim(),
      prefix: full.slice(0, 'hi_live_'.length + 6),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      revokedAt: null,
      lastUsedAt: null,
      status: 'ACTIVE' as const,
    }
    apiKeys[account.email] = [record, ...(apiKeys[account.email] ?? [])]

    // The full key exists here and nowhere else, exactly as on the server,
    // which stores only a digest.
    return HttpResponse.json(
      { ...record, key: full, warning: 'Copy this key now. It cannot be shown again.' },
      { status: 201 },
    )
  }),

  http.delete('/api/v1/me/api-keys/:keyId', ({ request, params }) => {
    const account = accountFromRequest(request)
    if (!account) return unauthorized()
    apiKeys[account.email] = (apiKeys[account.email] ?? []).map((key) =>
      key.id === params['keyId']
        ? { ...key, status: 'REVOKED' as const, revokedAt: new Date().toISOString() }
        : key,
    )
    return new HttpResponse(null, { status: 204 })
  }),

  /**
   * Public reference data, no auth. The claim form needs it before anyone has
   * an account, and the list is not sensitive: it is the set of bodies whose
   * registers we hold, which is exactly what the public verify page already
   * prints.
   *
   * Served rather than shipped in the bundle for the reason V2 gives for making
   * councils a table instead of a Java enum: adding one is a migration, not a
   * redeploy. A hardcoded client copy defeats that, and did.
   */
  http.get('/api/v1/councils', () => HttpResponse.json(COUNCILS)),

  /**
   * The two lists that feed the Immortal ID. Same reasoning as councils, and a
   * stronger case: a stale council list blocks a form, a stale medical system
   * list writes the wrong character into an identifier issued once and never
   * changed.
   */
  http.get('/api/v1/countries', () => HttpResponse.json(COUNTRIES)),
  http.get('/api/v1/medical-systems', () => HttpResponse.json(MEDICAL_SYSTEMS)),

  // ---- registry import ---------------------------------------------------
  ...importHandlers,
]
