import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { ApiRequestError } from '@/lib/apiClient'
import { LiveCapture } from './LiveCapture'

/**
 * The upload module is mocked for the reason recorded in src/test/setup.ts: a
 * multipart request cannot survive jsdom. What is under test here is the camera
 * lifecycle, which is the whole point of this component.
 */
vi.mock('@/features/documents/api/documentApi', () => ({
  uploadDocument: vi.fn(),
}))
const { uploadDocument } = await import('@/features/documents/api/documentApi')
const uploadMock = vi.mocked(uploadDocument)

/** Tracks handed out by the fake camera, so a test can assert they were stopped. */
let tracks: Array<{ stop: ReturnType<typeof vi.fn> }> = []

function fakeCamera(behaviour: 'grants' | 'denies' | 'missing' | 'busy' = 'grants') {
  // The parameter is declared so the mock's call signature carries it, which is
  // what lets a test read back the constraints it was asked for.
  const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => {
    if (behaviour === 'denies') throw Object.assign(new Error('no'), { name: 'NotAllowedError' })
    if (behaviour === 'missing') throw Object.assign(new Error('no'), { name: 'NotFoundError' })
    if (behaviour === 'busy') throw Object.assign(new Error('no'), { name: 'NotReadableError' })
    tracks = [{ stop: vi.fn() }]
    return { getTracks: () => tracks } as unknown as MediaStream
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  return getUserMedia
}

beforeEach(() => {
  tracks = []
  uploadMock.mockReset()
  uploadMock.mockResolvedValue({ documentId: 'selfie-1', kind: 'SELFIE', sizeBytes: 2048 })

  // jsdom implements none of the media surface a camera needs.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback) {
    callback(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }))
  }
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => vi.restoreAllMocks())

function render() {
  const onCaptured = vi.fn()
  const view = renderWithProviders(
    <LiveCapture documentId={null} onCaptured={onCaptured} />,
  )
  return { onCaptured, view }
}

describe('LiveCapture', () => {
  /**
   * The camera must not open on render. A page that grabs the camera the moment
   * it loads is one people close, and the browser prompt arrives with no
   * explanation of why it is being asked for.
   */
  it('does not touch the camera until asked', () => {
    const getUserMedia = fakeCamera()
    render()

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByText(/Your camera is off/)).toBeInTheDocument()
  })

  it('asks only for video, and for the front camera', async () => {
    const getUserMedia = fakeCamera()
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))

    expect(getUserMedia).toHaveBeenCalledOnce()
    const constraints = getUserMedia.mock.calls[0]![0]
    // Never audio. Nothing here needs a microphone and asking for one turns a
    // reasonable request into an alarming one.
    expect(constraints.audio).toBe(false)
    expect((constraints.video as MediaTrackConstraints).facingMode).toBe('user')
  })

  it('captures a photo and uploads it as the selfie', async () => {
    fakeCamera()
    const user = userEvent.setup()
    const { onCaptured } = render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))
    await user.click(await screen.findByRole('button', { name: 'Take photo' }))

    expect(uploadMock).toHaveBeenCalledOnce()
    const [file, kind] = uploadMock.mock.calls[0]!
    expect(kind).toBe('SELFIE')
    expect(file.type).toBe('image/jpeg')
    expect(onCaptured).toHaveBeenCalledWith('selfie-1')
  })

  /**
   * The camera light going off when the work is done is not politeness. Leaving
   * it lit reads as the page still watching, and on a phone it is a real
   * battery cost.
   */
  it('releases the camera the moment it has a frame', async () => {
    fakeCamera()
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))
    expect(tracks).toHaveLength(1)
    expect(tracks[0]!.stop).not.toHaveBeenCalled()

    await user.click(await screen.findByRole('button', { name: 'Take photo' }))
    expect(tracks[0]!.stop).toHaveBeenCalled()
  })

  it('releases the camera if the step is left before capturing', async () => {
    fakeCamera()
    const user = userEvent.setup()
    const { view } = render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))
    await screen.findByRole('button', { name: 'Take photo' })
    view.unmount()

    expect(tracks[0]!.stop).toHaveBeenCalled()
  })

  // ------------------------------------------------------------------
  // The four refusals, each needing a different action from the person
  // ------------------------------------------------------------------

  it('explains a refused permission and offers another go', async () => {
    fakeCamera('denies')
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Allow camera access/)
    expect(screen.getByRole('button', { name: 'Try the camera again' })).toBeInTheDocument()
  })

  /** A desktop with no webcam cannot finish this step, and is told where to go. */
  it('sends someone with no camera to their phone', async () => {
    fakeCamera('missing')
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/on your phone/)
  })

  it('says when another app is holding the camera', async () => {
    fakeCamera('busy')
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Another app is using the camera/)
  })

  /**
   * getUserMedia is undefined outside a secure context, so a page opened over
   * plain http on a LAN address simply has no camera. Saying "https" is the
   * difference between a fixable problem and a mysterious one.
   */
  it('explains that an insecure page has no camera at all', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/https/)
  })

  it('lets a failed upload be retried without losing the camera step', async () => {
    fakeCamera()
    uploadMock.mockRejectedValueOnce(
      new ApiRequestError(400, { code: 'BAD_REQUEST', message: 'Too blurry.', timestamp: '' }),
    )
    const user = userEvent.setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Turn on camera' }))
    await user.click(await screen.findByRole('button', { name: 'Take photo' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too blurry.')
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument()
  })
})
