/**
 * The verification pipeline, mocked: normalize, match, run rules, decide.
 *
 * This exists because a claim used to be created in SUBMITTED and then nothing
 * ever moved it. The portal sat on "Checking your details" forever, which is
 * the worst failure state available to us: it looks like the system is working.
 *
 * Deliberately a faithful model of the design contract rather than a shortcut,
 * because the shape is the part worth proving before it is written in Java:
 *
 *   sections 5.1 normalization, 5.2 matching, 5.3 decision, 6 rule catalog,
 *   8.2 Immortal ID format.
 *
 * Deletes with the rest of mocks/ when the Spring services land.
 */

/** One promoted registry row. The live registry, as far as the portal is concerned. */
export interface RegistryRow {
  councilCode: string
  licenceRaw: string
  licenceKeys: string[]
  fullNameRaw: string
  fullNameNormalized: string
  /** ACTIVE, SUSPENDED, REVOKED, EXPIRED, INACTIVE, UNKNOWN. */
  status: string
  /** ISO date, or null when the register publishes no expiry at all. */
  validUntil: string | null
  specialty: string | null
  sourceBatch: string
}

let registry: RegistryRow[] = []

export function resetRegistry() {
  registry = []
}

export function registrySize() {
  return registry.length
}

export function addRegistryRows(rows: RegistryRow[]) {
  registry = [...registry, ...rows]
}

/**
 * The live registry, for the admin registry browser.
 *
 * Filtered server side, always. The console must never receive the whole
 * register and narrow it in the browser: at 100k rows that is a several
 * megabyte response, and it means the count shown next to a filter describes
 * the page rather than the register.
 */
export function queryRegistry(options: {
  q?: string
  council?: string
  status?: string
  page?: number
  size?: number
}) {
  const q = (options.q ?? '').trim().toUpperCase()
  const page = options.page ?? 0
  const size = options.size ?? 50

  let rows = registry
  if (options.council) rows = rows.filter((r) => r.councilCode === options.council)
  if (options.status) rows = rows.filter((r) => r.status === options.status)
  if (q) {
    const keys = q.replace(/[^A-Z0-9]/g, '')
    rows = rows.filter(
      (r) =>
        r.fullNameNormalized.includes(q) ||
        r.licenceRaw.toUpperCase().includes(q) ||
        (keys.length > 0 && r.licenceKeys.some((k) => k.includes(keys))),
    )
  }

  // Council then licence, which is the natural key. Any other default ordering
  // makes two runs of the same filter return rows in different places.
  const sorted = [...rows].sort(
    (a, b) =>
      a.councilCode.localeCompare(b.councilCode) || a.licenceRaw.localeCompare(b.licenceRaw),
  )

  return {
    content: sorted.slice(page * size, page * size + size),
    totalElements: sorted.length,
    totalPages: Math.max(1, Math.ceil(sorted.length / size)),
    number: page,
    size,
  }
}

/** Batch level summary, computed rather than counted in the browser. */
export function registrySummary() {
  const councils = new Set(registry.map((r) => r.councilCode))
  const batches = new Set(registry.map((r) => r.sourceBatch))
  const byStatus: Record<string, number> = {}
  for (const row of registry) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1

  return {
    totalRows: registry.length,
    councils: [...councils].sort(),
    batches: [...batches].sort(),
    byStatus,
  }
}

// ---------------------------------------------------------------------------
// 5.1 Normalization
//
// Applied identically to the claim and to the registry row, in one place. Two
// implementations that drift is the bug this shape exists to prevent: when they
// disagree nothing matches and there is no error anywhere to say why.
// ---------------------------------------------------------------------------

const TITLES = /\b(DR|DOCTOR|PROF|PROFESSOR|SHRI|SMT|MR|MRS|MS|VAIDYA|HAKIM)\b\.?/g

export function normalizeName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(TITLES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Every form of a licence number that should be considered the same one.
 *
 * The registry holds MH-28409, KA35652, kl42804 and NR/AY/GA/0000001, and 10.3%
 * of rows omit the council prefix entirely, so 'MH4471' and '4471' on a
 * Maharashtra row have to land on the same value or one exact match in ten
 * fails for no visible reason. Rather than pick a single canonical form and
 * hope, each side contributes every form it could be written in and a match is
 * any overlap within the same council.
 */
export function licenceKeys(raw: string, councilCode: string): string[] {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const council = councilCode.toUpperCase()
  const keys = new Set<string>([cleaned])

  if (cleaned.startsWith(council)) keys.add(cleaned.slice(council.length))
  else keys.add(`${council}${cleaned}`)

  // The digits alone, which is what an unprefixed row reduces to. Only when
  // there are enough of them to be an identifier rather than a coincidence.
  const digits = cleaned.replace(/[^0-9]/g, '')
  if (digits.length >= 5) keys.add(digits)

  return [...keys].filter(Boolean)
}

// ---------------------------------------------------------------------------
// Name similarity, for NAME_MATCH
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i < rows; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length] ?? 0
}

