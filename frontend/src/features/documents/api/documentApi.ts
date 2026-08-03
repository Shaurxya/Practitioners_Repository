import { apiRequest } from '@/lib/apiClient'
import type { PresignRequest, PresignResponse } from '../types'

export function presignUpload(body: PresignRequest): Promise<PresignResponse> {
  return apiRequest<PresignResponse>('/api/v1/documents/presign', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function confirmUpload(documentId: string, sha256: string): Promise<void> {
  return apiRequest<void>('/api/v1/documents/confirm', {
    method: 'POST',
    body: JSON.stringify({ documentId, sha256 }),
  })
}
