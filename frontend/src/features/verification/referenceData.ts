import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/apiClient'

/**
 * Country and medical system, the two lists that feed the Immortal ID.
 *
 * Fetched, never hardcoded, and the reason is on the record in this codebase.
 * The claim form once shipped a copy of four councils and went on offering four
 * for weeks after a migration seeded thirty six, so a practitioner registered in
 * Goa could not describe themselves at all. Nothing in the client was wrong. It
 * was just old.
 *
 * These two are worse candidates for that mistake than councils were. A stale
 * council list blocks a form; a stale medical system list puts the wrong
 * character into an identifier that is issued once and never changes.
 */

export interface Country {
  /** ISO 3166-1 alpha-2. The CC segment of an Immortal ID, verbatim. */
  code: string
  name: string
}

export interface MedicalSystem {
  /** The single character M segment: A, S, U, Y, T. */
  code: string
  name: string
}

export function fetchCountries(): Promise<Country[]> {
  return apiRequest<Country[]>('/api/v1/countries')
}

export function fetchMedicalSystems(): Promise<MedicalSystem[]> {
  return apiRequest<MedicalSystem[]>('/api/v1/medical-systems')
}

/** Reference data. Changes at the rate of migrations, so cached for the session. */
export function useCountries() {
  return useQuery({
    queryKey: ['countries'],
    queryFn: fetchCountries,
    staleTime: Infinity,
  })
}

export function useMedicalSystems() {
  return useQuery({
    queryKey: ['medical-systems'],
    queryFn: fetchMedicalSystems,
    staleTime: Infinity,
  })
}

export function countryOptions(countries: Country[] | undefined) {
  return (countries ?? []).map((c) => ({ value: c.code, label: c.name }))
}

/**
 * Server order, not alphabetical. The server sorts by an explicit sort_order
 * column so Ayurveda, which is the overwhelming majority of this register,
 * leads the list instead of sitting between Traditional Chinese Medicine and
 * Unani. Re-sorting here would throw that away.
 */
export function medicalSystemOptions(systems: MedicalSystem[] | undefined) {
  return (systems ?? []).map((s) => ({ value: s.code, label: s.name }))
}

/**
 * Falls back to the raw code rather than rendering nothing.
 *
 * An Immortal ID issued years ago has to stay readable even if that country or
 * system was later disabled, and the code is the one part of it that never
 * changes. A blank here would make a verified practitioner's own ID look broken.
 */
export function countryName(code: string, countries: Country[] | undefined): string {
  return countries?.find((c) => c.code === code)?.name ?? code
}

export function medicalSystemName(code: string, systems: MedicalSystem[] | undefined): string {
  return systems?.find((s) => s.code === code)?.name ?? code
}
