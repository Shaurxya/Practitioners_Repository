/**
 * Mirrors PublicVerificationResponse. Deliberately minimal, this is public.
 *
 * Every field is present on an unverified answer too, as an empty string. An
 * unknown ID and an unverified one have to be indistinguishable, and a field
 * that appeared only on the verified branch would leak existence through the
 * response shape rather than its values.
 */
export interface PublicVerification {
  immortalId: string
  displayName: string
  status: 'VERIFIED' | 'NOT_VERIFIED' | 'EXPIRED' | 'REVOKED'
  verifiedAsOf: string
  registrySourceBatch: string
  council: string
  /** Read from the record, never decoded from the ID the caller supplied. */
  country: string
  countryCode: string
  medicalSystem: string
}
