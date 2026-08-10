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
  const AYURVEDA_IN = { countryCode: 'IN', medicalSystemCode: 'A' }

  it('has the shape section 8.2 specifies', () => {
    expect(issueImmortalId({ ...AYURVEDA_IN, year: 2026 })).toMatch(/^HI-26INA-[A-Z0-9]{5}$/)
  })

  it('carries the year, country and system it was issued under', () => {
    expect(issueImmortalId({ countryCode: 'US', medicalSystemCode: 'T', year: 2031 })).toMatch(
      /^HI-31UST-/,
    )
  })

  /**
   * The old format was Crockford base32, which omits I, L, O and U. This one is
   * plain A-Z and 0-9. A generator that quietly kept the Crockford alphabet
   * would shrink the space by 40 percent while the capacity note went on
   * claiming 36^5, so the presence of those four characters is the assertion.
   */
  it('uses the full 36 character alphabet, not Crockford', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      for (const char of issueImmortalId(AYURVEDA_IN).slice('HI-26INA-'.length)) seen.add(char)
    }
    for (const char of 'ILOU') expect(seen.has(char)).toBe(true)
    expect(seen.size).toBe(36)
  })

  it('accepts what it issues and rejects the wrong shape', () => {
    expect(isValidImmortalId(issueImmortalId(AYURVEDA_IN))).toBe(true)
    expect(isValidImmortalId('HI-26INA-K3M7')).toBe(false)
    expect(isValidImmortalId('HI-K3M7Q-8XT2P')).toBe(false)
  })

  /**
   * Not a probability assertion. The mock records every ID it hands out and
   * redraws on a clash, exactly as the real issuer checks the table, so a
   * duplicate here means the uniqueness loop is broken rather than that the
   * dice were unlucky.
   */
  it('never issues the same ID twice', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => issueImmortalId(AYURVEDA_IN)))
    expect(seen.size).toBe(5000)
  })
})
