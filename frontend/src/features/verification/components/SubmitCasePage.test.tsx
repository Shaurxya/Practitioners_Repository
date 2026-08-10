import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { addRegistryRows, resetRegistry } from '@/mocks/verificationEngine'
import { ApiRequestError } from '@/lib/apiClient'
import type { SubmitVerificationRequest } from '../types'
import { SubmitCasePage, validateClaim } from './SubmitCasePage'

/**
 * The upload module is mocked rather than served by MSW, which is the exception
 * in this suite and has a specific cause.
 *
 * A multipart request cannot survive jsdom: the File, the FormData and the
 * fetch serializer have to come from one class family, and no combination
 * available here does. The details and the three combinations that fail are in
 * src/test/setup.ts. What is covered instead is everything above the wire, and
 * the wire format itself is exercised against Spring's own multipart resolver.
 */
vi.mock('@/features/documents/api/documentApi', () => ({
  uploadDocument: vi.fn(),
}))
const { uploadDocument } = await import('@/features/documents/api/documentApi')
const uploadMock = vi.mocked(uploadDocument)

describe('validateClaim', () => {
  const valid: SubmitVerificationRequest = {
    fullName: 'Anita Sharma',
    registrationNumber: 'MH-28409',
    council: 'MH',
    specialty: 'Panchakarma',
    country: 'IN',
    medicalSystem: 'A',
    photoIdDocumentId: 'a3f1c2d4-0000-4000-8000-000000000001',
    selfieDocumentId: 'a3f1c2d4-0000-4000-8000-000000000002',
  }

  it('accepts a well formed claim', () => {
    expect(validateClaim(valid)).toEqual({})
  })

  it('requires every field', () => {
    const errors = validateClaim({
      fullName: '',
      registrationNumber: '',
      council: '',
      specialty: '',
      country: '',
      medicalSystem: '',
      photoIdDocumentId: null,
      selfieDocumentId: null,
    })
    expect(Object.keys(errors)).toHaveLength(8)
  })

  /**
   * Required by the form, optional to the server, and that is deliberate rather
   * than inconsistent. The scheduled re-verification job re-checks an approved
   * practitioner with nobody at a keyboard and has no new images to offer, so
   * the server answers absence with an IDENTITY_DOCUMENTS rule of REVIEW. A
   * person filling in this form has no such excuse.
   */
  it('will not accept a claim with no identity documents', () => {
    expect(validateClaim({ ...valid, photoIdDocumentId: null }).photoIdDocumentId).toBeDefined()
    expect(validateClaim({ ...valid, selfieDocumentId: null }).selfieDocumentId).toBeDefined()
  })

  /**
   * The medical system is one character of a permanent identifier, so there is
   * no defensible default for it. Letting the form submit without one would
   * make a guessed 'A' indistinguishable afterwards from a deliberate answer.
   */
  it('will not accept a claim with no medical system', () => {
    expect(validateClaim({ ...valid, medicalSystem: '' }).medicalSystem).toBeDefined()
  })

  it('will not accept a claim with no country', () => {
    expect(validateClaim({ ...valid, country: '' }).country).toBeDefined()
  })

  /**
   * Every council numbers its register differently, so this check cannot be a
   * shape. The old rule allowed at most two leading letters and six digits,
   * which rejected the NCISM national format and told a Goa practitioner that
   * their own registration number was not one.
   */
  it('accepts the registration number shapes that appear in the real registry', () => {
    for (const number of [
      'KA35652',
      'kl42804',
      'MH-28409',
      'KL 16405',
      'GJ 14549',
      '28409', // 10.3% of registry rows omit the council prefix entirely
      'NR/AY/GA/0000001', // NCISM provisional national register
      'nr/ay/mh/0012345',
      'NR-AY-KL-0004821',
    ]) {
      expect(validateClaim({ ...valid, registrationNumber: number }).registrationNumber).toBeUndefined()
    }
  })

  it('rejects input that cannot be a registration number', () => {
    for (const number of ['abc', '12', 'not a number at all']) {
      expect(validateClaim({ ...valid, registrationNumber: number }).registrationNumber).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Step 1, finding the registration
// ---------------------------------------------------------------------------

const ON_REGISTER = {
  councilCode: 'MH',
  licenceRaw: 'MH-28409',
  licenceKeys: ['MH28409', '28409'],
  fullNameRaw: 'Dr. Anita Sharma',
  fullNameNormalized: 'ANITA SHARMA',
  status: 'ACTIVE',
  validUntil: '2027-03-31',
  specialty: 'Panchakarma',
  sourceBatch: 'council-2026-07-14',
}

beforeEach(() => resetRegistry())

/** Fills the three fields step 1 asks for and runs the lookup. */
async function find(
  user: ReturnType<typeof userEvent.setup>,
  registrationNumber = 'MH-28409',
) {
  const country = await screen.findByRole('combobox', { name: /Country of registration/ })
  await within(country).findByRole('option', { name: 'India' })
  await user.selectOptions(country, 'IN')

  const council = await screen.findByRole('combobox', { name: /^Council/ })
  await within(council).findByRole('option', { name: 'Maharashtra Council of Indian Medicine' })
  await user.selectOptions(council, 'MH')

  await user.type(screen.getByRole('textbox', { name: /Registration number/ }), registrationNumber)
  await user.click(screen.getByRole('button', { name: 'Find my registration' }))
}

describe('SubmitCasePage, step 1', () => {
  it('starts on step 1 and does not ask for a name yet', async () => {
    renderWithProviders(<SubmitCasePage />)
    expect(await screen.findByText(/Step 1 of 3/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Full name/ })).not.toBeInTheDocument()
  })

  it('will not look up an incomplete registration', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await user.click(screen.getByRole('button', { name: 'Find my registration' }))
    expect(
      await screen.findByText('Select the country you are registered in.'),
    ).toBeInTheDocument()
  })

  /**
   * The reveal, and the limit on it. An initial per name part is enough to
   * recognise yourself; the full name is not on screen anywhere.
   */
  it('shows a masked name when the register holds the registration', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await find(user)

    expect(await screen.findByText('Registration found')).toBeInTheDocument()
    expect(screen.getByText('A•••• S••••')).toBeInTheDocument()
    expect(screen.getByText('council-2026-07-14')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('ANITA SHARMA')
    expect(document.body.textContent).not.toContain('Anita Sharma')
  })

  /**
   * Zero candidates means NO_MATCH means a person looks at it, always. Somebody
   * genuinely registered whose row has not been imported yet has to be able to
   * get in front of one.
   */
  it('still offers to continue when nothing was found', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await find(user, 'MH-99999')

    expect(await screen.findByText('We could not find that registration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue anyway' })).toBeInTheDocument()
  })

  /**
   * Two rows on one number reveal nothing at all, not even the count. Showing a
   * claimant two masked names side by side would let them pick the one they
   * wanted to be.
   */
  it('reveals nothing when more than one entry matches', async () => {
    addRegistryRows([ON_REGISTER, { ...ON_REGISTER, fullNameNormalized: 'ANIL SHARMA' }])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await find(user)

    const panel = (await screen.findByText('That number matches more than one entry')).closest(
      '[role="status"]',
    )
    expect(panel).not.toBeNull()
    // No masked name, and no digit anywhere in the panel: the count is as much
    // a disclosure as the names are. "more than one" is the whole answer.
    expect(panel?.textContent).not.toContain('••••')
    expect(panel?.textContent).not.toMatch(/\d/)
  })

  /**
   * The panel describes a specific registration number. Leaving it on screen
   * after that number changes shows an answer to a question no longer being
   * asked.
   */
  it('clears the result when the registration number is edited', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await find(user)
    expect(await screen.findByText('Registration found')).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: /Registration number/ }), '0')
    expect(screen.queryByText('Registration found')).not.toBeInTheDocument()
  })

  it('offers no council at all until a country is chosen', async () => {
    renderWithProviders(<SubmitCasePage />)
    const council = await screen.findByRole('combobox', { name: /^Council/ })

    // The placeholder says "Select a country first". A select saying that while
    // listing thirty six options contradicts itself, and the person reasonably
    // believes the placeholder is wrong rather than that they missed a step.
    await screen.findByRole('option', { name: 'India' })
    expect(within(council).getAllByRole('option')).toHaveLength(1)
  })

  /**
   * The list comes from the server, not from a constant in this bundle. It was
   * hardcoded to the four councils V2 seeded, so when a migration added the
   * remaining states this form silently went on offering four and a
   * practitioner registered in Goa could not describe themselves at all.
   */
  async function councilOptionsFor(user: ReturnType<typeof userEvent.setup>) {
    const country = await screen.findByRole('combobox', { name: /Country of registration/ })
    await within(country).findByRole('option', { name: 'India' })
    await user.selectOptions(country, 'IN')

    const select = await screen.findByRole('combobox', { name: /^Council/ })
    await within(select).findByRole('option', { name: 'Maharashtra Council of Indian Medicine' })
    return within(select).getAllByRole('option')
  }

  it('offers every council the registry holds, not a hardcoded few', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)
    const labels = (await councilOptionsFor(user)).map((o) => o.textContent ?? '')

    expect(labels).toContain('Goa Board of Indian System of Medicine and Homoeopathy')
    expect(labels).toContain('Tamil Nadu')
    expect(labels).toContain('West Bengal')
    // 36 states and union territories, plus the placeholder.
    expect(labels).toHaveLength(37)
  })

  it('sorts councils by the name a person reads, not by code', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)
    const labels = (await councilOptionsFor(user)).slice(1).map((o) => o.textContent ?? '')

    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
  })

  /**
   * Changing country has to clear the council under it. Leaving a Maharashtra
   * council selected under "United States" sends the server a claim it can only
   * reject, and the person has no way to see why: both fields look answered.
   */
  it('clears the council when the country changes', async () => {
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    const country = await screen.findByRole('combobox', { name: /Country of registration/ })
    await within(country).findByRole('option', { name: 'India' })
    await user.selectOptions(country, 'IN')

    const council = screen.getByRole('combobox', { name: /^Council/ })
    await within(council).findByRole('option', { name: 'Maharashtra Council of Indian Medicine' })
    await user.selectOptions(council, 'MH')
    expect((council as HTMLSelectElement).value).toBe('MH')

    await user.selectOptions(country, 'US')
    expect((council as HTMLSelectElement).value).toBe('')
  })

  it('uses plain language, never database vocabulary', () => {
    renderWithProviders(<SubmitCasePage />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Registration number')
    expect(text).not.toContain('license_no')
    expect(text).not.toContain('License')
  })
})

