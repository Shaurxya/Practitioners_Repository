import { apiRequest } from '@/lib/apiClient'
import type { AuthResponse, CurrentUser, LoginRequest } from '../types'

export function login(body: LoginRequest): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function fetchCurrentUser(): Promise<CurrentUser> {
  return apiRequest<CurrentUser>('/api/v1/me')
}
