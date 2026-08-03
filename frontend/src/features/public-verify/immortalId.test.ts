import { describe, expect, it } from 'vitest'
import {
  buildImmortalId,
  checkCharacter,
  formatImmortalId,
  looksLikeImmortalId,
  normalizeCrockford,
} from './immortalId'

/**
 * Golden vectors, pinned as literals on purpose.
 *
 * Without these the suite tests the implementation against itself: build and
 * validate both call checkCharacter, so a consistently broken algorithm still
 * agrees with itself and every relative assertion passes. These literals are
 * the only thing anchoring the algorithm to an external expectation, and they
 * are the contract the Java generator has to match. If a change here forces you
 * to edit these numbers, that change is a breaking change to every ID ever
 * issued.
 */
const GOLDEN: ReadonlyArray<[payload: string, check: string, id: string]> = [
  ['K3M7Q8XT2', 'P', 'HI-K3M7Q-8XT2P'],
  ['000000000', '0', 'HI-00000-00000'],
  ['ZZZZZZZZZ', '9', 'HI-ZZZZZ-ZZZZ9'],
  ['123456789', 'T', 'HI-12345-6789T'],
  ['ABCDEFGHJ', 'T', 'HI-ABCDE-FGHJT'],
]

describe('Immortal ID', () => {
  const valid = buildImmortalId('K3M7Q8XT2')

  it.each(GOLDEN)('computes the known check character for %s', (payload, check, id) => {
    expect(checkCharacter(payload)).toBe(check)
    expect(buildImmortalId(payload)).toBe(id)
    expect(looksLikeImmortalId(id)).toBe(true)
  })

  it('builds an ID in HI-XXXXX-XXXXX form', () => {
    expect(valid).toMatch(/^HI-[0-9A-Z]{5}-[0-9A-Z]{5}$/)
  })

  it('accepts an ID it generated', () => {
    expect(looksLikeImmortalId(valid)).toBe(true)
  })

  it('is case insensitive', () => {
    expect(looksLikeImmortalId(valid.toLowerCase())).toBe(true)
  })

  it('rejects an ID with one character mistyped', () => {
    // Luhn mod 32 catches every single character error, which is the whole
    // reason for having a check character at all.
    const body = valid.replace(/-/g, '').slice(2)
    const first = body.charAt(0)
    const swapped = first === '0' ? '1' : '0'
    const broken = formatImmortalId(swapped + body.slice(1))
    expect(broken).not.toBe(valid)
    expect(looksLikeImmortalId(broken)).toBe(false)
  })

  it('rejects an ID of the wrong shape', () => {
    expect(looksLikeImmortalId('HI-ABC-DEF')).toBe(false)
    expect(looksLikeImmortalId('K3M7Q8XT2A')).toBe(false)
    expect(looksLikeImmortalId('')).toBe(false)
  })

  it('reads I and L as 1 and O as 0, the classic transcription errors', () => {
    expect(normalizeCrockford('ILO')).toBe('110')
  })

  it('never produces a check character outside the Crockford alphabet', () => {
    // Crockford's own mod 37 symbol set includes * ~ $ = and U, which look like
    // corruption on a printed certificate. Luhn mod 32 cannot emit those.
    for (const payload of ['000000000', 'ZZZZZZZZZ', 'K3M7Q8XT2', '123456789']) {
      expect('0123456789ABCDEFGHJKMNPQRSTVWXYZ').toContain(checkCharacter(payload))
    }
  })

  it('rejects a payload of the wrong length', () => {
    expect(() => buildImmortalId('SHORT')).toThrow()
  })
})
