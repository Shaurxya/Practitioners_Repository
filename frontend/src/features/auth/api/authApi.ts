import { apiRequest } from '@/lib/apiClient'
import { clearTokens, getRefreshToken, setTokens } from '@/lib/authToken'
import type {
  ApiKeyCreated,
  ApiKeySummary,
  AuthResponse,
  CurrentUser,
  LoginRequest,
  RegisterRequest,
  SessionSummary,
} from '../types'

export function login(body: LoginRequest): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function register(body: RegisterRequest): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>('/api/v1/me')
}

/**
 * Tells the server to forget the refresh token, then forgets it locally.
 *
 * The server call is what makes signing out mean anything: without it the
 * refresh token stays valid for thirty days and anyone holding a copy can keep
 * minting access tokens. Clearing local storage alone only hides the session
 * from this browser.
 *
 * The local clear runs regardless of whether the call succeeded. Someone who
 * pressed sign out is signed out of this browser even if the network is down.
 */
export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken()
  try {
    if (refreshToken) {
      await apiRequest<void>('/api/v1/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      })
    }
  } finally {
    clearTokens()
  }
}

export function logoutEverywhere(): Promise<{ sessionsEnded: number }> {
  return apiRequest('/api/v1/auth/logout-all', { method: 'POST' })
}

export function fetchSessions(): Promise<SessionSummary[]> {
  return apiRequest<SessionSummary[]>('/api/v1/me/sessions')
}

export function fetchApiKeys(): Promise<ApiKeySummary[]> {
  return apiRequest<ApiKeySummary[]>('/api/v1/me/api-keys')
}

export function createApiKey(body: { name: string; expiresInDays?: number }): Promise<ApiKeyCreated> {
  return apiRequest<ApiKeyCreated>('/api/v1/me/api-keys', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function revokeApiKey(keyId: string): Promise<void> {
  return apiRequest<void>(`/api/v1/me/api-keys/${keyId}`, { method: 'DELETE' })
}

/** Stores the pair from a sign in or sign up. One place, so neither is ever written alone. */
export function acceptSession(auth: AuthResponse): void {
  setTokens(auth.accessToken, auth.refreshToken)
}