/**
 * Token set similarity first, edit distance second, and the better of the two.
 *
 * Registers reorder names constantly: "PRABHUDESSAI VINAYAK" against "VINAYAK
 * PRABHUDESSAI" is the same person and scores 0.36 on raw edit distance. Token
 * comparison catches that; edit distance catches the single mistyped character
 * that token comparison scores as a total miss.
 */
export function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1

  const tokensA = new Set(a.split(' ').filter(Boolean))
  const tokensB = new Set(b.split(' ').filter(Boolean))
  const shared = [...tokensA].filter((t) => tokensB.has(t)).length
  const union = new Set([...tokensA, ...tokensB]).size
  const tokenScore = union === 0 ? 0 : shared / union

  const longest = Math.max(a.length, b.length)
  const editScore = longest === 0 ? 0 : 1 - levenshtein(a, b) / longest

  return Math.max(tokenScore, editScore)
}

// ---------------------------------------------------------------------------
// 5.2 Matching
// ---------------------------------------------------------------------------

export interface MatchCandidate {
  row: RegistryRow
  nameScore: number
  matchedOn: 'EXACT_LICENSE' | 'FUZZY_NAME'
}

/**
 * Returns a list, never an Optional. Duplicates and ambiguity are real, and the
 * review console has to show every one of them side by side.
 */
export function matchClaim(claim: {
  fullName: string
  registrationNumber: string
  council: string
}): MatchCandidate[] {
  const keys = new Set(licenceKeys(claim.registrationNumber, claim.council))
  const claimedName = normalizeName(claim.fullName)

  return registry
    .filter((row) => row.councilCode === claim.council.toUpperCase())
    .filter((row) => row.licenceKeys.some((key) => keys.has(key)))
    .map((row) => ({
      row,
      nameScore: nameSimilarity(claimedName, row.fullNameNormalized),
      matchedOn: 'EXACT_LICENSE' as const,
    }))
}

// ---------------------------------------------------------------------------
// 6 Rule catalog
// ---------------------------------------------------------------------------

export type RuleOutcome = 'PASS' | 'REVIEW' | 'FAIL' | 'SKIPPED'

export interface RuleResult {
  ruleCode: string
  outcome: RuleOutcome
  detail: string
}

/** Rules whose SKIPPED is promoted to REVIEW, per decision rule 4. */
const REQUIRED = new Set(['LICENSE_ACTIVE', 'NOT_EXPIRED', 'NOT_SANCTIONED', 'NAME_MATCH', 'SINGLE_CANDIDATE'])

const GRACE_DAYS = 30

