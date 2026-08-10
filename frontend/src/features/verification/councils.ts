import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/apiClient'

/**
 * The councils this registry holds, fetched from the server.
 *
 * It used to be a hardcoded array of the four bodies V2 seeded. That was a
 * second copy of data the database owns, and it broke exactly the way second
 * copies do: a migration seeded thirty six councils and this form went on
 * offering four, so a practitioner registered in Goa could not describe
 * themselves at all. The failure was invisible from the code, because nothing
 * here was wrong, it was just old.
 *
 * V2's own comment gives the rule: councils are a table rather than a constant
 * so that adding one is a migration and not a redeploy. A hardcoded client list
 * takes that back.
 *
 * Deliberately not the type from features/registry-import: that module is admin
 * only and carries extraction internals no practitioner facing view may touch.
 * Two small declarations of the same shape is the cheaper mistake.
 */
export interface Council {
  code: string
  canonicalName: string
  /**
   * The country this body registers in, and the authority for the CC segment of
   * an Immortal ID. Served rather than inferred, so a council in a second
   * country is a migration and not a client change.
   */
  countryCode: string
}

export function fetchCouncils(): Promise<Council[]> {
  return apiRequest<Council[]>('/api/v1/councils')
}

/** Reference data. Changes at the rate of migrations, so cached for the session. */
export function useCouncils() {
  return useQuery({
    queryKey: ['councils', 'public'],
    queryFn: fetchCouncils,
    staleTime: Infinity,
  })
}

/**
 * Select options, sorted by the name a person reads rather than by code.
 *
 * Narrowed to one country when given one. The claim form asks for a country
 * first so the council list is a page of plausible answers rather than every
 * body in every register, but the narrowing is a convenience: the server checks
 * the council against the country regardless, because the council is the
 * authority and the browser is not.
 */
export function councilOptions(councils: Council[] | undefined, countryCode?: string) {
  return (councils ?? [])
    .filter((c) => !countryCode || c.countryCode === countryCode)
    .map((c) => ({ value: c.code, label: c.canonicalName }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** The country a council registers in, or undefined while the list is loading. */
export function councilCountry(code: string, councils: Council[] | undefined) {
  return councils?.find((c) => c.code === code)?.countryCode
}

/**
 * Falls back to the raw code rather than rendering nothing. A case submitted
 * against a council that was later renamed still has to be readable, and the
 * code is the one part of it that never changes.
 */
export function councilLabel(code: string, councils: Council[] | undefined): string {
  return councils?.find((c) => c.code === code)?.canonicalName ?? code
}

/**
 * Client side mirror of the server's format check, kept deliberately lenient.
 *
 * Every council numbers its register differently, so this cannot be a shape.
 * The registry already holds KA35652, kl42804, MH-28409, KL 16405, GJ 14549,
 * NR/AY/GA/0000001, and 10.3% of rows omit the council prefix entirely.
 *
 * The previous rule was `^[A-Za-z]{0,2}[\s\-/]?\d{4,6}[A-Za-z]?$`, which allowed
 * at most two leading letters and six digits. It rejected the NCISM national
 * format outright: three letter groups and seven digits. A practitioner holding
 * NR/AY/GA/0000001 was told their own registration number was not one, by a
 * check that exists only to catch someone typing their name in the wrong box.
 *
 * So the rule is now about content, not shape: strip everything that is not
 * alphanumeric, then require enough digits to be an identifier at all. The
 * server stays the authority and Normalizer does the real work. A stricter rule
 * here rejects genuine practitioners before their claim ever reaches it, and
 * that failure is invisible to us: they simply give up.
 */
export function looksLikeRegistrationNumber(value: string): boolean {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '')
  if (cleaned.length < 4 || cleaned.length > 32) return false
  return (cleaned.match(/\d/g) ?? []).length >= 4
}

/**
 * Branches within a system of medicine, not systems themselves.
 *
 * "Ayurveda" and "Unani" used to sit in this list. They are gone because they
 * are now the answer to a different question: the system of medicine is its own
 * field, it is one of five, and it is written permanently into the Immortal ID
 * as the M segment. Leaving them here would have offered the same fact in two
 * places on one form with no way to reconcile a contradiction, and only one of
 * the two would have reached the identifier.
 *
 * Kayachikitsa, Panchakarma, Rasashastra, Shalya Tantra and Prasuti Tantra are
 * all Ayurvedic branches. Siddha, Yoga and Traditional Chinese Medicine
 * practitioners answer "Other" until this list is written for their systems too.
 */
export const SPECIALTIES = [
  'Kayachikitsa',
  'Panchakarma',
  'Rasashastra',
  'Shalya Tantra',
  'Prasuti Tantra',
  'Other',
] as const
