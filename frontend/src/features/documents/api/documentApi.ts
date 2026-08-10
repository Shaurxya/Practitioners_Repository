import { apiRequest } from '@/lib/apiClient'
import type { DocumentKind, UploadedDocument } from '../types'

/**
 * Uploads one identity document and returns its id.
 *
 * <b>Multipart to our own server, not a presigned PUT to storage.</b> The
 * original contract sketched presign and confirm, which is the right shape for
 * registry files: they are large and they are not secret. A government photo ID
 * is the opposite on both counts. A presigned PUT would write the browser's
 * plaintext straight into the bucket, so the per document key the server holds
 * would be protecting bytes that had already been stored unprotected.
 * Encrypting in the request path is the only ordering that makes "encrypted at
 * rest" true, and it costs one hop through the app server for a file of a few
 * megabytes.
 *
 * No Content-Type header is set here on purpose. The browser has to generate
 * one including the multipart boundary, and setting it by hand produces a body
 * the server cannot parse.
 */
export function uploadDocument(file: File, kind: DocumentKind): Promise<UploadedDocument> {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)

  return apiRequest<UploadedDocument>('/api/v1/documents', {
    method: 'POST',
    body: form,
  })
}