export function evaluate(candidates: MatchCandidate[], now = new Date()): RuleResult[] {
  const best = candidates[0]
  const results: RuleResult[] = []

  if (!best) return results

  const row = best.row

  // LICENSE_ACTIVE. UNKNOWN routes to a person rather than failing: some
  // registers publish no standing status at all, and failing them would reject
  // every practitioner in one on a fact the document never asserted.
  results.push(
    row.status === 'ACTIVE'
      ? { ruleCode: 'LICENSE_ACTIVE', outcome: 'PASS', detail: 'registry status ACTIVE' }
      : row.status === 'UNKNOWN'
        ? {
            ruleCode: 'LICENSE_ACTIVE',
            outcome: 'REVIEW',
            detail: 'this register publishes no standing status, so good standing cannot be read',
          }
        : {
            ruleCode: 'LICENSE_ACTIVE',
            outcome: 'FAIL',
            detail: `registry status ${row.status}, expected ACTIVE`,
          },
  )

  // NOT_EXPIRED, with the 30 day grace window from D3.
  if (!row.validUntil) {
    results.push({
      ruleCode: 'NOT_EXPIRED',
      outcome: 'SKIPPED',
      detail: 'this register publishes no expiry date',
    })
  } else {
    const validUntil = new Date(row.validUntil)
    const days = Math.floor((validUntil.getTime() - now.getTime()) / 86_400_000)
    results.push(
      days >= 0
        ? { ruleCode: 'NOT_EXPIRED', outcome: 'PASS', detail: `valid until ${row.validUntil}` }
        : days >= -GRACE_DAYS
          ? {
              ruleCode: 'NOT_EXPIRED',
              outcome: 'REVIEW',
              detail: `expired ${-days} days ago, inside the ${GRACE_DAYS} day grace window`,
            }
          : {
              ruleCode: 'NOT_EXPIRED',
              outcome: 'FAIL',
              detail: `valid_until ${row.validUntil} is ${-days} days past`,
            },
    )
  }

  results.push(
    row.status === 'SUSPENDED' || row.status === 'REVOKED'
      ? { ruleCode: 'NOT_SANCTIONED', outcome: 'FAIL', detail: `registry status ${row.status}` }
      : { ruleCode: 'NOT_SANCTIONED', outcome: 'PASS', detail: 'no sanction recorded' },
  )

  const score = best.nameScore
  results.push(
    score >= 0.9
      ? { ruleCode: 'NAME_MATCH', outcome: 'PASS', detail: `similarity ${score.toFixed(2)}` }
      : score >= 0.75
        ? { ruleCode: 'NAME_MATCH', outcome: 'REVIEW', detail: `similarity ${score.toFixed(2)}` }
        : { ruleCode: 'NAME_MATCH', outcome: 'FAIL', detail: `similarity ${score.toFixed(2)}` },
  )

  results.push(
    candidates.length === 1
      ? { ruleCode: 'SINGLE_CANDIDATE', outcome: 'PASS', detail: '1 candidate matched' }
      : { ruleCode: 'SINGLE_CANDIDATE', outcome: 'REVIEW', detail: `${candidates.length} candidates matched` },
  )

  // Not required until OCR ships, so its SKIPPED is ignored by the engine.
  results.push({ ruleCode: 'DOC_CONSISTENT', outcome: 'SKIPPED', detail: 'no OCR available' })

  return results
}

// ---------------------------------------------------------------------------
// 5.3 Decision. Deterministic and order independent.
// ---------------------------------------------------------------------------

export type Decision = 'APPROVED' | 'MANUAL_REVIEW' | 'REJECTED' | 'NO_MATCH'

export function decide(candidates: MatchCandidate[], results: RuleResult[]): Decision {
  // Zero candidates is decided by the matching stage, not by a rule. A human
  // closes it. Always.
  if (candidates.length === 0) return 'NO_MATCH'

  const effective = results.map((r) =>
    r.outcome === 'SKIPPED' && REQUIRED.has(r.ruleCode) ? { ...r, outcome: 'REVIEW' as const } : r,
  )

  if (effective.some((r) => r.outcome === 'FAIL')) return 'REJECTED'
  if (effective.some((r) => r.outcome === 'REVIEW')) return 'MANUAL_REVIEW'
  return 'APPROVED'
}

// ---------------------------------------------------------------------------
// 8.2 Immortal ID
//
// HI-XXXXX-XXXXX: 9 random Crockford base32 characters plus a Luhn mod 32 check
// character, grouped 5 and 5 so it reads aloud in two chunks.
// ---------------------------------------------------------------------------

/** No I, L, O or U, so the classic transcription errors cannot occur. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function luhnMod32(input: string): string {
  const n = CROCKFORD.length
  let factor = 2
  let sum = 0

  for (let i = input.length - 1; i >= 0; i--) {
    const codePoint = CROCKFORD.indexOf(input[i] as string)
    let addend = factor * codePoint
    factor = factor === 2 ? 1 : 2
    addend = Math.floor(addend / n) + (addend % n)
    sum += addend
  }

  return CROCKFORD[(n - (sum % n)) % n] as string
}

export function issueImmortalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  const body = [...bytes].map((b) => CROCKFORD[b % CROCKFORD.length]).join('')
  const full = body + luhnMod32(body)
  return `HI-${full.slice(0, 5)}-${full.slice(5)}`
}

/** The client validates this before a request is sent. */
export function isValidImmortalId(id: string): boolean {
  const compact = id.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (!compact.startsWith('HI') || compact.length !== 12) return false
  const payload = compact.slice(2)
  if ([...payload].some((c) => !CROCKFORD.includes(c))) return false
  return luhnMod32(payload.slice(0, 9)) === payload[9]
}
