/**
 * Registry import types. Admin only, and they carry raw registry data plus
 * extraction internals, so nothing in here may be reused by a practitioner
 * facing view.
 *
 * Mirrors the V3 migration and the /api/v1/admin/imports contract. Hand
 * maintained, same caveat as types/caseStatus.ts: if it drifts from the Java
 * side, generate it from /v3/api-docs rather than trying harder to remember.
 */

/**
 * Mirrors the import_batch status CHECK constraint.
 *
 * Two of these exist only because a human has to answer something mid flow:
 * AWAITING_CLASSIFY_OK holds while the page breakdown is read, AWAITING_MAPPING
 * holds while the column mapping is confirmed. The brief's original five state
 * lifecycle could not express either without blocking a request on a person.
 */
export const BATCH_STATUS = [
  'UPLOADED',
  'CLASSIFYING',
  'AWAITING_CLASSIFY_OK',
  'CLASSIFY_FAILED',
  'AWAITING_MAPPING',
  'PARSING',
  'PARSED',
  'AWAITING_PROMOTE_OK',
  'PARSE_FAILED',
  'PROMOTING',
  /**
   * Some rows reached the registry, some are still staged waiting on a human.
   * Not terminal: the batch is not finished, and the held rows are exactly the
   * ones someone still has to read.
   */
  'PARTIALLY_PROMOTED',
  'PROMOTED',
  'PROMOTE_FAILED',
  'CANCELLED',
] as const

export type BatchStatus = (typeof BATCH_STATUS)[number]

/** Statuses where the batch is doing work and the screen should keep polling. */
export const RUNNING_STATUSES: readonly BatchStatus[] = ['CLASSIFYING', 'PARSING', 'PROMOTING']

/** Statuses where nothing moves until this admin does something. */
export const AWAITING_HUMAN_STATUSES: readonly BatchStatus[] = [
  'UPLOADED',
  'AWAITING_CLASSIFY_OK',
  'AWAITING_MAPPING',
  'AWAITING_PROMOTE_OK',
  'PARTIALLY_PROMOTED',
]

export const TERMINAL_STATUSES: readonly BatchStatus[] = [
  'PROMOTED',
  'CANCELLED',
  'CLASSIFY_FAILED',
]

export type PageClassification = 'TEXT_LAYER' | 'SCANNED' | 'UNREADABLE'

export type PageAnomaly =
  | 'ZERO_ROWS'
  | 'LOW_ROW_COUNT'
  | 'LOW_OCR_CONFIDENCE'
  | 'COLUMN_DRIFT'
  | 'NO_TABLE_FOUND'
  | 'ROTATED'

export type DiffVerdict = 'INSERT' | 'UPDATE' | 'UNCHANGED' | 'CONFLICT'

export type TableMode = 'LATTICE' | 'STREAM' | 'AUTO'

/**
 * Why a row is held for confirmation. Distinct codes rather than one boolean,
 * because "the OCR was unsure" and "this does not look like a license number
 * from this register" need different things looked at.
 */
export type ConfirmationCode =
  | 'LOW_LICENSE_CONFIDENCE'
  | 'LICENSE_FORMAT_MISMATCH'
  | 'OCR_CONFUSABLE_CHARS'
  | 'AMBIGUOUS_DATE'
  | 'UNKNOWN_STATUS_VALUE'
  | 'LOW_ROW_CONFIDENCE'

/** Distinct, actionable failures. Never a generic 500 rendered as "error". */
export type BatchFailureCode =
  | 'ENCRYPTED_PDF'
  | 'NO_READABLE_PAGES'
  | 'PROFILE_SHAPE_MISMATCH'
  | 'EXTRACTOR_TIMEOUT'
  | 'EXTRACTOR_UNAVAILABLE'
  | 'EXTRACTOR_ERROR'
  | 'PROMOTE_CONSTRAINT_VIOLATION'

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/** One row of the councils table. The council list is data, not a Java enum. */
export interface Council {
  code: string
  canonicalName: string
}

