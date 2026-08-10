import type { Role } from '@/types/caseStatus'

export interface LoginRequest {
  email: string
  password: string
}

/**
 * No role field, and there must never be one.
 *
 * The server ignores anything of the sort, because binding a role from a public
 * request body turns a signup form into an admin factory. Leaving it out of the
 * type as well means nobody adds it here first and then wonders why it has no
 * effect.
 */
export interface RegisterRequest {
  email: string
  password: string
  fullName: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
  /**
   * The account, returned with the tokens.
   *
   * Saves a round trip that used to be mandatory: sign in, then immediately
   * fetch /me to find out where to send the person. The client seeds this
   * straight into the ['me'] cache instead.
   */
  user: CurrentUser
}

/** immortalId is null until the first approval. Never assume it is present. */
export interface CurrentUser {
  id: string
  email: string
  fullName: string
  role: Role
  immortalId: string | null
  /** SESSION for a browser, API_KEY for a machine. Screens differ on this. */
  authenticatedBy: 'SESSION' | 'API_KEY'
}

/** One live session, for the account page. */
export interface SessionSummary {
  id: string
  issuedAt: string
  expiresAt: string
  userAgent: string | null
  ipAddress: string | null
}

export interface ApiKeySummary {
  id: string
  name: string
  /** The non secret handle. Never a prefix of the real key. */
  prefix: string
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
  /** Written at most once every few minutes, so "recently used", not "last used". */
  lastUsedAt: string | null
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
}

/**
 * The create response, and the only time the key itself exists client side.
 * There is nothing stored server side that could produce it again.
 */
export interface ApiKeyCreated extends ApiKeySummary {
  key: string
  warning: string
}
