/**
 * The only place that talks to the network. Every feature api/ module calls
 * this, so auth headers, base url, and error shape are defined once.
 */
import { getAccessToken } from '@/lib/authToken'
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

export async function apiRequest<TResponse>(
  path: string,
  init: RequestInit = {},
): Promise<TResponse> {
  const token = getAccessToken()

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })

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
