import { apiRequest } from '@/lib/apiClient'
import type { Page } from '@/types/api'
import type {
  AccuracyReport,
  Council,
  ImportBatchDetail,
  ImportBatchSummary,
  ImportPageRow,
  MappingConfirmation,
  MappingProposal,
  ParserProfile,
  PromoteRequest,
  PromoteResponse,
  RegistryFilter,
  RegistryRecord,
  RegistrySummary,
  RejectRow,
  RowCorrection,
  StagingFilter,
  StagingRow,
} from '../types'

export const BATCH_PAGE_SIZE = 25
export const STAGING_PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export function fetchBatches(page: number): Promise<Page<ImportBatchSummary>> {
  const params = new URLSearchParams({
    page: String(page),
    size: String(BATCH_PAGE_SIZE),
    sort: 'createdAt,desc',
  })
  return apiRequest<Page<ImportBatchSummary>>(`/api/v1/admin/imports?${params}`)
}

export function fetchBatch(batchId: string): Promise<ImportBatchDetail> {
  return apiRequest<ImportBatchDetail>(`/api/v1/admin/imports/${batchId}`)
}

export function fetchPages(batchId: string): Promise<ImportPageRow[]> {
  return apiRequest<ImportPageRow[]>(`/api/v1/admin/imports/${batchId}/pages`)
}

/**
 * Upload goes through the browser's own multipart encoding rather than
 * apiRequest, because apiRequest pins Content-Type to application/json and a
 * multipart body needs the boundary the browser generates.
 *
 * A presigned direct-to-storage upload is the right shape once files are large
 * and the app is deployed. Locally the PDF goes through Spring, which keeps
 * MinIO credentials out of the browser entirely and is one fewer moving part
 * while the pipeline is being built.
 */
