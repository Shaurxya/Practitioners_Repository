/**
 * The only place that talks to the network. Every feature api/ module calls
 * this, so auth headers, base url, error shape and token refresh are defined
 * once.
 */
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/lib/authToken'
import type { ApiError } from '@/types/api'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message)
    this.name = 'ApiRequestError'
  }
}

/**
 * Endpoints that must never trigger a refresh attempt.
 *
 * A 401 from the refresh endpoint means the session is genuinely over.
 * Refreshing in response to it would call itself, fail, and call itself again.
 */
const NO_REFRESH = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v1/auth/refresh']

/**
 * The in flight refresh, shared by every caller that needs one.
 *
 * This single variable is the whole reason a page with six queries on it does
 * not fire six refreshes the moment the access token expires. Six parallel
 * requests all get 401 within milliseconds of each other; without this they
 * would each start their own rotation, and since rotation invalidates the token
 * it consumed, five of the six would present an already rotated token. The
 * server treats that as theft and revokes every session, so the user is thrown
 * out precisely because their session was working normally.
 *
 * Instead the first 401 starts a refresh and the rest await the same promise.
 */
let refreshInFlight: Promise<boolean> | null = null

/** Set by the app so a dead session lands on the sign in page rather than a wall of errors. */
let onSessionExpired: (() => void) | null = null

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler
}

async function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  const response = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  })

  if (!response.ok) {
    clearTokens()
    return false
  }

  const body = (await response.json()) as { accessToken: string; refreshToken: string }
  setTokens(body.accessToken, body.refreshToken)
  return true
}

/** Starts a refresh, or joins the one already running. */
function refreshOnce(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = refreshSession()
      .catch(() => false)
      .finally(() => {
        // Cleared only after everyone waiting has resolved, so the next 401
        // after this one starts a genuinely new attempt rather than reusing a
        // settled promise.
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

function buildHeaders(init: RequestInit): HeadersInit {
  const token = getAccessToken()

  /**
   * A FormData body must NOT carry a Content-Type set by us.
   *
   * The browser generates one of the form
   * `multipart/form-data; boundary=----WebKitFormBoundary...`, and that
   * boundary is the only thing telling the server where each part starts.
   * Setting the header by hand overwrites it with a value that has no boundary,
   * so the request looks well formed, arrives intact, and fails to parse into
   * any fields at all. Deleting the header is the fix; there is no correct
   * value to supply.
   */
  const isMultipart = typeof FormData !== 'undefined' && init.body instanceof FormData

  return {
    ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...init.headers,
  }
}

export async function apiRequest<TResponse>(
  path: string,
  init: RequestInit = {},
): Promise<TResponse> {
  let response = await fetch(`${BASE_URL}${path}`, { ...init, headers: buildHeaders(init) })

  /**
   * One silent retry on 401.
   *
   * The access token lives fifteen minutes, so an expired one is the ordinary
   * state of any tab left open over a coffee break, not an error. Refreshing
   * and retrying here means the person never sees it happen and never gets
   * bounced to a sign in page mid task.
   *
   * Only 401. A 403 means the token is fine and the account is not allowed,
   * which no amount of refreshing fixes, and retrying it would hammer the
   * server on every forbidden page.
   */
  if (response.status === 401 && !NO_REFRESH.some((p) => path.startsWith(p))) {
    const refreshed = await refreshOnce()
    if (refreshed) {
      response = await fetch(`${BASE_URL}${path}`, { ...init, headers: buildHeaders(init) })
    } else if (getRefreshToken() === null) {
      // The session is over rather than momentarily stale. Told once, here,
      // rather than by every query on the page rendering its own error.
      onSessionExpired?.()
    }
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null
    throw new ApiRequestError(
      response.status,
      body ?? { code: 'UNKNOWN', message: response.statusText, timestamp: '' },
    )
  }

  // 202 Accepted and 204 No Content have no body to parse.
  if (response.status === 204) return undefined as TResponse
  return (await response.json()) as TResponse
}
