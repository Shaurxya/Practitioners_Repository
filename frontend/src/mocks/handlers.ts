import { HttpResponse, http } from 'msw'
import type { ReviewCaseDetail } from '@/features/admin-review/types'
import type { PractitionerCaseDetail } from '@/features/verification/types'
import { PRACTITIONER_CASES, REVIEW_CASES, VERIFIED_IMMORTAL_ID, toQueueItem } from './fixtures'

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

/** Mutable per session so a decision sticks while you click around. */
let reviewCases: ReviewCaseDetail[] = structuredClone(REVIEW_CASES)
let practitionerCases: PractitionerCaseDetail[] = structuredClone(PRACTITIONER_CASES)

export function resetMockData() {
  reviewCases = structuredClone(REVIEW_CASES)
  practitionerCases = structuredClone(PRACTITIONER_CASES)
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
    reviewCases[index] = {
      ...found,
      status,
      decidedAt,
      decidedBy: 'dev.reviewer',
      decisionReason: body.reason,
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

  http.post('/api/v1/verifications', async ({ request }) => {
    const claim = (await request.json()) as PractitionerCaseDetail['claim']
    const open = practitionerCases.find((c) => OPEN_STATUSES.has(c.status))
    if (open) {
      return HttpResponse.json(
        { code: 'CLAIM_ALREADY_OPEN', caseId: open.caseId, submittedAt: open.submittedAt },
        { status: 409 },
      )
    }

    const created: PractitionerCaseDetail = {
      caseId: crypto.randomUUID(),
      status: 'SUBMITTED',
      outcomeCode: 'IN_PROGRESS',
      submittedAt: new Date().toISOString(),
      decidedAt: null,
      claim,
      progress: [
        { step: 'SUBMITTED', state: 'DONE' },
        { step: 'CHECKING', state: 'ACTIVE' },
        { step: 'REVIEW', state: 'PENDING' },
        { step: 'DECISION', state: 'PENDING' },
      ],
      verifiedAsOf: null,
      registrySourceBatch: null,
      immortalId: null,
    }
    practitionerCases = [created, ...practitionerCases]
    // 202: queued, not decided. The outcome arrives through polling.
    return HttpResponse.json(created, { status: 202 })
  }),

  // ---- public ------------------------------------------------------------
  http.get('/api/v1/public/verify', ({ request }) => {
    const id = new URL(request.url).searchParams.get('immortalId')
    // An unknown ID and an unverified one are the same response, so this
    // endpoint cannot be used to discover which IDs exist.
    if (id !== VERIFIED_IMMORTAL_ID) {
      return HttpResponse.json({
        immortalId: id ?? '',
        displayName: '',
        status: 'NOT_VERIFIED',
        verifiedAsOf: '',
        registrySourceBatch: '',
        council: '',
      })
    }
    return HttpResponse.json({
      immortalId: VERIFIED_IMMORTAL_ID,
      displayName: 'A. Sharma',
      status: 'VERIFIED',
      verifiedAsOf: '2026-07-14',
      registrySourceBatch: 'council-2026-07-14',
      council: 'Maharashtra Council of Indian Medicine',
    })
  }),

  // ---- auth --------------------------------------------------------------
  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string }
    if (body.password !== 'devpassword') {
      // Identical response whether or not the email exists.
      return HttpResponse.json(
        { code: 'BAD_CREDENTIALS', message: 'Invalid credentials', timestamp: new Date().toISOString() },
        { status: 401 },
      )
    }
    return HttpResponse.json({
      accessToken: 'mock.access.token',
      refreshToken: 'mock.refresh.token',
      expiresInSeconds: 900,
    })
  }),

  http.get('/api/v1/me', () =>
    HttpResponse.json({
      id: 'a41c0000-0000-4000-8000-000000000001',
      email: 'anita@example.com',
      fullName: 'Anita Sharma',
      role: 'PRACTITIONER',
      immortalId: VERIFIED_IMMORTAL_ID,
    }),
  ),
]
