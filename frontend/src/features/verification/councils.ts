/**
 * Mirrors the councils seed in V2__registry_records.sql.
 *
 * A select rather than free text, because a typed council name would need its
 * own normalization path on the way in and the alias table already carries
 * thirteen spellings of these four bodies.
 */
export const COUNCILS = [
  { value: 'MH', label: 'Maharashtra Council of Indian Medicine' },
  { value: 'KA', label: 'Karnataka Ayurvedic and Unani Practitioners Board' },
  { value: 'KL', label: 'Kerala State Medical Council (Indian Systems of Medicine)' },
  { value: 'GJ', label: 'Gujarat Board of Ayurvedic and Unani Systems of Medicine' },
] as const

export type CouncilCode = (typeof COUNCILS)[number]['value']

export function councilLabel(code: string): string {
  return COUNCILS.find((c) => c.value === code)?.label ?? code
}

/**
 * Client side mirror of the server's format check, kept deliberately lenient.
 *
 * The registry holds KA35652, kl42804, MH-28409, KL 16405 and GJ 14549, and
 * 10.3% of rows omit the council prefix entirely. So this only rejects input
 * that cannot be a registration number at all. The server stays the authority
 * and Normalizer does the real work: a stricter rule here would reject genuine
 * practitioners before their claim ever reaches it.
 */
const REGISTRATION_NUMBER = /^[A-Za-z]{0,2}[\s\-/]?\d{4,6}[A-Za-z]?$/

export function looksLikeRegistrationNumber(value: string): boolean {
  return REGISTRATION_NUMBER.test(value.trim())
}

export const SPECIALTIES = [
  'Kayachikitsa',
  'Panchakarma',
  'Rasashastra',
  'Shalya Tantra',
  'Prasuti Tantra',
  'Ayurveda',
  'Unani',
  'Other',
] as const
