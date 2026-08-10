import { describe, expect, it } from 'vitest'
import {
  buildImmortalId,
  isCurrentFormat,
  isLegacyFormat,
  looksLikeImmortalId,
  parseImmortalId,
  validateImmortalId,
} from './immortalId'

/**
 * Golden vectors, pinned as literals on purpose.
 *
 * Without these the suite tests the implementation against itself: build and
 * parse would both read the same regex, so a consistently broken format still
 * agrees with itself and every relative assertion passes. These literals are
 * the contract the Java generator has to match, and every one of them is an
 * example from the format specification rather than something this file made up.
 */
const GOLDEN: ReadonlyArray<[year: number, country: string, system: string, suffix: string, id: string]> = [
  [2026, 'IN', 'A', 'K3M7Q', 'HI-26INA-K3M7Q'],
  [2026, 'IN', 'S', 'X8L2P', 'HI-26INS-X8L2P'],
  [2026, 'IN', 'U', 'Q7D5A', 'HI-26INU-Q7D5A'],
  [2026, 'IN', 'Y', 'R9W3K', 'HI-26INY-R9W3K'],
  [2026, 'IN', 'T', 'M4Z8P', 'HI-26INT-M4Z8P'],
  [2026, 'US', 'A', 'L8N2Q', 'HI-26USA-L8N2Q'],
]

describe('Immortal ID', () => {
  it.each(GOLDEN)('builds %i %s %s %s as %s', (year, country, system, suffix, id) => {
    expect(buildImmortalId(year, country, system, suffix)).toBe(id)
    expect(isCurrentFormat(id)).toBe(true)
    expect(looksLikeImmortalId(id)).toBe(true)
  })

  it('pads a single digit year', () => {
    // 2007 must be 07, not 7. Without the pad the ID is one character short and
    // every regex reading one stops matching.
    expect(buildImmortalId(2007, 'IN', 'A', 'K3M7Q')).toBe('HI-07INA-K3M7Q')
  })

  it('uppercases what it is given', () => {
    expect(buildImmortalId(2026, 'in', 'a', 'k3m7q')).toBe('HI-26INA-K3M7Q')
  })

  it('decodes the fixed segments', () => {
    expect(parseImmortalId('HI-26INA-K3M7Q')).toEqual({
      year: 2026,
      countryCode: 'IN',
      medicalSystemCode: 'A',
      suffix: 'K3M7Q',
    })
  })

  it('is case insensitive and tolerant of surrounding space', () => {
    expect(looksLikeImmortalId('  hi-26ina-k3m7q  ')).toBe(true)
    expect(parseImmortalId(' hi-26ina-k3m7q ')?.countryCode).toBe('IN')
  })

  it('rejects the wrong shape', () => {
    expect(isCurrentFormat('HI-26INA-K3M7')).toBe(false) // four random characters
    expect(isCurrentFormat('HI-26INA-K3M7QQ')).toBe(false) // six
    expect(isCurrentFormat('HI-2026INA-K3M7Q')).toBe(false) // four digit year
    expect(isCurrentFormat('XX-26INA-K3M7Q')).toBe(false) // wrong prefix
    expect(isCurrentFormat('HI-26I1A-K3M7Q')).toBe(false) // digit in the country
    expect(isCurrentFormat('HI26INAK3M7Q')).toBe(false) // no separators
    expect(isCurrentFormat('')).toBe(false)
  })

  it('refuses to build an ID it cannot encode honestly', () => {
    expect(() => buildImmortalId(1999, 'IN', 'A', 'K3M7Q')).toThrow()
    expect(() => buildImmortalId(2100, 'IN', 'A', 'K3M7Q')).toThrow()
    expect(() => buildImmortalId(2026, 'IND', 'A', 'K3M7Q')).toThrow()
    expect(() => buildImmortalId(2026, 'IN', 'AY', 'K3M7Q')).toThrow()
    expect(() => buildImmortalId(2026, 'IN', 'A', 'SHORT!')).toThrow()
  })

  it('allows I, L, O and U in the random segment', () => {
    // The old format was Crockford base32, which omits all four. This one is
    // plain A-Z0-9, and a suffix check that silently kept the Crockford
    // alphabet would shrink the space by 40 percent while the capacity note
    // went on claiming 36^5.
    expect(buildImmortalId(2026, 'IN', 'A', 'ILOU1')).toBe('HI-26INA-ILOU1')
    expect(looksLikeImmortalId('HI-26INA-ILOU1')).toBe(true)
  })

  describe('validateImmortalId', () => {
    it('accepts a well formed ID with no reference data loaded', () => {
      expect(validateImmortalId('HI-26INA-K3M7Q')).toBeNull()
    })

    it('explains a malformed ID rather than just refusing it', () => {
      expect(validateImmortalId('HI-ABC-DEF')).toMatch(/HI-26INA-K3M7Q/)
      expect(validateImmortalId('')).toMatch(/Enter an Immortal ID/)
    })

    it('rejects a country we hold no register for', () => {
      expect(validateImmortalId('HI-26ZZA-K3M7Q', { countryCodes: ['IN', 'US'] })).toMatch(/ZZ/)
    })

    it('rejects a medical system we do not issue for', () => {
      expect(
        validateImmortalId('HI-26INQ-K3M7Q', { medicalSystemCodes: ['A', 'S', 'U', 'Y', 'T'] }),
      ).toMatch(/Q/)
    })

    it('does not reject while the reference data is still loading', () => {
      // An empty list means "not loaded yet", not "nothing is valid". Treating
      // the two the same would fail every ID typed in the first second the page
      // is open, which is most of them.
      expect(validateImmortalId('HI-26INA-K3M7Q', { countryCodes: [] })).toBeNull()
      expect(validateImmortalId('HI-26INA-K3M7Q', {})).toBeNull()
    })
  })

  /**
   * Section 8.1: an Immortal ID is permanent and immutable. A format change does
   * not get to suspend that, so IDs issued under the pre-V9 Crockford scheme
   * still have to resolve even though nothing can issue another one.
   */
  describe('IDs issued before the format changed', () => {
    const LEGACY = ['HI-K3M7Q-8XT2P', 'HI-00000-00000', 'HI-ZZZZZ-ZZZZ9', 'HI-12345-6789T']

    it.each(LEGACY)('still recognises %s', (id) => {
      expect(isLegacyFormat(id)).toBe(true)
      expect(looksLikeImmortalId(id)).toBe(true)
      expect(validateImmortalId(id)).toBeNull()
    })

    it('rejects a legacy ID with a broken check character', () => {
      expect(isLegacyFormat('HI-K3M7Q-8XT2A')).toBe(false)
      expect(looksLikeImmortalId('HI-K3M7Q-8XT2A')).toBe(false)
    })

    it('does not mistake a current ID for a legacy one', () => {
      // Both formats are HI-XXXXX-XXXXX by shape. Only the Luhn check separates
      // them, which is why isLegacyFormat verifies it instead of matching a
      // pattern: without that, a typo in a current ID could pass as a valid old
      // one and get sent to the server as something else entirely.
      expect(isLegacyFormat('HI-26INA-K3M7Q')).toBe(false)
      expect(isCurrentFormat('HI-26INA-K3M7Q')).toBe(true)
    })

    it('carries no decodable parts, and says so rather than inventing them', () => {
      expect(parseImmortalId('HI-K3M7Q-8XT2P')).toBeNull()
    })
  })
})
