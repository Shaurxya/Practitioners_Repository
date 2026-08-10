import type { ChangeEvent } from 'react'
import { useId, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiRequestError } from '@/lib/apiClient'
import { uploadDocument } from '../api/documentApi'
import { ACCEPTED_IMAGE_TYPES, MAX_DOCUMENT_BYTES } from '../types'
import type { DocumentKind, UploadedDocument } from '../types'
import { LiveCapture } from './LiveCapture'

interface FilePickerProps {
  kind: DocumentKind
  label: string
  hint: string
  accept: string
  capture?: 'user' | 'environment'
  documentId: string | null
  onUploaded: (uploaded: UploadedDocument) => void
}

/**
 * One file, uploaded as soon as it is chosen.
 *
 * Uploading on selection rather than at submit is what keeps the wizard honest
 * about failure. A person who picks a 40 MB photo finds out here, next to the
 * control they used, instead of after filling in the rest and pressing the
 * button that was supposed to finish the job.
 */
function FilePicker({
  kind,
  label,
  hint,
  accept,
  capture,
  documentId,
  onUploaded,
}: FilePickerProps) {
  const inputId = useId()
  const [localError, setLocalError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (file: File) => uploadDocument(file, kind),
    onSuccess: onUploaded,
  })

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setLocalError(null)
    setFileName(file.name)

    // Both checks mirror the server, which stays the authority. They exist to
    // save a round trip on the two mistakes people actually make.
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      setLocalError('That needs to be a JPEG, PNG or PDF.')
      return
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setLocalError('That file is over 10 MB. Try a smaller photo.')
      return
    }
    mutation.mutate(file)
  }

  const serverError =
    mutation.error instanceof ApiRequestError ? mutation.error.body.message : null
  const error = localError ?? serverError

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-body-md font-medium text-content">
        {label}
        <span aria-hidden="true"> *</span>
      </label>
      <p className="text-body-sm text-content-muted">{hint}</p>

      <input
        id={inputId}
        type="file"
        accept={accept}
        // On a phone this opens the camera directly. "user" is the front
        // camera for a selfie, "environment" the rear one for a document.
        // Desktop browsers ignore it and show a file picker, which is correct.
        capture={capture}
        onChange={handleChange}
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={error ? true : undefined}
        className="block w-full text-body-sm text-content file:mr-4 file:border file:border-border file:bg-surface-raised file:px-4 file:py-2 file:text-body-sm file:text-content hover:file:bg-surface"
      />

      {mutation.isPending && (
        <p role="status" className="text-body-sm text-content-muted">
          Uploading {fileName}
        </p>
      )}

      {documentId && !mutation.isPending && !error && (
        <p role="status" className="text-body-sm text-content">
          <span aria-hidden="true">✓ </span>
          {fileName} uploaded and encrypted
        </p>
      )}

      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-body-sm text-content">
          {error}
        </p>
      )}
    </div>
  )
}

export interface IdentityStepProps {
  photoIdDocumentId: string | null
  selfieDocumentId: string | null
  onChange: (field: 'photoIdDocumentId' | 'selfieDocumentId', documentId: string) => void
}

/**
 * Step 3: prove the person making this claim is the person on the certificate.
 *
 * What this can and cannot establish is worth being straight about, and the
 * copy below says so rather than implying a stronger guarantee. The register
 * holds no photograph, so the chain is: a live person, holding this government
 * ID, whose name matches the name on the register. The face is never bound to
 * the registration itself, only to the ID document.
 */
export function IdentityStep({
  photoIdDocumentId,
  selfieDocumentId,
  onChange,
}: IdentityStepProps) {
  return (
    <div className="space-y-7">
      <div className="border-l-2 border-border-strong bg-surface-raised px-4 py-3 text-body-sm text-content-muted">
        These two images are encrypted before they are stored, only a reviewer can open them,
        and every time one is opened we record who did it. They are erased once your claim has
        been decided.
      </div>

      <FilePicker
        kind="PHOTO_ID"
        label="Photo ID"
        hint="A passport, driving licence or Aadhaar card. The name on it needs to match the name you entered."
        accept="image/jpeg,image/png,application/pdf"
        capture="environment"
        documentId={photoIdDocumentId}
        onUploaded={(uploaded) => onChange('photoIdDocumentId', uploaded.documentId)}
      />

      {/* Camera, not a file picker, and that is the point of the step.
          A file input accepts any image ever saved to the device, including one
          taken from a public profile, so it proves nothing about who is at the
          keyboard. Capturing here at least requires a camera pointed at
          something during this session. It is still not liveness detection: see
          the note in LiveCapture. */}
      <LiveCapture
        documentId={selfieDocumentId}
        onCaptured={(documentId) => onChange('selfieDocumentId', documentId)}
      />
    </div>
  )
}