export async function createBatch(input: {
  file: File
  label: string
  councilCode: string
  profileId: string | null
}): Promise<ImportBatchDetail> {
  const form = new FormData()
  form.append('file', input.file)
  form.append('label', input.label)
  form.append('councilCode', input.councilCode)
  if (input.profileId) form.append('profileId', input.profileId)

  const response = await fetch('/api/v1/admin/imports', {
    method: 'POST',
    body: form,
    headers: authHeader(),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw Object.assign(new Error(body?.message ?? 'Upload failed'), {
      status: response.status,
      body,
    })
  }
  return (await response.json()) as ImportBatchDetail
}

function authHeader(): Record<string, string> {
  const token = sessionStorage.getItem('hi.accessToken')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Starts the cheap classification pass. Idempotent while CLASSIFYING. */
export function startClassification(batchId: string): Promise<ImportBatchDetail> {
  return apiRequest<ImportBatchDetail>(`/api/v1/admin/imports/${batchId}/classify`, {
    method: 'POST',
  })
}

/**
 * Acknowledges the classification breakdown and starts extraction. Separate
 * from classification on purpose: a register that came back 100 percent scanned
 * will extract far worse, and the admin should learn that before waiting out a
 * 400 page OCR run rather than after.
 */
export function startExtraction(batchId: string): Promise<ImportBatchDetail> {
  return apiRequest<ImportBatchDetail>(`/api/v1/admin/imports/${batchId}/extract`, {
    method: 'POST',
  })
}

export function cancelBatch(batchId: string): Promise<ImportBatchDetail> {
  return apiRequest<ImportBatchDetail>(`/api/v1/admin/imports/${batchId}/cancel`, {
    method: 'POST',
  })
}

export function retryExtraction(batchId: string): Promise<ImportBatchDetail> {
  return apiRequest<ImportBatchDetail>(`/api/v1/admin/imports/${batchId}/retry`, {
    method: 'POST',
  })
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export function fetchMapping(batchId: string): Promise<MappingProposal> {
  return apiRequest<MappingProposal>(`/api/v1/admin/imports/${batchId}/mapping`)
}

export function confirmMapping(
  batchId: string,
  body: MappingConfirmation,
): Promise<ImportBatchDetail> {
  return apiRequest<ImportBatchDetail>(`/api/v1/admin/imports/${batchId}/mapping`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Staging rows
// ---------------------------------------------------------------------------

export function buildStagingParams(filter: StagingFilter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.needsConfirmationOnly) params.set('needsConfirmation', 'true')
  for (const verdict of filter.verdicts) params.append('verdict', verdict)
  if (filter.q) params.set('q', filter.q)
  params.set('page', String(filter.page))
  params.set('size', String(STAGING_PAGE_SIZE))
  // Worst first, always. The admin's time is best spent on the rows the parser
  // was least sure about, and scrolling past good rows to find them is how a
  // bad row gets promoted.
  params.set('sort', 'rowConfidence,asc')
  return params
}

export function fetchStaging(
  batchId: string,
  filter: StagingFilter,
): Promise<Page<StagingRow>> {
  return apiRequest<Page<StagingRow>>(
    `/api/v1/admin/imports/${batchId}/staging?${buildStagingParams(filter)}`,
  )
}

/**
 * Correcting a field re-normalizes it on the Spring side and clears the row's
 * diff, so the row comes back with diffComputedAt null and a stale verdict.
 * That is deliberate: a corrected license number changes the natural key, which
 * can flip an INSERT into an UPDATE, and promoting from the pre-correction diff
 * would write the row to the wrong place.
 */
export function correctRow(
  batchId: string,
  rowId: string,
  corrections: RowCorrection[],
): Promise<StagingRow> {
  return apiRequest<StagingRow>(`/api/v1/admin/imports/${batchId}/staging/${rowId}`, {
    method: 'PATCH',
    body: JSON.stringify({ corrections }),
  })
}

/** Accepts a flagged row as extracted, without changing any value. */
export function confirmRow(batchId: string, rowId: string): Promise<StagingRow> {
  return apiRequest<StagingRow>(`/api/v1/admin/imports/${batchId}/staging/${rowId}/confirm`, {
    method: 'POST',
  })
}

/** Recomputes every stale diff in the batch. Required before promotion. */
export function recomputeDiff(batchId: string): Promise<ImportBatchDetail> {
  return apiRequest<ImportBatchDetail>(`/api/v1/admin/imports/${batchId}/diff`, {
    method: 'POST',
  })
}

export function fetchRejects(batchId: string): Promise<RejectRow[]> {
  return apiRequest<RejectRow[]>(`/api/v1/admin/imports/${batchId}/rejects`)
}

export function promoteBatch(batchId: string, body: PromoteRequest): Promise<PromoteResponse> {
  return apiRequest<PromoteResponse>(`/api/v1/admin/imports/${batchId}/promote`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Profiles and accuracy
// ---------------------------------------------------------------------------

export const REGISTRY_PAGE_SIZE = 50

export function buildRegistryParams(filter: RegistryFilter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.q) params.set('q', filter.q)
  if (filter.council) params.set('council', filter.council)
  if (filter.status) params.set('status', filter.status)
  params.set('page', String(filter.page))
  params.set('size', String(REGISTRY_PAGE_SIZE))
  return params
}

export function fetchRegistry(filter: RegistryFilter): Promise<Page<RegistryRecord>> {
  return apiRequest<Page<RegistryRecord>>(`/api/v1/admin/registry?${buildRegistryParams(filter)}`)
}

export function fetchRegistrySummary(): Promise<RegistrySummary> {
  return apiRequest<RegistrySummary>('/api/v1/admin/registry/summary')
}

export function fetchProfiles(): Promise<ParserProfile[]> {
  return apiRequest<ParserProfile[]>('/api/v1/admin/profiles')
}

/**
 * The councils table from V2, which is the authoritative list of codes a batch
 * or a staging row may carry. Served rather than hardcoded in the client for the
 * same reason it is a table rather than a Java enum: adding a council is a
 * migration, not a redeploy, and a stale copy in the browser would offer a code
 * the FK will reject.
 */
export function fetchCouncils(): Promise<Council[]> {
  return apiRequest<Council[]>('/api/v1/admin/councils')
}

export function fetchAccuracy(): Promise<AccuracyReport> {
  return apiRequest<AccuracyReport>('/api/v1/admin/accuracy')
}