/** Row shape for the batch list. Deliberately narrower than the detail. */
export interface ImportBatchSummary {
  id: string
  label: string
  status: BatchStatus
  /**
   * Which council this register belongs to, chosen at upload.
   *
   * A property of the batch rather than of a row, because a council publishes
   * its own register and does not reprint its name on every line. Most registers
   * therefore have no council column at all, and requiring one made the mapping
   * screen unfinishable for exactly the documents it exists to handle.
   */
  councilCode: string
  profileName: string | null
  sourceFilename: string
  pageCount: number | null
  rowsExtracted: number
  rowsRejected: number
  needsConfirmationCount: number
  /**
   * Rows already written to the registry. With partial promotion a batch
   * reaches the registry in several passes, so rowsExtracted alone no longer
   * says how much of it is live.
   */
  rowsPromoted: number
  /**
   * Rows corrected since the diff last ran, so their verdict no longer
   * describes them. Counted server side over the whole batch, never derived
   * from the page of rows on screen: a corrected row usually drops out of the
   * "needs confirming" filter, and a warning that disappears the moment you
   * cause the problem is worse than no warning.
   */
  staleDiffCount: number
  createdAt: string
  uploadedBy: string
}

export interface ClassificationBreakdown {
  pageCount: number
  textLayerPages: number
  scannedPages: number
  unreadablePages: number
  rotatedPages: number
}

/**
 * Reconciliation. declaredRowCount is what the document says about itself, when
 * it says anything. The gap is the number that catches silent partial
 * extraction, which is the failure that causes mass revocation downstream.
 */
export interface Reconciliation {
  declaredRowCount: number | null
  extractedRowCount: number
  rejectedRowCount: number
  /** extracted + rejected - declared. Null when the document declared nothing. */
  gap: number | null
  meanRowsPerPage: number
  anomalousPageCount: number
}

export interface ImportBatchDetail extends ImportBatchSummary {
  profileId: string | null
  sourceSha256: string
  sourceBytes: number
  classification: ClassificationBreakdown | null
  reconciliation: Reconciliation | null
  pagesDone: number
  failureCode: BatchFailureCode | null
  failureDetail: string | null
  extractionStartedAt: string | null
  extractionHeartbeatAt: string | null
  promotedAt: string | null
  promotedBy: string | null
  promoteReason: string | null
  updatedAt: string
}

