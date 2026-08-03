/**
 * Immortal ID format and check character.
 *
 * HI-XXXXX-XXXXX: nine random Crockford base32 characters plus one check
 * character, grouped five and five so it reads aloud in two chunks like an
 * airline record locator.
 *
 * Nine random characters is 45 bits, about 3.5e13. The rejected six character
 * form was 32^6, roughly 1.07 billion, which a scraper at a thousand requests a
 * second walks a meaningful fraction of. At 45 bits enumeration is off the
 * table and the rate limiter goes back to being a second line of defence rather
 * than the only one.
 *
 * The check character is Luhn mod 32 over the standard Crockford alphabet, not
 * Crockford's own mod 37 check symbol, whose alphabet includes * ~ $ = and U.
 * Those read as corruption on a printed certificate. Luhn mod 32 catches every
 * single character error and almost every adjacent transposition while keeping
 * the ID in one clean character set.
 *
 * This file must stay in step with the Java generator. It is the client side of
 * one rule, not a second implementation of it: the server validates again.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const BASE = ALPHABET.length

/**
 * Crockford decoding is case insensitive and forgiving of the characters people
 * actually mistype: I and L read as 1, O reads as 0.
 */
export function normalizeCrockford(input: string): string {
  return input
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
}

function valueOf(char: string): number {
  return ALPHABET.indexOf(char)
}

/** Luhn mod N over the Crockford alphabet. Payload is the nine random chars. */
export function checkCharacter(payload: string): string {
  let sum = 0
  let factor = 2

  for (let i = payload.length - 1; i >= 0; i -= 1) {
    const char = payload[i]
    if (char === undefined) continue
    const value = valueOf(char)
    if (value < 0) throw new Error(`Character outside the Crockford alphabet: ${char}`)

    let addend = factor * value
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / BASE) + (addend % BASE)
    sum += addend
  }

  const remainder = sum % BASE
  const checkValue = (BASE - remainder) % BASE
  return ALPHABET.charAt(checkValue)
}

const SHAPE = /^HI-[0-9A-Z]{5}-[0-9A-Z]{5}$/

/**
 * Full validation: shape, alphabet, and check character. Runs before any
 * request so a malformed ID never reaches the database.
 */
export function looksLikeImmortalId(input: string): boolean {
  // Uppercase only at this point. Crockford decoding must NOT touch the literal
  // "HI-" prefix, because it maps I to 1 and would turn every ID into "H1-".
  const candidate = input.trim().toUpperCase()
  if (!SHAPE.test(candidate)) return false

  const body = normalizeCrockford(candidate.slice(3).replace('-', ''))
  if (body.length !== 10) return false
  if ([...body].some((char) => valueOf(char) < 0)) return false

  const payload = body.slice(0, 9)
  const check = body.charAt(9)
  return checkCharacter(payload) === check
}

/** Formats a raw ten character body into display form. */
export function formatImmortalId(body: string): string {
  const clean = normalizeCrockford(body).replace(/-/g, '')
  return `HI-${clean.slice(0, 5)}-${clean.slice(5, 10)}`
}

/** Builds a valid ID from nine payload characters, appending the check char. */
export function buildImmortalId(payload: string): string {
  if (payload.length !== 9) throw new Error('Payload must be nine characters')
  const normalized = normalizeCrockford(payload)
  return formatImmortalId(normalized + checkCharacter(normalized))
}