// ---------------------------------------------------------------------------
// Step 2, confirming it is you
// ---------------------------------------------------------------------------

describe('SubmitCasePage, step 2', () => {
  async function reachStep2(user: ReturnType<typeof userEvent.setup>) {
    await find(user)
    await user.click(await screen.findByRole('button', { name: /This is me, continue|Continue anyway/ }))
  }

  /**
   * The single most important assertion in this file.
   *
   * If the lookup prefilled the name, NAME_MATCH would score 1.00 against a
   * string we handed the claimant, and it is a required rule. Masking the name
   * and making them type it is what keeps that rule measuring something.
   */
  it('never prefills the name it just masked', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep2(user)

    const name = await screen.findByRole('textbox', { name: /Full name/ })
    expect((name as HTMLInputElement).value).toBe('')
    expect(document.body.textContent).not.toContain('Anita Sharma')
    expect(document.body.textContent).not.toContain('ANITA SHARMA')
  })

  it('keeps the masked name visible as the thing to check against', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep2(user)
    expect(await screen.findByText('A•••• S••••')).toBeInTheDocument()
  })

  it('does not continue without a name', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep2(user)
    await user.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByText('Enter your full name as it appears on the register.'),
    ).toBeInTheDocument()
  })

  it('offers the five systems of medicine, from the server', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep2(user)
    const select = await screen.findByRole('combobox', { name: /System of medicine/ })
    await within(select).findByRole('option', { name: 'Ayurveda' })

    const labels = within(select)
      .getAllByRole('option')
      .slice(1)
      .map((o) => o.textContent ?? '')
    expect(labels).toEqual([
      'Ayurveda',
      'Siddha',
      'Unani',
      'Yoga',
      'Traditional Chinese Medicine',
    ])
  })

  /** Going back must not lose what was typed, or the wizard punishes a correction. */
  it('keeps step 1 answers when going back', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep2(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))

    const number = await screen.findByRole('textbox', { name: /Registration number/ })
    expect((number as HTMLInputElement).value).toBe('MH-28409')
  })
})

