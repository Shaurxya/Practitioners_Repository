/**
 * Immortal ID format: HI-YYCCM-RRRRR, for example HI-26INA-K3M7Q.
 *
 *   HI - 26 IN A - K3M7Q
 *   │    │  │  │   └───── five random characters, A-Z and 0-9
 *   │    │  │  └───────── medical system code: A S U Y T
 *   │    │  └──────────── ISO 3166-1 alpha-2 country
 *   │    └─────────────── last two digits of the registration year
 *   └──────────────────── fixed platform prefix
 *
 * This file is the client side of one rule, not a second implementation of it.
 * It exists to catch a typo before a request goes out; the server validates
 * again and is the authority. It has to stay in step with
 * com.herbimmortal.verification.util.ImmortalId.
 *
 * WHAT CHANGED, AND WHAT IT COST
 *
 * The previous format was nine random Crockford base32 characters plus a Luhn
 * mod 32 check character. That check character could catch every single
 * character error in the browser, so a mistyped ID never reached the server and
 * the person got told which part was wrong. This format spends those characters
 * on meaning instead: four of them now say when, where and what system, which a
 * support agent can read off the page without a database.
 *
 * The price is real and worth stating plainly. Without a check character,
 * looksLikeImmortalId can only verify the shape. A typo inside the random
 * segment is indistinguishable from someone else's valid ID, so it goes to the
 * server and comes back "not currently verified" rather than "you mistyped
 * that". validateImmortalId below recovers part of that by checking the fixed
 * segments against real reference data, which is the only signal left.
 */

/** A-Z and 0-9. Not Crockford: I, L, O and U are all legal in this format. */
const SUFFIX_ALPHABET = /^[A-Z0-9]{5}$/

/** HI-YYCCM-RRRRR, anchored so a longer string is not a partial match. */
const SHAPE = /^HI-(\d{2})([A-Z]{2})([A-Z])-([A-Z0-9]{5})$/

/**
 * The pre-2026 format: nine Crockford characters plus a Luhn mod 32 check
 * character, grouped five and five.
 *
 * Still recognised because an Immortal ID is permanent (section 8.1). An ID
 * printed on a certificate before the format changed has to keep resolving,
 * even though nothing can issue another one. Postgres says the same thing a
 * different way: V9 adds the format CHECK as NOT VALID, which applies to new
 * writes and leaves existing rows alone.
 */
const LEGACY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const LEGACY_SHAPE = /^HI-[0-9A-Z]{5}-[0-9A-Z]{5}$/

export interface ImmortalIdParts {
  /** Full year, reconstructed from the two digits. */
  year: number
  countryCode: string
  medicalSystemCode: string
  suffix: string
}

/** Uppercases and drops surrounding space. Does not repair anything else. */
export function canonicalize(input: string): string {
  return input.trim().toUpperCase()
}

/**
 * Shape only. True for the current format, false for a legacy ID.
 *
 * Use this before writing an ID anywhere. Use looksLikeImmortalId to decide
 * whether a lookup is worth sending.
 */
export function isCurrentFormat(input: string): boolean {
  return SHAPE.test(canonicalize(input))
}

/** Luhn mod 32 over the Crockford alphabet. Reads legacy IDs, never writes one. */
function legacyCheckCharacter(payload: string): string {
  const base = LEGACY_ALPHABET.length
  let sum = 0
  let factor = 2

  for (let i = payload.length - 1; i >= 0; i -= 1) {
    const value = LEGACY_ALPHABET.indexOf(payload[i] as string)
    if (value < 0) return ''
    let addend = factor * value
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / base) + (addend % base)
    sum += addend
  }

  return LEGACY_ALPHABET.charAt((base - (sum % base)) % base)
}

/**
 * True for an ID issued under the old scheme, verified through its check
 * character rather than by shape.
 *
 * Shape alone would accept HI-26INA-K3M7Q as legacy, and then a typo in a
 * current ID could pass as a valid old one. The check character is the only
 * thing that separates the two formats, because both are HI-XXXXX-XXXXX.
 */
