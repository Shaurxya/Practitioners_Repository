import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockData } from '@/mocks/handlers'
import {
  addRegistryRows,
  decide,
  evaluate,
  isValidImmortalId,
  issueImmortalId,
  licenceKeys,
  matchClaim,
  nameSimilarity,
  normalizeName,
  resetRegistry,
} from './verificationEngine'

function row(over: Partial<Parameters<typeof addRegistryRows>[0][number]> = {}) {
  const licenceRaw = over.licenceRaw ?? 'NR/AY/GA/0000001'
  const councilCode = over.councilCode ?? 'GA'
  const fullNameRaw = over.fullNameRaw ?? 'PRABHUDESSAI VINAYAK'
  return {
    councilCode,
    licenceRaw,
    licenceKeys: licenceKeys(licenceRaw, councilCode),
    fullNameRaw,
    fullNameNormalized: normalizeName(fullNameRaw),
    status: 'ACTIVE',
    validUntil: '2030-03-31',
    specialty: 'Ayurveda',
    sourceBatch: 'ga-2026-08-05',
    ...over,
  }
}

const CLAIM = {
  fullName: 'Prabhudessai Vinayak',
  registrationNumber: 'NR/AY/GA/0000001',
  council: 'GA',
}

beforeEach(() => {
  resetMockData(false)
  resetRegistry()
})

describe('normalization', () => {
  it('strips titles and punctuation so a claim and a register row meet', () => {
    expect(normalizeName('Dr. Anita R. Sharma')).toBe('ANITA R SHARMA')
    expect(normalizeName('VAIDYA  PRABHUDESSAI   VINAYAK')).toBe('PRABHUDESSAI VINAYAK')
  })

  /**
   * 10.3% of registry rows omit the council prefix, so MH4471 and 4471 on a
   * Maharashtra row must reach the same value or one exact match in ten fails
   * with nothing on screen to explain it.
   */
  it('treats every written form of one licence number as the same number', () => {
    const withPrefix = licenceKeys('MH-28409', 'MH')
    const without = licenceKeys('28409', 'MH')
    expect(withPrefix.some((k) => without.includes(k))).toBe(true)
  })

  it('keeps different councils apart even with identical digits', () => {
    addRegistryRows([row({ councilCode: 'MH', licenceRaw: 'MH-28409' })])
    expect(matchClaim({ ...CLAIM, registrationNumber: '28409', council: 'KL' })).toHaveLength(0)
  })
})

describe('name similarity', () => {
  it('sees a reordered name as the same person', () => {
    // Raw edit distance scores this 0.36, which would fail the claim outright.
    expect(nameSimilarity('PRABHUDESSAI VINAYAK', 'VINAYAK PRABHUDESSAI')).toBeGreaterThan(0.9)
  })

  it('tolerates one mistyped character', () => {
    expect(nameSimilarity('ANITA SHARMA', 'ANITA SHARMS')).toBeGreaterThan(0.9)
  })

  it('does not call two different people a match', () => {
    expect(nameSimilarity('ANITA SHARMA', 'VIKRAM JOSHI')).toBeLessThan(0.5)
  })
})

describe('the decision', () => {
  it('approves a clean match', () => {
    addRegistryRows([row()])
    const candidates = matchClaim(CLAIM)
    expect(candidates).toHaveLength(1)
    expect(decide(candidates, evaluate(candidates))).toBe('APPROVED')
  })

  it('routes to a person when nothing matched', () => {
    expect(decide(matchClaim(CLAIM), [])).toBe('NO_MATCH')
  })

  it('rejects a suspended registration', () => {
    addRegistryRows([row({ status: 'SUSPENDED' })])
    const candidates = matchClaim(CLAIM)
    expect(decide(candidates, evaluate(candidates))).toBe('REJECTED')
  })

  it('rejects a registration that expired beyond the grace window', () => {
    addRegistryRows([row({ validUntil: '2020-01-01' })])
    const candidates = matchClaim(CLAIM)
    expect(decide(candidates, evaluate(candidates))).toBe('REJECTED')
  })

  /** D3: renewals lag the register, so a recent expiry is a question, not a no. */
  it('sends a recently expired registration to a person, not to rejection', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    addRegistryRows([row({ validUntil: yesterday })])
    const candidates = matchClaim(CLAIM)
    expect(decide(candidates, evaluate(candidates))).toBe('MANUAL_REVIEW')
  })

  it('sends two candidates to a person rather than picking one', () => {
    addRegistryRows([row(), row({ fullNameRaw: 'PRABHUDESSAI VINAYAK M' })])
    const candidates = matchClaim(CLAIM)
    expect(candidates).toHaveLength(2)
    expect(decide(candidates, evaluate(candidates))).toBe('MANUAL_REVIEW')
  })

  /**
   * A register that publishes no standing status cannot be auto approved, and
   * must not be auto rejected either. Both halves matter: failing it would
   * reject every practitioner in that register on a fact the document never
   * asserted.
   */
  it('sends an unknown status to a person', () => {
    addRegistryRows([row({ status: 'UNKNOWN' })])
    const candidates = matchClaim(CLAIM)
    const results = evaluate(candidates)

    expect(results.find((r) => r.ruleCode === 'LICENSE_ACTIVE')?.outcome).toBe('REVIEW')
    expect(decide(candidates, results)).toBe('MANUAL_REVIEW')
  })

  /** Decision rule 4: a SKIPPED result for a required rule becomes REVIEW. */
  it('does not auto approve when a required rule could not run', () => {
    addRegistryRows([row({ validUntil: null })])
    const candidates = matchClaim(CLAIM)
    const results = evaluate(candidates)

    expect(results.find((r) => r.ruleCode === 'NOT_EXPIRED')?.outcome).toBe('SKIPPED')
    expect(decide(candidates, results)).toBe('MANUAL_REVIEW')
  })

  it('ignores a skipped rule that is not required', () => {
    addRegistryRows([row()])
    const candidates = matchClaim(CLAIM)
    const results = evaluate(candidates)

    expect(results.find((r) => r.ruleCode === 'DOC_CONSISTENT')?.outcome).toBe('SKIPPED')
    expect(decide(candidates, results)).toBe('APPROVED')
  })
})

describe('the Immortal ID', () => {
  it('has the shape section 8.2 specifies', () => {
    expect(issueImmortalId()).toMatch(/^HI-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
  })

  /** Crockford omits I, L, O and U, so 1/I, 0/O and V/U cannot be transcribed wrong. */
  it('never contains a character that can be misread', () => {
    for (let i = 0; i < 200; i++) {
      const body = issueImmortalId().slice('HI-'.length)
      expect(body).not.toMatch(/[ILOU]/)
    }
  })

  it('catches a single mistyped character', () => {
    const id = issueImmortalId()
    expect(isValidImmortalId(id)).toBe(true)

    // Swap one body character for a different valid one.
    const broken = id.replace(/[0-9A-HJKMNP-TV-Z]/, (c) => (c === '7' ? '8' : '7'))
    expect(isValidImmortalId(broken)).toBe(false)
  })

  it('does not collide across a realistic number of issues', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => issueImmortalId()))
    expect(seen.size).toBe(5000)
  })
})