// ---------------------------------------------------------------------------
// Step 3, persona verification
// ---------------------------------------------------------------------------

function pngFile(name = 'selfie.png') {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ])
  return new File([bytes], name, { type: 'image/png' })
}

describe('SubmitCasePage, step 3', () => {
  beforeEach(() => {
    uploadMock.mockReset()
    uploadMock.mockImplementation((_file, kind) =>
      Promise.resolve({ documentId: `doc-${kind}`, kind, sizeBytes: 16 }),
    )
  })

  async function reachStep3(user: ReturnType<typeof userEvent.setup>) {
    await find(user)
    await user.click(await screen.findByRole('button', { name: /This is me, continue/ }))

    await user.type(await screen.findByRole('textbox', { name: /Full name/ }), 'Anita Sharma')
    const system = await screen.findByRole('combobox', { name: /System of medicine/ })
    await within(system).findByRole('option', { name: 'Ayurveda' })
    await user.selectOptions(system, 'A')
    await user.selectOptions(screen.getByRole('combobox', { name: /Specialty/ }), 'Panchakarma')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
  }

  it('asks for a photo ID and a camera photo', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)

    expect(await screen.findByText(/Step 3 of 3/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Photo ID/)).toBeInTheDocument()
    expect(screen.getByText('Photo of yourself')).toBeInTheDocument()
  })

  /**
   * The selfie is a camera capture, not a file input, and this is the assertion
   * that keeps it that way. A file picker accepts any image ever saved to the
   * device, including one taken from a public profile, so it proves nothing
   * about who is at the keyboard.
   */
  it('offers no way to pick a saved file for the selfie', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)

    // One file input on the step, and it is the ID document.
    const fileInputs = document.querySelectorAll('input[type="file"]')
    expect(fileInputs).toHaveLength(1)
    expect(screen.getByLabelText(/Photo ID/)).toBe(fileInputs[0])
  })

  /**
   * The promise made on this screen has to be one the system keeps. These three
   * are each enforced somewhere real: encryption in DocumentCipher, the role
   * check on the content endpoint, and a DOCUMENT_READ audit row per read.
   */
  it('says what happens to the images, because they are the sensitive part', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)
    expect(await screen.findByText(/encrypted before they are stored/)).toBeInTheDocument()
    expect(screen.getByText(/record who did it/)).toBeInTheDocument()
  })

  it('will not submit without both images', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)
    await user.click(screen.getByRole('button', { name: 'Submit claim' }))

    expect(await screen.findByText('Upload a photo ID.')).toBeInTheDocument()
  })

  it('uploads the ID as soon as it is chosen and confirms it', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)
    await user.upload(screen.getByLabelText(/Photo ID/) as HTMLInputElement, pngFile('id.png'))

    expect(await screen.findByText(/id.png uploaded and encrypted/)).toBeInTheDocument()
  })

  /**
   * A file whose bytes disagree with its declared type is refused by the
   * server, and the wizard has to surface that message rather than swallow it
   * or replace it with something generic. The declared content type is chosen
   * by the browser and is not evidence, so this check can only live server side.
   */
  it('surfaces the server refusing a file that is not really an image', async () => {
    uploadMock.mockRejectedValueOnce(
      new ApiRequestError(400, {
        code: 'BAD_REQUEST',
        message: 'That file does not look like a image/png. Upload a JPEG, PNG or PDF.',
        timestamp: '',
      }),
    )
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)
    await user.upload(screen.getByLabelText(/Photo ID/) as HTMLInputElement, pngFile('payload.png'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/does not look like/)
  })

  /** Rejected uploads must not leave a document id behind on the claim. */
  it('does not record a document that failed to upload', async () => {
    uploadMock.mockRejectedValue(
      new ApiRequestError(400, { code: 'BAD_REQUEST', message: 'Nope.', timestamp: '' }),
    )
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)
    await user.upload(screen.getByLabelText(/Photo ID/) as HTMLInputElement, pngFile('id.png'))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Submit claim' }))

    expect(await screen.findByText('Upload a photo ID.')).toBeInTheDocument()
  })

  /** Caught in the browser, so a 40 MB photo is not uploaded before being refused. */
  it('refuses an oversized file without a round trip', async () => {
    addRegistryRows([ON_REGISTER])
    const user = userEvent.setup()
    renderWithProviders(<SubmitCasePage />)

    await reachStep3(user)
    const huge = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText(/Photo ID/) as HTMLInputElement, huge)

    expect(await screen.findByRole('alert')).toHaveTextContent(/over 10 MB/)
  })
})
