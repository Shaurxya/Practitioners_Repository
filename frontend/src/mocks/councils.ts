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
}

export const COUNCILS: CouncilRow[] = [
  { code: 'AN', canonicalName: 'Andaman and Nicobar Islands' },
  { code: 'AP', canonicalName: 'Andhra Pradesh' },
  { code: 'AR', canonicalName: 'Arunachal Pradesh' },
  { code: 'AS', canonicalName: 'Assam' },
  { code: 'BR', canonicalName: 'Bihar' },
  { code: 'CH', canonicalName: 'Chandigarh' },
  { code: 'CT', canonicalName: 'Chhattisgarh' },
  { code: 'DH', canonicalName: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: 'DL', canonicalName: 'Delhi' },
  { code: 'GA', canonicalName: 'Goa Board of Indian System of Medicine and Homoeopathy' },
  { code: 'GJ', canonicalName: 'Gujarat Board of Ayurvedic and Unani Systems of Medicine' },
  { code: 'HR', canonicalName: 'Haryana' },
  { code: 'HP', canonicalName: 'Himachal Pradesh' },
  { code: 'JK', canonicalName: 'Jammu and Kashmir' },
  { code: 'JH', canonicalName: 'Jharkhand' },
  { code: 'KA', canonicalName: 'Karnataka Ayurvedic and Unani Practitioners Board' },
  { code: 'KL', canonicalName: 'Kerala State Medical Council (Indian Systems of Medicine)' },
  { code: 'LA', canonicalName: 'Ladakh' },
  { code: 'LD', canonicalName: 'Lakshadweep' },
  { code: 'MP', canonicalName: 'Madhya Pradesh' },
  { code: 'MH', canonicalName: 'Maharashtra Council of Indian Medicine' },
  { code: 'MN', canonicalName: 'Manipur' },
  { code: 'ML', canonicalName: 'Meghalaya' },
  { code: 'MZ', canonicalName: 'Mizoram' },
  { code: 'NL', canonicalName: 'Nagaland' },
  { code: 'OR', canonicalName: 'Odisha' },
  { code: 'PY', canonicalName: 'Puducherry' },
  { code: 'PB', canonicalName: 'Punjab' },
  { code: 'RJ', canonicalName: 'Rajasthan' },
  { code: 'SK', canonicalName: 'Sikkim' },
  { code: 'TN', canonicalName: 'Tamil Nadu' },
  { code: 'TG', canonicalName: 'Telangana' },
  { code: 'TR', canonicalName: 'Tripura' },
  { code: 'UP', canonicalName: 'Uttar Pradesh' },
  { code: 'UT', canonicalName: 'Uttarakhand' },
  { code: 'WB', canonicalName: 'West Bengal' },
]

export function councilName(code: string): string {
  return COUNCILS.find((c) => c.code === code)?.canonicalName ?? code
}
