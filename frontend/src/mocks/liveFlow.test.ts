import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockData } from '@/mocks/handlers'

/**
 * The two halves of the product are views of the same case.
 *
 * Before this, submitting a claim on the public site created a practitioner
 * case and nothing else, while the review queue only ever served fixtures. So
 * the console could be clicked through all day without a single thing an
 * operator did on the public side ever appearing in it: two separate demos
 * wearing one product's clothes.
 *
 * Runs against an empty dataset on purpose, which is also how the app boots.
 */
beforeEach(() => resetMockData(false))

const CLAIM = {
  fullName: 'Prabhudessai Vinayak',
  registrationNumber: 'NR/AY/GA/0000001',
  council: 'GA',
  specialty: 'Ayurveda',
}

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, init)
  return { status: response.status, body: await response.json().catch(() => null) }
}

describe('a claim submitted on the public site', () => {
  it('starts with nothing in the queue', async () => {
    const queue = await json('/api/v1/admin/review?page=0&size=25')
    expect(queue.body.totalElements).toBe(0)
    expect(queue.body.content).toEqual([])
  })

  it('appears in the admin review queue', async () => {
    const created = await json('/api/v1/verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CLAIM),
    })
    expect(created.status).toBe(202)

    const queue = await json('/api/v1/admin/review?page=0&size=25')
    expect(queue.body.totalElements).toBe(1)

    const row = queue.body.content[0]
    expect(row.caseId).toBe(created.body.caseId)
    expect(row.claimedFullName).toBe('Prabhudessai Vinayak')
    expect(row.claimedRegistrationNumber).toBe('NR/AY/GA/0000001')
    expect(row.council).toBe('GA')

    /**
     * With no registry loaded there are zero candidates, so no rule ran and
     * there is no reason to list. That is the design: "found or not found" is
     * decided by the matching stage, not by a rule, which is why LICENSE_FOUND
     * was removed from the catalog. The status carries the fact instead.
     */
    expect(row.status).toBe('NO_MATCH')
    expect(row.routedReasons).toEqual([])
  })

  it('is the same case on both sides, not a copy', async () => {
    const created = await json('/api/v1/verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CLAIM),
    })

    const detail = await json(`/api/v1/admin/review/${created.body.caseId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.claim.registrationNumber).toBe('NR/AY/GA/0000001')
    // Normalized on the way in, the way the matcher will need it.
    expect(detail.body.claim.normalizedRegistrationNumber).toBe('NRAYGA0000001')
  })
})

describe('the admin console', () => {
  it('starts with no imports, so it shows what this admin uploaded', async () => {
    const imports = await json('/api/v1/admin/imports?page=0&size=25')
    expect(imports.body.totalElements).toBe(0)
  })
})

describe('authentication', () => {
  it('refuses to identify anyone without a token', async () => {
    const me = await json('/api/v1/me')
    expect(me.status).toBe(401)
  })

  it('answers the same way for a wrong password and an unknown email', async () => {
    const wrongPassword = await json('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@herbimmortal.test', password: 'nope' }),
    })
    const unknownEmail = await json('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.test', password: 'devpassword' }),
    })

    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(wrongPassword.body.code).toBe(unknownEmail.body.code)
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message)
  })

  it('signs in the admin account', async () => {
    const login = await json('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@herbimmortal.com', password: 'admin@password' }),
    })
    expect(login.status).toBe(200)

    const me = await json('/api/v1/me', {
      headers: { Authorization: `Bearer ${login.body.accessToken}` },
    })
    expect(me.status).toBe(200)
    expect(me.body.email).toBe('admin@herbimmortal.com')
    expect(me.body.role).toBe('ADMIN')
  })

  it('gives each account its own password rather than one shared string', async () => {
    // The old rule accepted any known email with "devpassword", so adding an
    // account with its own credential would have left the old one working on it.
    const crossed = await json('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@herbimmortal.com', password: 'devpassword' }),
    })
    expect(crossed.status).toBe(401)
  })

  /**
   * /me serializes the account record straight back to the browser, so a
   * password stored on that object would be published on every page load.
   */
  it('never returns a password to the client', async () => {
    const login = await json('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@herbimmortal.com', password: 'admin@password' }),
    })
    const me = await json('/api/v1/me', {
      headers: { Authorization: `Bearer ${login.body.accessToken}` },
    })

    expect(JSON.stringify(me.body)).not.toContain('admin@password')
    expect(Object.keys(me.body)).toEqual(['id', 'email', 'fullName', 'role', 'immortalId'])
  })

  it('identifies the account the token belongs to', async () => {
    const login = await json('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@herbimmortal.test', password: 'devpassword' }),
    })
    expect(login.status).toBe(200)

    const me = await json('/api/v1/me', {
      headers: { Authorization: `Bearer ${login.body.accessToken}` },
    })
    expect(me.status).toBe(200)
    expect(me.body.role).toBe('ADMIN')

    const practitioner = await json('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'anita@example.com', password: 'devpassword' }),
    })
    const asPractitioner = await json('/api/v1/me', {
      headers: { Authorization: `Bearer ${practitioner.body.accessToken}` },
    })
    expect(asPractitioner.body.role).toBe('PRACTITIONER')
  })
})

/**
 * The reviewer's copy and the practitioner's copy are two views of one case.
 *
 * Approving used to move only the reviewer's: the case left the queue and the
 * practitioner's page sat on "Reviewed by our team, in progress" forever with
 * no Immortal ID. The approval had no effect on the only person it was about.
 */
describe('a manual approval', () => {
  const CLAIM_B = {
    fullName: 'Vernekar Premanand Laxman',
    registrationNumber: 'NR/AY/GA/0000002',
    council: 'GA',
    specialty: 'Ayurveda',
  }

  async function submitAndApprove(reason = 'Checked by hand against the council register.') {
    const created = await json('/api/v1/verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CLAIM_B),
    })
    await json(`/api/v1/admin/review/${created.body.caseId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVE', reason }),
    })
    return json(`/api/v1/verifications/${created.body.caseId}`)
  }

  it('issues an Immortal ID the practitioner can see', async () => {
    const after = await submitAndApprove()

    expect(after.body.status).toBe('APPROVED')
    expect(after.body.outcomeCode).toBe('VERIFIED')
    expect(after.body.immortalId).toMatch(/^HI-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(after.body.verifiedAsOf).not.toBeNull()
  })

  it('finishes the progress tracker rather than leaving it in progress', async () => {
    const after = await submitAndApprove()
    const steps = Object.fromEntries(
      after.body.progress.map((p: { step: string; state: string }) => [p.step, p.state]),
    )

    expect(steps['REVIEW']).toBe('DONE')
    expect(steps['DECISION']).toBe('DONE')
  })

  it('makes the practitioner verifiable at the public endpoint', async () => {
    const after = await submitAndApprove()
    const check = await json(`/api/v1/public/verify?immortalId=${after.body.immortalId}`)

    expect(check.body.status).toBe('VERIFIED')
    expect(check.body.displayName).toBe('V. Laxman')
  })

  it('refuses a decision without a reason, since it goes in the audit log', async () => {
    const created = await json('/api/v1/verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CLAIM_B),
    })
    const refused = await json(`/api/v1/admin/review/${created.body.caseId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'APPROVE', reason: 'ok' }),
    })

    expect(refused.status).toBe(400)
  })
})
