/**
 * Token storage, isolated behind a handful of functions so the strategy can
 * change without touching call sites.
 *
 * <h2>Where these live, and what that costs</h2>
 *
 * Both tokens are in sessionStorage. That is readable by any script running on
 * the page, so an XSS bug is a session compromise. The safer shape is an
 * httpOnly refresh cookie plus an access token held only in a JavaScript
 * variable, and this file is still where that change lands.
 *
 * It is not the shape here because it is not free: httpOnly cookies are sent
 * automatically by the browser, which reintroduces CSRF and means the server
 * needs a token check on every mutating request, plus SameSite handling for the
 * dev proxy. Recorded as a real gap rather than presented as a decision.
 *
 * sessionStorage over localStorage is the one part that is not a compromise:
 * it is scoped to the tab and cleared when the tab closes, so a shared or
 * public machine does not keep somebody signed in after they walk away.
 */
const ACCESS_TOKEN_KEY = 'hi.accessToken'
const REFRESH_TOKEN_KEY = 'hi.refreshToken'

export function getAccessToken(): string | null {
  return safeRead(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return safeRead(REFRESH_TOKEN_KEY)
}

/** Both together, always. A pair half written is a session that cannot refresh. */
export function setTokens(accessToken: string, refreshToken: string): void {
  try {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  } catch {
    // Storage can be unavailable: Safari private mode, a quota, a locked down
    // browser. The app still works for the life of the page, so failing to
    // persist is not worth breaking sign in over.
  }
}

export function clearTokens(): void {
  try {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  } catch {
    // Nothing to do. See above.
  }
}

function safeRead(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Kept as a named export because the old single-token API is still imported in
 * places, and a silent rename would leave those call sites writing a token
 * nothing ever reads back.
 */
export function setAccessToken(token: string): void {
  try {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token)
  } catch {
    // See setTokens.
  }
}

export const clearAccessToken = clearTokens
