/** Mirrors PublicVerificationResponse. Deliberately minimal, this is public. */
export interface PublicVerification {
  immortalId: string
  displayName: string
  status: 'VERIFIED' | 'NOT_VERIFIED' | 'EXPIRED' | 'REVOKED'
  verifiedAsOf: string
  registrySourceBatch: string
  council: string
}
