import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ApiRequestError } from '@/lib/apiClient'
import { uploadDocument } from '../api/documentApi'

/**
 * Takes the selfie with the camera, here and now, instead of accepting a file.
 *
 * <h2>What this does and does not prove</h2>
 *
 * It proves a camera attached to this device produced a frame during this
 * session. That is strictly more than a file picker, which happily accepts any
 * image ever saved to the machine, including one taken from a public profile.
 *
 * It is <b>not</b> liveness detection. A photograph held up to the lens passes,
 * and so does a video played back at it. Real liveness needs a provider that
 * analyses depth, texture and micro movement, which is what
 * {@code IdentityVerificationProvider} exists to plug in. The copy below says
 * "taken now" and never "verified", because promising more than this measures
 * is how a control becomes theatre.
 *
 * <p>So the honest chain today: this raises the effort of impersonation from
 * "find a photo" to "hold a photo to a camera", and a human still compares the
 * result with the ID document.
 */

type Phase = 'IDLE' | 'STARTING' | 'LIVE' | 'CAPTURED' | 'UPLOADING' | 'DONE' | 'BLOCKED'

interface LiveCaptureProps {
  documentId: string | null
  onCaptured: (documentId: string) => void
}

/** Camera access needs a secure context. Plain http on a LAN address silently has no camera. */
function cameraSupported() {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function LiveCapture({ documentId, onCaptured }: LiveCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [phase, setPhase] = useState<Phase>('IDLE')
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  /**
   * Releases the camera.
   *
   * Not optional politeness. Without it the camera indicator stays lit after
   * the step is finished, which is both alarming and, on a phone, a real
   * battery cost. Called on capture, on unmount, and on error.
   */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  // Revoke the object URL when it is replaced or the component goes away.
  // Preview blobs are held by the browser until told otherwise, and this one
  // is a photograph of somebody's face.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  async function startCamera() {
    setError(null)

    if (!cameraSupported()) {
      setPhase('BLOCKED')
      setError(
        'This browser cannot reach a camera. That usually means the page is not on a secure connection. Open it over https, or use your phone.',
      )
      return
    }

    setPhase('STARTING')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The front camera on a phone. Ignored on a laptop, which has one.
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {
          // Autoplay can be refused even when muted. The stream is still live
          // and the controls below still work, so this is not fatal.
        })
      }
      setPhase('LIVE')
    } catch (cause) {
      stopCamera()
      setPhase('BLOCKED')
      // The three the browser actually throws, each needing a different action
      // from the person. A single "camera error" would leave them guessing
      // which one they are in.
      const name = (cause as { name?: string })?.name
      setError(
        name === 'NotAllowedError'
          ? 'You turned the camera down. Allow camera access in your browser, then try again.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No camera was found on this device. Open this page on your phone to finish.'
            : name === 'NotReadableError'
              ? 'Another app is using the camera. Close it and try again.'
              : 'The camera could not be started. Check your browser permissions and try again.',
      )
    }
  }

  async function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    // The video's own resolution, not the size it happens to be displayed at.
    // Using the CSS size would upload whatever the layout made it, which on a
    // narrow phone is far too small for anyone to compare with an ID.
    const width = video.videoWidth || 1280
    const height = video.videoHeight || 720
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return
    context.drawImage(video, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    )
    if (!blob) {
      setError('The photo could not be captured. Try again.')
      return
    }

    // Camera off the moment there is a frame. Nothing after this point needs it.
    stopCamera()
    setPreview(URL.createObjectURL(blob))
    setPhase('UPLOADING')

    try {
      const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' })
      const uploaded = await uploadDocument(file, 'SELFIE')
      onCaptured(uploaded.documentId)
      setPhase('DONE')
    } catch (cause) {
      setPhase('CAPTURED')
      setError(
        cause instanceof ApiRequestError
          ? cause.body.message
          : 'That photo could not be sent. Try again.',
      )
    }
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setError(null)
    void startCamera()
  }

  return (
    <div className="space-y-2">
      <p className="block text-body-md font-medium text-content">
        Photo of yourself
        <span aria-hidden="true"> *</span>
      </p>
      <p className="text-body-sm text-content-muted">
        Taken with your camera now, not chosen from your files. Look straight at the lens in good
        light. A reviewer compares it with your photo ID.
      </p>

      <div className="border border-border bg-surface-raised">
        {/* Kept mounted rather than conditionally rendered. React would
            otherwise replace the element on every phase change and the stream
            attached to it would be dropped mid preview. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          aria-label="Camera preview"
          className={
            phase === 'LIVE' || phase === 'STARTING'
              ? 'block max-h-80 w-full bg-ink object-cover'
              : 'hidden'
          }
        />

        {preview && phase !== 'LIVE' && (
          <img src={preview} alt="The photo you just took" className="block max-h-80 w-full object-cover" />
        )}

        {phase === 'IDLE' && (
          <div className="p-6 text-center text-body-sm text-content-muted">
            Your camera is off. Nothing is recorded until you take the photo.
          </div>
        )}

        {phase === 'BLOCKED' && !preview && (
          <div className="p-6 text-center text-body-sm text-content-muted">
            Camera unavailable
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      <div className="flex flex-wrap gap-3">
        {(phase === 'IDLE' || phase === 'BLOCKED') && (
          <Button variant="secondary" size="lg" onClick={() => void startCamera()}>
            {phase === 'BLOCKED' ? 'Try the camera again' : 'Turn on camera'}
          </Button>
        )}

        {phase === 'STARTING' && (
          <Button variant="secondary" size="lg" loading disabled>
            Starting camera
          </Button>
        )}

        {phase === 'LIVE' && (
          <Button variant="primary" size="lg" onClick={() => void capture()}>
            Take photo
          </Button>
        )}

        {phase === 'UPLOADING' && (
          <Button variant="primary" size="lg" loading disabled>
            Sending
          </Button>
        )}

        {(phase === 'CAPTURED' || phase === 'DONE') && (
          <Button variant="secondary" size="lg" onClick={retake}>
            Retake
          </Button>
        )}
      </div>

      {phase === 'DONE' && documentId && (
        <p role="status" className="text-body-sm text-content">
          <span aria-hidden="true">✓ </span>
          Photo taken and encrypted
        </p>
      )}

      {error && (
        <p role="alert" className="text-body-sm text-content">
          {error}
        </p>
      )}
    </div>
  )
}
