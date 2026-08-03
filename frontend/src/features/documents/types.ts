export interface PresignRequest {
  fileName: string
  contentType: string
  sizeBytes: number
}

export interface PresignResponse {
  documentId: string
  uploadUrl: string
  expiresAt: string
}
