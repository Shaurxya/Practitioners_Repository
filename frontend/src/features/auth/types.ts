import type { Role } from '@/types/caseStatus'

export interface LoginRequest {
  email: string
  password: string
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
}

/** immortalId is null until the first approval. Never assume it is present. */
export interface CurrentUser {
  id: string
  email: string
  fullName: string
  role: Role
  immortalId: string | null
}
