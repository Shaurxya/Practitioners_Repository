import { apiRequest } from '@/lib/apiClient'
import type { PublicVerification } from '../types'

export function lookupImmortalId(immortalId: string): Promise<PublicVerification> {
  return apiRequest<PublicVerification>(
    `/api/v1/public/verify?immortalId=${encodeURIComponent(immortalId)}`,
  )
}
