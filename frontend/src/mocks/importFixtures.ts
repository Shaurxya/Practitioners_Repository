import type {
  AccuracyReport,
  CanonicalField,
  ImportBatchDetail,
  ImportPageRow,
  MappingProposal,
  ParserProfile,
  RejectRow,
  StagingCell,
  StagingRow,
} from '@/features/registry-import/types'

/**
 * Fixtures for the registry import panel.
 *
 * Chosen to exercise the failures, not the happy path. Between them these six
 * batches cover: a hybrid document, a register whose last fifty pages yielded
 * nothing, a council that reformatted, a fully scanned register, a mapping
 * waiting on confirmation, and an extraction mid run. A fixture set where
 * everything works tells you nothing about whether the screens work.
 */

const ADMIN = 'shaurya'

// Councils are shared reference data, so they live in one module that the
// admin handlers, the public handlers and the practitioner form all read.
export { COUNCILS, councilName } from './councils'
import { councilName } from './councils'

// ---------------------------------------------------------------------------
// Parser profiles
// ---------------------------------------------------------------------------

export const PROFILES: ParserProfile[] = [
  {
    id: 'prof-mh',
    name: 'mh-annual-register',
    councilCode: 'MH',
    tableMode: 'LATTICE',
    headerPatterns: ['^Reg\\.?\\s*No', '^Name', '^Qualification', '^Status', '^Valid'],
    columnMap: { 0: 'licenseNo', 1: 'fullName', 2: 'qualification', 3: 'status', 4: 'validUntil' },
    licenseFormatRegex: '^MH/\\d{4,6}/\\d{4}$',
    dateConvention: 'DMY',
    datePatterns: ['DD/MM/YYYY', 'DD-MM-YYYY', 'D MMM YYYY'],
    statusVocabulary: {
      ACTIVE: 'ACTIVE',
      'IN PRACTICE': 'ACTIVE',
      SUSPENDED: 'SUSPENDED',
      'UNDER SUSPENSION': 'SUSPENDED',
      REMOVED: 'REVOKED',
      LAPSED: 'EXPIRED',
    },
    minLicenseCharConfidence: 0.95,
    minFieldConfidence: 0.7,
    confirmedAt: '2026-07-14T09:12:00Z',
    confirmedBy: ADMIN,
    batchCount: 3,
    updatedAt: '2026-07-14T09:12:00Z',
  },
  {
    id: 'prof-ka',
    name: 'ka-quarterly-register',
    councilCode: 'KA',
    tableMode: 'STREAM',
    headerPatterns: ['^Sl', '^Registration', '^Practitioner', '^System', '^Status'],
    columnMap: { 1: 'licenseNo', 2: 'fullName', 3: 'specialty', 4: 'status' },
    licenseFormatRegex: '^KA-\\d{5}$',
    dateConvention: 'DMY',
    datePatterns: ['DD.MM.YYYY'],
    statusVocabulary: { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', CANCELLED: 'REVOKED' },
    minLicenseCharConfidence: 0.96,
    minFieldConfidence: 0.7,
    confirmedAt: '2026-05-02T11:40:00Z',
    confirmedBy: ADMIN,
    batchCount: 1,
    updatedAt: '2026-05-02T11:40:00Z',
  },
]

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

function batch(over: Partial<ImportBatchDetail> & Pick<ImportBatchDetail, 'id' | 'label' | 'status'>): ImportBatchDetail {
  return {
    councilCode: 'MH',
    profileName: null,
    profileId: null,
    sourceFilename: `${over.label}.pdf`,
    sourceSha256: `${over.id}00000000000000000000000000000000000000000000000000`,
    sourceBytes: 41_200_000,
    pageCount: null,
    classification: null,
    reconciliation: null,
    pagesDone: 0,
    rowsExtracted: 0,
    rowsRejected: 0,
    needsConfirmationCount: 0,
    rowsPromoted: 0,
    staleDiffCount: 0,
    failureCode: null,
    failureDetail: null,
    extractionStartedAt: null,
    extractionHeartbeatAt: null,
    promotedAt: null,
    promotedBy: null,
    promoteReason: null,
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T10:00:00Z',
    uploadedBy: ADMIN,
    ...over,
  }
}

export const BATCHES: ImportBatchDetail[] = [
  // The interesting one. A hybrid document whose last fifty pages yielded
  // nothing, so it looks clean row by row and does not reconcile in total.
  batch({
    id: 'b-mh-aug',
    label: 'council-2026-08-01',
    status: 'AWAITING_PROMOTE_OK',
    profileId: 'prof-mh',
    profileName: 'mh-annual-register',
    pageCount: 312,
    pagesDone: 312,
    rowsExtracted: 11_903,
    rowsRejected: 34,
    needsConfirmationCount: 7,
    classification: {
      pageCount: 312,
      textLayerPages: 254,
      scannedPages: 56,
      unreadablePages: 2,
      rotatedPages: 4,
    },
    reconciliation: {
      declaredRowCount: 12_480,
      extractedRowCount: 11_903,
      rejectedRowCount: 34,
      gap: -543,
      meanRowsPerPage: 45.4,
      anomalousPageCount: 52,
    },
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-01T11:14:00Z',
  }),

  // Mid extraction, so the progress bar and the polling can be seen working.
  batch({
    id: 'b-ka-q3',
    label: 'karnataka-2026-Q3',
    councilCode: 'KA',
    status: 'PARSING',
    profileId: 'prof-ka',
    profileName: 'ka-quarterly-register',
    pageCount: 180,
    pagesDone: 41,
    rowsExtracted: 1_106,
    classification: {
      pageCount: 180,
      textLayerPages: 0,
      scannedPages: 180,
      unreadablePages: 0,
      rotatedPages: 12,
    },
    extractionStartedAt: '2026-08-04T15:40:00Z',
    extractionHeartbeatAt: '2026-08-04T15:47:00Z',
    createdAt: '2026-08-04T15:38:00Z',
  }),

  // Classified and waiting to be told to go. Fully scanned, which is the
  // warning the classification screen exists to deliver.
  batch({
    id: 'b-kl-jul',
    label: 'kerala-2026-07',
    councilCode: 'KL',
    status: 'AWAITING_CLASSIFY_OK',
    pageCount: 96,
    classification: {
      pageCount: 96,
      textLayerPages: 3,
      scannedPages: 92,
      unreadablePages: 1,
      rotatedPages: 8,
    },
    createdAt: '2026-08-03T09:20:00Z',
  }),

  // The council reformatted. Fails loudly rather than remapping on a guess.
  batch({
    id: 'b-gj-jul',
    label: 'gujarat-2026-07',
    councilCode: 'GJ',
    status: 'PARSE_FAILED',
    profileId: 'prof-mh',
    profileName: 'mh-annual-register',
    pageCount: 140,
    failureCode: 'PROFILE_SHAPE_MISMATCH',
    failureDetail:
      'Header row on page 2 read "Sr No | Registration Number | Name of Practitioner | Board | Valid Upto". Profile mh-annual-register expects 5 columns beginning "Reg. No". Column 0 matched no pattern.',
    createdAt: '2026-07-28T14:02:00Z',
  }),

  // First upload of this register, so there is no profile and the mapping has
  // to be confirmed before anything is parsed.
  batch({
    id: 'b-new-shape',
    label: 'maharashtra-supplementary-2026',
    status: 'AWAITING_MAPPING',
    pageCount: 22,
    classification: {
      pageCount: 22,
      textLayerPages: 22,
      scannedPages: 0,
      unreadablePages: 0,
      rotatedPages: 0,
    },
    createdAt: '2026-08-02T16:30:00Z',
  }),

  // The one that worked, kept so the list is not all failures.
  batch({
    id: 'b-mh-jul',
    label: 'council-2026-07-14',
    status: 'PROMOTED',
    profileId: 'prof-mh',
    profileName: 'mh-annual-register',
    pageCount: 308,
    pagesDone: 308,
    rowsExtracted: 12_431,
    rowsRejected: 11,
    classification: {
      pageCount: 308,
      textLayerPages: 308,
      scannedPages: 0,
      unreadablePages: 0,
      rotatedPages: 0,
    },
    reconciliation: {
      declaredRowCount: 12_442,
      extractedRowCount: 12_431,
      rejectedRowCount: 11,
      gap: 0,
      meanRowsPerPage: 40.4,
      anomalousPageCount: 0,
    },
    promotedAt: '2026-07-14T12:02:00Z',
    promotedBy: ADMIN,
    promoteReason: 'Quarterly register, reconciles exactly, 11 rejects all blank separator rows.',
    createdAt: '2026-07-14T10:40:00Z',
    updatedAt: '2026-07-14T12:02:00Z',
  }),
]

// ---------------------------------------------------------------------------
// Pages
//
// The 312 page batch has its last 50 pages yielding nothing. That is the
// deliberate silent partial failure: every row that did extract is perfect, so
// only the page level score and the count reconciliation catch it.
// ---------------------------------------------------------------------------

export function pagesFor(batchId: string): ImportPageRow[] {
  const target = BATCHES.find((b) => b.id === batchId)
  if (!target?.pageCount) return []

  return Array.from({ length: target.pageCount }, (_, i) => {
    const pageNumber = i + 1
    const scanned = batchId === 'b-mh-aug' ? pageNumber > 254 : batchId !== 'b-mh-jul'
    const dead = batchId === 'b-mh-aug' && pageNumber > 262
    const beyondProgress = target.status === 'PARSING' && pageNumber > target.pagesDone

    const rows = dead ? 0 : beyondProgress ? 0 : scanned ? 38 + (pageNumber % 5) : 45 + (pageNumber % 4)
    const ocr = scanned ? Number((0.83 + ((pageNumber * 7) % 13) / 100).toFixed(3)) : null

    return {
      pageNumber,
      classification: beyondProgress
        ? ('SCANNED' as const)
        : scanned
          ? ('SCANNED' as const)
          : ('TEXT_LAYER' as const),
      charCount: scanned ? 40 : 4200,
      rotationDegrees: pageNumber % 71 === 0 ? 90 : 0,
      tableModeUsed: beyondProgress ? null : scanned ? ('STREAM' as const) : ('LATTICE' as const),
      rowsExtracted: rows,
      meanOcrConfidence: beyondProgress ? null : ocr,
      pageConfidence: beyondProgress ? null : dead ? 0 : Number(Math.min(1, rows / 45.4).toFixed(3)),
      anomalyCode: dead
        ? ('ZERO_ROWS' as const)
        : ocr !== null && ocr < 0.86
          ? ('LOW_OCR_CONFIDENCE' as const)
          : pageNumber % 71 === 0
            ? ('ROTATED' as const)
            : null,
    }
  })
}

// ---------------------------------------------------------------------------
// Column mapping proposal
// ---------------------------------------------------------------------------

/**
 * councilCode is passed in rather than looked up here. The handler holds the
 * mutable batch list; this module only has the static fixtures, so a batch
 * uploaded during the session was not found and silently fell back to MH. A
 * Goa register then showed "Council for every row: MH" on the one screen whose
 * entire job is to let someone catch exactly that kind of mistake.
 */
export function mappingFor(batchId: string, councilCode = 'MH'): MappingProposal {
  const code = BATCHES.find((b) => b.id === batchId)?.councilCode ?? councilCode

  if (batchId === 'b-gj-jul') {
    return {
      batchId,
      profileName: 'mh-annual-register',
      councilCode: code,
      councilName: councilName(code),
      shapeMismatch: {
        expected: ['Reg. No', 'Name', 'Qualification', 'Status', 'Valid'],
        found: ['Sr No', 'Registration Number', 'Name of Practitioner', 'Board', 'Valid Upto'],
        detail: 'Five columns detected, but column 0 is a serial number this profile does not expect and every subsequent column is shifted by one.',
      },
      detectedColumns: [
        { index: 0, headerText: 'Sr No', sampleValues: ['1', '2', '3'], proposedField: null, proposalConfidence: 0.12 },
        { index: 1, headerText: 'Registration Number', sampleValues: ['GJ/04412/2019', 'GJ/04413/2019', 'GJ/04415/2020'], proposedField: 'licenseNo', proposalConfidence: 0.97 },
        { index: 2, headerText: 'Name of Practitioner', sampleValues: ['RAMESH B PATEL', 'MEENA J SHAH', 'ARUN K DESAI'], proposedField: 'fullName', proposalConfidence: 0.94 },
        { index: 3, headerText: 'Board', sampleValues: ['Gujarat Board of Ayurvedic', 'Gujarat Board of Ayurvedic', 'Gujarat Board of Ayurvedic'], proposedField: 'council', proposalConfidence: 0.71 },
        { index: 4, headerText: 'Valid Upto', sampleValues: ['31/12/2027', '31/12/2027', '30/06/2028'], proposedField: 'validUntil', proposalConfidence: 0.89 },
      ],
    }
  }

  return {
    batchId,
    profileName: null,
    councilCode: code,
    councilName: councilName(code),
    shapeMismatch: null,
    detectedColumns: [
      { index: 0, headerText: 'Reg. No', sampleValues: ['MH/04471/2018', 'MH/04472/2018', 'MH/04480/2019'], proposedField: 'licenseNo', proposalConfidence: 0.96 },
      { index: 1, headerText: 'Name', sampleValues: ['ANITA R SHARMA', 'VIKRAM S JOSHI', 'PRIYA N KULKARNI'], proposedField: 'fullName', proposalConfidence: 0.95 },
      { index: 2, headerText: 'Qualification', sampleValues: ['BAMS', 'BAMS, MD (Ayu)', 'BAMS'], proposedField: 'qualification', proposalConfidence: 0.88 },
      // Deliberately ambiguous: "Sys." could be specialty or council, and the
      // proposal says so with a low score rather than picking one silently.
      { index: 3, headerText: 'Sys.', sampleValues: ['Ayurveda', 'Ayurveda', 'Unani'], proposedField: 'specialty', proposalConfidence: 0.44 },
      { index: 4, headerText: 'Status', sampleValues: ['ACTIVE', 'ACTIVE', 'UNDER SUSPENSION'], proposedField: 'status', proposalConfidence: 0.93 },
      { index: 5, headerText: 'Valid', sampleValues: ['31/03/2027', '31/03/2027', '31/03/2026'], proposedField: 'validUntil', proposalConfidence: 0.9 },
    ],
  }
}

// ---------------------------------------------------------------------------
// Staging rows
// ---------------------------------------------------------------------------

function cell(raw: string | null, normalized: string | null, confidence: number | null): StagingCell {
  return { raw, normalized, confidence }
}

function emptyCells(): Record<CanonicalField, StagingCell> {
  return {
    licenseNo: cell(null, null, null),
    fullName: cell(null, null, null),
    council: cell(null, null, null),
    status: cell(null, null, null),
    specialty: cell(null, null, null),
    qualification: cell(null, null, null),
    registrationDate: cell(null, null, null),
    validUntil: cell(null, null, null),
  }
}

const NAMES = [
  'ANITA R SHARMA',
  'VIKRAM S JOSHI',
  'PRIYA N KULKARNI',
  'RAJESH M DESHMUKH',
  'SUNITA P BHOSALE',
  'AMIT K PATIL',
  'NEHA S GAIKWAD',
  'SANDEEP V MORE',
]

/**
 * Seven flagged rows built from the classic OCR confusions in a licence number,
 * because that is the failure worth designing the screen around: one wrong
 * character invents a practitioner who does not exist and erases one who does.
 */
const FLAGGED: {
  extracted: string
  truth: string
  confidence: number
  codes: StagingRow['confirmationCodes']
}[] = [
  { extracted: 'MH/O4471/2O18', truth: 'MH/04471/2018', confidence: 0.61, codes: ['LOW_LICENSE_CONFIDENCE', 'OCR_CONFUSABLE_CHARS', 'LICENSE_FORMAT_MISMATCH'] },
  { extracted: 'MH/I2308/2019', truth: 'MH/12308/2019', confidence: 0.68, codes: ['OCR_CONFUSABLE_CHARS', 'LICENSE_FORMAT_MISMATCH'] },
  { extracted: 'MH/0S512/2020', truth: 'MH/05512/2020', confidence: 0.72, codes: ['OCR_CONFUSABLE_CHARS', 'LICENSE_FORMAT_MISMATCH'] },
  { extracted: 'MH/0B347/2017', truth: 'MH/08347/2017', confidence: 0.74, codes: ['OCR_CONFUSABLE_CHARS', 'LICENSE_FORMAT_MISMATCH'] },
  { extracted: 'MH/1Z904/2021', truth: 'MH/12904/2021', confidence: 0.77, codes: ['OCR_CONFUSABLE_CHARS'] },
  { extracted: 'MH/06120/2019', truth: 'MH/06120/2019', confidence: 0.88, codes: ['LOW_LICENSE_CONFIDENCE'] },
  { extracted: 'MH/07731/2018', truth: 'MH/07731/2018', confidence: 0.91, codes: ['LOW_ROW_CONFIDENCE'] },
]

export function buildStagingRows(batchId: string): StagingRow[] {
  if (batchId !== 'b-mh-aug') return []

  const flagged: StagingRow[] = FLAGGED.map((f, i) => {
    const cells = emptyCells()
    cells.licenseNo = cell(f.extracted, null, f.confidence)
    cells.fullName = cell(NAMES[i % NAMES.length] as string, NAMES[i % NAMES.length] as string, 0.94)
    cells.council = cell('Maharashtra Council of Indian Medicine', 'MH', 0.99)
    cells.status = cell('ACTIVE', 'ACTIVE', 0.97)
    cells.qualification = cell('BAMS', 'BAMS', 0.93)
    cells.validUntil = cell('31/03/2027', '2027-03-31', 0.95)

    return {
      id: `row-flag-${i}`,
      sourcePage: 256 + i,
      sourceRowIndex: 4 + i,
      pageClassification: 'SCANNED',
      rawRowText: `${f.extracted}   ${NAMES[i % NAMES.length]}   BAMS   Ayurveda   ACTIVE   31/03/2027`,
      cells,
      rowConfidence: f.confidence,
      licenseConfidence: f.confidence,
      needsConfirmation: true,
      confirmationCodes: f.codes,
      confirmedAt: null,
      promotedAt: null,
      diffVerdict: 'INSERT',
      diffAgainst: null,
      diffComputedAt: '2026-08-01T11:14:00Z',
    }
  })

  const clean: StagingRow[] = Array.from({ length: 33 }, (_, i) => {
    const cells = emptyCells()
    const license = `MH/${String(4500 + i).padStart(5, '0')}/2019`
    const name = NAMES[i % NAMES.length] as string
    const isUpdate = i % 4 === 0

    cells.licenseNo = cell(license, license.replace(/\W/g, ''), 1)
    cells.fullName = cell(name, name, 1)
    cells.council = cell('Maharashtra Council of Indian Medicine', 'MH', 1)
    cells.status = cell(isUpdate ? 'UNDER SUSPENSION' : 'ACTIVE', isUpdate ? 'SUSPENDED' : 'ACTIVE', 1)
    cells.qualification = cell('BAMS', 'BAMS', 1)
    cells.validUntil = cell('31/03/2027', '2027-03-31', 1)

    return {
      id: `row-clean-${i}`,
      sourcePage: 12 + i,
      sourceRowIndex: i,
      pageClassification: 'TEXT_LAYER',
      rawRowText: `${license}   ${name}   BAMS   Ayurveda   ${isUpdate ? 'UNDER SUSPENSION' : 'ACTIVE'}   31/03/2027`,
      cells,
      rowConfidence: 1,
      licenseConfidence: 1,
      needsConfirmation: false,
      confirmationCodes: [],
      confirmedAt: null,
      promotedAt: null,
      diffVerdict: isUpdate ? 'UPDATE' : i % 3 === 0 ? 'UNCHANGED' : 'INSERT',
      diffAgainst: isUpdate
        ? {
            licenseNo: license,
            fullName: name,
            council: 'MH',
            status: 'ACTIVE',
            validUntil: '2027-03-31',
          }
        : null,
      diffComputedAt: '2026-08-01T11:14:00Z',
    }
  })

  return [...flagged, ...clean].sort((a, b) => a.rowConfidence - b.rowConfidence)
}

/**
 * Rows for a batch that was uploaded during this session, rather than one of
 * the hand written fixtures above.
 *
 * Without this, a freshly uploaded batch showed a staged row count from the
 * extraction simulation and an empty table underneath it, because
 * buildStagingRows only ever answered for b-mh-aug. A count that disagrees with
 * the rows beneath it is the worst thing this console can show: every number on
 * the screen exists to be trusted, and one of them being decorative is not
 * discoverable from the outside.
 *
 * Generated to the exact rowsExtracted the batch reports, so the totals
 * reconcile rather than approximately agreeing.
 *
 * Licence numbers use the NCISM national format, NR/AY/<state>/<7 digits>,
 * because that is what the provisional national registers actually print. The
 * MH/04471/2018 style in the fixture above is the older per council register,
 * kept because the tests pin to it.
 */
export function buildGeneratedRows(
  batchId: string,
  councilCode: string,
  count: number,
  statusAbsent = false,
  /**
   * Which canonical fields the confirmed mapping said this document actually
   * contains. Generated rows carry a value only for those, because a staging
   * row richer than its source document is a lie that then flows into the
   * registry: an expiry date invented here would let a claim auto approve on a
   * date nobody published.
   */
  mappedFields: ReadonlySet<CanonicalField> = new Set(['validUntil']),
): StagingRow[] {
  const licence = (i: number) => `NR/AY/${councilCode}/${String(i + 1).padStart(7, '0')}`

  return Array.from({ length: count }, (_, i): StagingRow => {
    // Roughly one row in three hundred is held, which is the order of magnitude
    // the MH fixture shows and keeps the "needs confirming" filter meaningful
    // rather than either empty or the whole batch.
    const held = i % 311 === 7
    const confusion = FLAGGED[i % FLAGGED.length]
    const name = NAMES[i % NAMES.length] as string
    const scanned = i % 5 === 0

    const raw = held ? licence(i).replace(/0/g, 'O').replace(/1/g, 'I') : licence(i)
    const confidence = held ? (confusion?.confidence ?? 0.66) : scanned ? 0.97 : 1

    const cells = emptyCells()
    cells.licenseNo = cell(raw, held ? null : raw.replace(/\W/g, ''), confidence)
    cells.fullName = cell(name, name, scanned ? 0.95 : 1)
    cells.council = cell(councilName(councilCode), councilCode, 1)
    // No raw value when the register prints no status. The normalized side is
    // still UNKNOWN because registry_records.status is NOT NULL, and the two
    // together are the honest record: we stored a value, the document never
    // gave us one.
    cells.status = statusAbsent
      ? cell(null, 'UNKNOWN', null)
      : cell('ACTIVE', 'ACTIVE', scanned ? 0.96 : 1)
    cells.qualification = cell('B.A.M.S.', 'BAMS', scanned ? 0.92 : 1)
    if (mappedFields.has('validUntil')) {
      cells.validUntil = cell('31/03/2030', '2030-03-31', scanned ? 0.94 : 1)
    }

    return {
      id: `${batchId}-row-${i}`,
      sourcePage: Math.floor(i / 27) + 1,
      sourceRowIndex: i % 27,
      pageClassification: scanned ? 'SCANNED' : 'TEXT_LAYER',
      rawRowText: `${i + 1}   ${raw}   ${name}   B.A.M.S.${statusAbsent ? '' : '   ACTIVE'}`,
      cells,
      rowConfidence: confidence,
      licenseConfidence: confidence,
      needsConfirmation: held,
      confirmationCodes: held ? (confusion?.codes ?? ['OCR_CONFUSABLE_CHARS']) : [],
      confirmedAt: null,
      promotedAt: null,
      // A first import of a register is almost entirely inserts. A few
      // unchanged rows so the verdict filter has something in every bucket.
      diffVerdict: i % 97 === 0 ? 'UNCHANGED' : i % 89 === 0 ? 'UPDATE' : 'INSERT',
      diffAgainst:
        i % 89 === 0
          ? { licenseNo: licence(i), fullName: name, council: councilCode, status: 'ACTIVE' }
          : null,
      diffComputedAt: new Date().toISOString(),
    }
  }).sort((a, b) => a.rowConfidence - b.rowConfidence)
}

export const REJECTS: Record<string, RejectRow[]> = {
  'b-mh-aug': [
    {
      id: 'rej-1',
      sourcePage: 259,
      sourceRowNumber: 11,
      rawRowText: 'MH/O44l2/2Ol8   R?MESH ??? PATIL   B?MS   ???   31/03/2027',
      reasonCode: 'LICENSE_UNREADABLE',
      reasonDetail: 'Per character confidence 0.31 on the licence number, below any threshold that could be corrected by hand with confidence.',
      rowConfidence: 0.31,
    },
    {
      id: 'rej-2',
      sourcePage: 261,
      sourceRowNumber: 3,
      rawRowText: 'MH/05010/2019   K SHINDE   BAMS   Ayurveda   RETIRED   31/03/2025',
      reasonCode: 'UNKNOWN_STATUS_VALUE',
      reasonDetail: '"RETIRED" is not in the profile status vocabulary. Add it to the profile and reparse, or reject the row. It is never defaulted.',
      rowConfidence: 0.86,
    },
    {
      id: 'rej-3',
      sourcePage: 263,
      sourceRowNumber: 7,
      rawRowText: 'MH/05233/2020   D N WAGHMARE   BAMS   Ayurveda   ACTIVE   03/04/2019',
      reasonCode: 'AMBIGUOUS_DATE',
      reasonDetail: '03/04/2019 is resolvable only if the register writes day first. The profile says DMY but this value predates the registration date under that reading, so it is contradictory rather than merely ambiguous.',
      rowConfidence: 0.79,
    },
  ],
}

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------

export const ACCURACY: AccuracyReport = {
  batchesCovered: 3,
  rowsReviewed: 1_284,
  byField: [
    { field: 'licenseNo', extractedCount: 1284, correctedCount: 31, accuracy: 0.9759, highConfidenceMisses: 2 },
    { field: 'fullName', extractedCount: 1284, correctedCount: 44, accuracy: 0.9657, highConfidenceMisses: 5 },
    { field: 'status', extractedCount: 1284, correctedCount: 9, accuracy: 0.993, highConfidenceMisses: 0 },
    { field: 'validUntil', extractedCount: 1281, correctedCount: 17, accuracy: 0.9867, highConfidenceMisses: 1 },
    { field: 'qualification', extractedCount: 1190, correctedCount: 61, accuracy: 0.9487, highConfidenceMisses: 3 },
    { field: 'specialty', extractedCount: 1104, correctedCount: 22, accuracy: 0.9801, highConfidenceMisses: 0 },
    { field: 'council', extractedCount: 1284, correctedCount: 0, accuracy: 1, highConfidenceMisses: 0 },
    { field: 'registrationDate', extractedCount: 902, correctedCount: 14, accuracy: 0.9845, highConfidenceMisses: 1 },
  ],
  byClassification: [
    { classification: 'TEXT_LAYER', rowsReviewed: 812, correctedCount: 6, accuracy: 0.9926 },
    { classification: 'SCANNED', rowsReviewed: 472, correctedCount: 192, accuracy: 0.9276 },
    { classification: 'UNREADABLE', rowsReviewed: 0, correctedCount: 0, accuracy: 1 },
  ],
  recentCorrections: [
    { id: 'c1', batchLabel: 'council-2026-08-01', field: 'licenseNo', extractedValue: 'MH/O4471/2O18', correctedValue: 'MH/04471/2018', extractedConfidence: 0.61, sourcePage: 256, pageClassification: 'SCANNED', correctedAt: '2026-08-04T14:02:00Z' },
    { id: 'c2', batchLabel: 'council-2026-08-01', field: 'fullName', extractedValue: 'RAJESH M DESHMUK', correctedValue: 'RAJESH M DESHMUKH', extractedConfidence: 0.97, sourcePage: 259, pageClassification: 'SCANNED', correctedAt: '2026-08-04T13:58:00Z' },
    { id: 'c3', batchLabel: 'council-2026-08-01', field: 'qualification', extractedValue: 'BAMS MD Ayu', correctedValue: 'BAMS, MD (Ayu)', extractedConfidence: 0.82, sourcePage: 260, pageClassification: 'SCANNED', correctedAt: '2026-08-04T13:51:00Z' },
    { id: 'c4', batchLabel: 'karnataka-2026-Q2', field: 'validUntil', extractedValue: '31.03.2O27', correctedValue: '31.03.2027', extractedConfidence: 0.66, sourcePage: 44, pageClassification: 'SCANNED', correctedAt: '2026-08-03T10:22:00Z' },
    { id: 'c5', batchLabel: 'council-2026-07-14', field: 'fullName', extractedValue: 'PRIYA N KULKARNI SHINDE', correctedValue: 'PRIYA N KULKARNI', extractedConfidence: 1, sourcePage: 88, pageClassification: 'TEXT_LAYER', correctedAt: '2026-07-14T11:40:00Z' },
  ],
}
