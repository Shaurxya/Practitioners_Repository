/**
 * Access token storage, isolated behind four functions so the storage strategy
 * can change without touching call sites.
 *
 * Phase 8 decision, flagged now: sessionStorage is readable by any script on
 * the page, so an httpOnly refresh cookie plus an in memory access token is the
 * safer shape. This module is where that change lands.
 */
const ACCESS_TOKEN_KEY = 'hi.accessToken'

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessToken(token: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token)
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(ACCESS_TOKEN_KEY)
}
