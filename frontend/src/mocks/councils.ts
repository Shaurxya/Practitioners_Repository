/**
 * The councils table, mirroring the seeds in V2 and V4.
 *
 * Its own module because councils are shared reference data, not an import
 * fixture: the admin upload screen, the practitioner claim form and the case
 * list all read the same list, and the last time this lived in one feature's
 * fixtures a second hardcoded copy in the practitioner form silently kept
 * showing four councils after the migration seeded thirty six.
 *
 * Codes are ISO 3166-2:IN, which is also what NCISM embeds in its national
 * registration numbers: NR/AY/GA/0000001 is Goa.
 *
 * Five carry a board name verified against that state's own register. The rest
 * carry the state name until their first register says what the board is
 * called, because an invented board title is worse than a plain state name when
 * someone is using it to confirm they picked the right one.
 */
export interface CouncilRow {
  code: string
  canonicalName: string
  /** V9. Every seeded council is Indian, so this is 'IN' for all of them today. */
  countryCode: string
}

const IN = 'IN'

export const COUNCILS: CouncilRow[] = [
  { code: 'AN', canonicalName: 'Andaman and Nicobar Islands', countryCode: IN },
  { code: 'AP', canonicalName: 'Andhra Pradesh', countryCode: IN },
  { code: 'AR', canonicalName: 'Arunachal Pradesh', countryCode: IN },
  { code: 'AS', canonicalName: 'Assam', countryCode: IN },
  { code: 'BR', canonicalName: 'Bihar', countryCode: IN },
  { code: 'CH', canonicalName: 'Chandigarh', countryCode: IN },
  { code: 'CT', canonicalName: 'Chhattisgarh', countryCode: IN },
  { code: 'DH', canonicalName: 'Dadra and Nagar Haveli and Daman and Diu', countryCode: IN },
  { code: 'DL', canonicalName: 'Delhi', countryCode: IN },
  { code: 'GA', canonicalName: 'Goa Board of Indian System of Medicine and Homoeopathy', countryCode: IN },
  { code: 'GJ', canonicalName: 'Gujarat Board of Ayurvedic and Unani Systems of Medicine', countryCode: IN },
  { code: 'HR', canonicalName: 'Haryana', countryCode: IN },
  { code: 'HP', canonicalName: 'Himachal Pradesh', countryCode: IN },
  { code: 'JK', canonicalName: 'Jammu and Kashmir', countryCode: IN },
  { code: 'JH', canonicalName: 'Jharkhand', countryCode: IN },
  { code: 'KA', canonicalName: 'Karnataka Ayurvedic and Unani Practitioners Board', countryCode: IN },
  { code: 'KL', canonicalName: 'Kerala State Medical Council (Indian Systems of Medicine)', countryCode: IN },
  { code: 'LA', canonicalName: 'Ladakh', countryCode: IN },
  { code: 'LD', canonicalName: 'Lakshadweep', countryCode: IN },
  { code: 'MP', canonicalName: 'Madhya Pradesh', countryCode: IN },
  { code: 'MH', canonicalName: 'Maharashtra Council of Indian Medicine', countryCode: IN },
  { code: 'MN', canonicalName: 'Manipur', countryCode: IN },
  { code: 'ML', canonicalName: 'Meghalaya', countryCode: IN },
  { code: 'MZ', canonicalName: 'Mizoram', countryCode: IN },
  { code: 'NL', canonicalName: 'Nagaland', countryCode: IN },
  { code: 'OR', canonicalName: 'Odisha', countryCode: IN },
  { code: 'PY', canonicalName: 'Puducherry', countryCode: IN },
  { code: 'PB', canonicalName: 'Punjab', countryCode: IN },
  { code: 'RJ', canonicalName: 'Rajasthan', countryCode: IN },
  { code: 'SK', canonicalName: 'Sikkim', countryCode: IN },
  { code: 'TN', canonicalName: 'Tamil Nadu', countryCode: IN },
  { code: 'TG', canonicalName: 'Telangana', countryCode: IN },
  { code: 'TR', canonicalName: 'Tripura', countryCode: IN },
  { code: 'UP', canonicalName: 'Uttar Pradesh', countryCode: IN },
  { code: 'UT', canonicalName: 'Uttarakhand', countryCode: IN },
  { code: 'WB', canonicalName: 'West Bengal', countryCode: IN },
]

export function councilName(code: string): string {
  return COUNCILS.find((c) => c.code === code)?.canonicalName ?? code
}

export function councilCountry(code: string): string {
  return COUNCILS.find((c) => c.code === code)?.countryCode ?? IN
}

/**
 * Mirrors the countries table seeded by V9. ISO 3166-1 alpha-2, and the code is
 * the CC segment of an Immortal ID verbatim.
 */
export const COUNTRIES = [
  { code: 'AU', name: 'Australia' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'NP', name: 'Nepal' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
] as const

/**
 * Mirrors medical_systems. In sort_order, not alphabetical: Ayurveda leads the
 * list it dominates rather than sitting between TCM and Unani.
 */
export const MEDICAL_SYSTEMS = [
  { code: 'A', name: 'Ayurveda' },
  { code: 'S', name: 'Siddha' },
  { code: 'U', name: 'Unani' },
  { code: 'Y', name: 'Yoga' },
  { code: 'T', name: 'Traditional Chinese Medicine' },
] as const