export function isLegacyFormat(input: string): boolean {
  const candidate = canonicalize(input)
  if (!LEGACY_SHAPE.test(candidate)) return false

  const body = candidate.slice(3).replace('-', '')
  if ([...body].some((char) => !LEGACY_ALPHABET.includes(char))) return false
  return legacyCheckCharacter(body.slice(0, 9)) === body.charAt(9)
}

/**
 * True for anything this system could have issued, either format.
 *
 * This is what the public lookup form checks. It is a load control, not a
 * security control: it stops a request that could never match, and nothing more.
 */
export function looksLikeImmortalId(input: string): boolean {
  return isCurrentFormat(input) || isLegacyFormat(input)
}

/**
 * Decodes the fixed segments.
 *
 * Null for a legacy ID, which carries none of them. That is a real difference
 * and callers have to see it rather than be handed a fabricated year.
 */
export function parseImmortalId(input: string): ImmortalIdParts | null {
  const match = SHAPE.exec(canonicalize(input))
  if (!match) return null

  return {
    year: 2000 + Number(match[1]),
    countryCode: match[2] as string,
    medicalSystemCode: match[3] as string,
    suffix: match[4] as string,
  }
}

/**
 * Builds an ID from its parts. Used by fixtures and by the landing page sample,
 * never to issue a real one: issuance is the server's job, because only the
 * server can check the value is free.
 */
export function buildImmortalId(
  year: number,
  countryCode: string,
  medicalSystemCode: string,
  suffix: string,
): string {
  const country = countryCode.trim().toUpperCase()
  const system = medicalSystemCode.trim().toUpperCase()
  const random = suffix.trim().toUpperCase()

  if (year < 2000 || year > 2099) {
    // Two digits cannot say which century, and guessing puts a wrong but
    // plausible year into a permanent identifier.
    throw new Error(`Year ${year} is outside the range two digits can express`)
  }
  if (!/^[A-Z]{2}$/.test(country)) throw new Error(`Country code must be two letters: ${countryCode}`)
  if (!/^[A-Z]$/.test(system)) throw new Error(`Medical system code must be one letter: ${medicalSystemCode}`)
  if (!SUFFIX_ALPHABET.test(random)) throw new Error(`Suffix must be five of A-Z or 0-9: ${suffix}`)

  return `HI-${String(year % 100).padStart(2, '0')}${country}${system}-${random}`
}

/**
 * The strongest check the browser can make, given there is no check character.
 *
 * Shape catches the obvious. Beyond that the only signal left is whether the
 * fixed segments name things that exist, so this takes the reference data the
 * page already loaded and uses it: a country code we do not hold a register for,
 * or a medical system that is not one of ours, cannot be an ID we issued. Both
 * lists are optional, and an unknown code is only rejected when the list is
 * actually loaded. Rejecting on an empty list would fail every ID while the
 * reference data was still in flight.
 *
 * Returns a message rather than a boolean so the form can say which part is
 * wrong, which is the closest this format gets to what the check character used
 * to do for free.
 */
export function validateImmortalId(
  input: string,
  reference?: { countryCodes?: readonly string[]; medicalSystemCodes?: readonly string[] },
): string | null {
  const candidate = canonicalize(input)
  if (!candidate) return 'Enter an Immortal ID.'

  if (isLegacyFormat(candidate)) return null

  const parts = parseImmortalId(candidate)
  if (!parts) {
    return 'That is not a valid Immortal ID. The format is HI-26INA-K3M7Q.'
  }

  const countries = reference?.countryCodes
  if (countries && countries.length > 0 && !countries.includes(parts.countryCode)) {
    return `We do not hold a register for country ${parts.countryCode}.`
  }

  const systems = reference?.medicalSystemCodes
  if (systems && systems.length > 0 && !systems.includes(parts.medicalSystemCode)) {
    return `${parts.medicalSystemCode} is not a medical system we issue IDs for.`
  }

  return null
}
