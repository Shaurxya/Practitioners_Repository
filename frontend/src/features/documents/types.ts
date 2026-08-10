/**
 * Identity evidence: a government photo ID and a liveness selfie.
 *
 * REGISTRATION_CERTIFICATE is accepted by the server and not used by the
 * portal yet. It is here because the column exists and a certificate is the
 * obvious third thing a reviewer will ask for.
 */
export const DOCUMENT_KIND = ['PHOTO_ID', 'SELFIE', 'REGISTRATION_CERTIFICATE'] as const
export type DocumentKind = (typeof DOCUMENT_KIND)[number]

/**
 * What comes back from an upload. Note what is absent: any way to read the file
 * again. A practitioner cannot fetch their own uploaded ID back, deliberately,
 * because an endpoint returning a stored government ID to whoever holds the
 * session is a far larger target than one restricted to reviewers.
 */
export interface UploadedDocument {
  documentId: string
  kind: DocumentKind
  sizeBytes: number
}

/** What the browser will accept, matching the server's allow list. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const

/** 10 MB, the same cap the server enforces. Checked here to save a round trip. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