export interface ImportPageRow {
  pageNumber: number
  classification: PageClassification
  charCount: number | null
  rotationDegrees: number
  tableModeUsed: TableMode | null
  rowsExtracted: number
  meanOcrConfidence: number | null
  pageConfidence: number | null
  anomalyCode: PageAnomaly | null
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/** The canonical fields a detected column can be mapped onto. */
export const CANONICAL_FIELDS = [
  'licenseNo',
  'fullName',
  'council',
  'status',
  'specialty',
  'qualification',
  'registrationDate',
  'validUntil',
] as const

export type CanonicalField = (typeof CANONICAL_FIELDS)[number]

export interface DetectedColumn {
  index: number
  headerText: string
  /** A few cells from this column, so a header of "Reg." can be identified. */
  sampleValues: string[]
  /** What the server proposes. Never applied without confirmation. */
  proposedField: CanonicalField | null
  proposalConfidence: number
}

export interface MappingProposal {
  batchId: string
  profileName: string | null
  /**
   * The council carried by the batch. Echoed back here so the mapping screen can
   * show what every row will be stamped with without a second request, and so it
   * can say where that value came from rather than presenting it as a fact.
   */
  councilCode: string
  councilName: string
  detectedColumns: DetectedColumn[]
  /** Set when this document's headers do not match the profile's patterns. */
  shapeMismatch: {
    expected: string[]
    found: string[]
    detail: string
  } | null
}

export interface MappingConfirmation {
  /** Column index -> canonical field. Unmapped columns are simply absent. */
  columnMap: Record<number, CanonicalField>
  /** True writes the confirmed mapping back onto the profile for next time. */
  saveToProfile: boolean
  /**
   * The admin asserting that this register does not publish a standing status
   * at all, so every row promotes as UNKNOWN.
   *
   * Deliberately an assertion rather than an inference from "no column was
   * mapped". A forgotten mapping and a register that genuinely prints no status
   * look identical in the column map, and they need opposite outcomes: one is a
   * mistake to catch, the other is the document being what it is. The NCISM
   * provisional national registers are the second kind.
   */
  statusAbsent: boolean
}

// ---------------------------------------------------------------------------
// Staging rows and the diff preview
// ---------------------------------------------------------------------------

export interface StagingCell {
  raw: string | null
  normalized: string | null
  confidence: number | null
}

export interface StagingRow {
  id: string
  sourcePage: number
  sourceRowIndex: number
  pageClassification: PageClassification
  rawRowText: string
  cells: Record<CanonicalField, StagingCell>
  rowConfidence: number
  licenseConfidence: number | null
  needsConfirmation: boolean
  confirmationCodes: ConfirmationCode[]
  confirmedAt: string | null
  /** Set once the row reached the registry. Never cleared. */
  promotedAt: string | null
  diffVerdict: DiffVerdict | null
  /** Present when the verdict is UPDATE or CONFLICT: the live row it changes. */
  diffAgainst: Record<string, string | null> | null
  /** Nulled by any correction, which forces a re-diff before promotion. */
  diffComputedAt: string | null
}

export interface StagingFilter {
  needsConfirmationOnly: boolean
  verdicts: DiffVerdict[]
  q: string
  page: number
}

export interface RowCorrection {
  field: CanonicalField
  value: string
}

export interface RejectRow {
  id: string
  sourcePage: number
  sourceRowNumber: number
  rawRowText: string | null
  reasonCode: string
  reasonDetail: string | null
  rowConfidence: number | null
}

export interface PromoteRequest {
  reason: string
  /** Echoed back from the preview so a stale tab cannot promote an old diff. */
  expectedUpdatedAt: string
}

export interface PromoteResponse {
  batchId: string
  status: BatchStatus
  inserted: number
  updated: number
  unchanged: number
  flaggedNotPresent: number
  /**
   * Rows deliberately left staged because they still need a human. Reported
   * rather than inferred: "we promoted 2,583 of 2,592" is a different statement
   * from "we promoted the batch", and an admin closing the tab afterwards needs
   * to know which one just happened.
   */
  held: number
}

// ---------------------------------------------------------------------------
// Parser profiles
// ---------------------------------------------------------------------------

export interface ParserProfile {
  id: string
  name: string
  councilCode: string
  tableMode: TableMode
  headerPatterns: string[]
  columnMap: Record<number, CanonicalField>
  licenseFormatRegex: string
  dateConvention: 'DMY' | 'MDY' | 'YMD'
  datePatterns: string[]
  statusVocabulary: Record<string, string>
  minLicenseCharConfidence: number
  minFieldConfidence: number
  confirmedAt: string | null
  confirmedBy: string | null
  batchCount: number
  updatedAt: string
}

// ---------------------------------------------------------------------------
// The live registry
// ---------------------------------------------------------------------------

/**
 * One promoted registry record: the authoritative rows a claim is matched
 * against. Distinct from a staging row, which is a candidate that has not
 * reached the registry and may never.
 */
export interface RegistryRecord {
  councilCode: string
  licenceRaw: string
  fullNameRaw: string
  status: string
  validUntil: string | null
  specialty: string | null
  sourceBatch: string
}

export interface RegistrySummary {
  totalRows: number
  councils: string[]
  batches: string[]
  byStatus: Record<string, number>
}

export interface RegistryFilter {
  q: string
  council: string
  status: string
  page: number
}

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------

export interface FieldAccuracy {
  field: CanonicalField
  extractedCount: number
  correctedCount: number
  /** 1 - corrected/extracted, over rows an admin actually looked at. */
  accuracy: number
  /**
   * Corrections where the parser reported high confidence and was still wrong.
   * These are calibration bugs and they matter more than the rest: a low
   * confidence miss is the system working, a high confidence miss is the
   * system lying.
   */
  highConfidenceMisses: number
}

export interface AccuracyReport {
  batchesCovered: number
  rowsReviewed: number
  byField: FieldAccuracy[]
  byClassification: {
    classification: PageClassification
    rowsReviewed: number
    correctedCount: number
    accuracy: number
  }[]
  recentCorrections: {
    id: string
    batchLabel: string
    field: CanonicalField
    extractedValue: string | null
    correctedValue: string
    extractedConfidence: number | null
    sourcePage: number
    pageClassification: PageClassification
    correctedAt: string
  }[]
}
