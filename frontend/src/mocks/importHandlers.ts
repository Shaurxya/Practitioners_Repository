import { HttpResponse, http } from 'msw'
import type {
  CanonicalField,
  ImportBatchDetail,
  PageClassification,
  ParserProfile,
  RowCorrection,
  StagingRow,
} from '@/features/registry-import/types'
import { CANONICAL_FIELDS as CANONICAL_FIELD_LIST } from '@/features/registry-import/types'
import {
  addRegistryRows,
  licenceKeys,
  normalizeName,
  queryRegistry,
  registrySummary,
  resetRegistry,
} from './verificationEngine'
import {
  BATCHES,
  COUNCILS,
  PROFILES,
  REJECTS,
  buildGeneratedRows,
  buildStagingRows,
  mappingFor,
  pagesFor,
} from './importFixtures'

/**
 * Mock registry import API.
 *
 * Stateful within a session so the lifecycle can actually be walked: classify,
 * confirm, extract, correct a licence number, watch the diff go stale, recompute
 * it, promote. A mock that returns a fixed payload proves the table renders and
 * nothing else, and every bug worth finding in this panel is in a transition.
 *
 * Deletes when the Spring endpoints land, same as the rest of mocks/.
 */

/**
 * Empty at boot. The imports list shows the registers this admin uploaded, not
 * six invented ones. Tests opt back in with resetImportMockData(true), because
 * the six fixtures exist to exercise specific failures and that is a different
 * job from populating a product.
 */
let batches: ImportBatchDetail[] = []
let staging: Record<string, StagingRow[]> = {}
/**
 * Every field an admin fixed, with the confidence the parser reported when it
 * got it wrong. This is the accuracy dataset, and it is the only honest way to
 * know whether a parser change improved anything: without a before and after on
 * the same documents, a parser change is a feeling.
 *
 * A high confidence correction is a calibration bug and matters more than a low
 * confidence one, which is the system working as designed.
 */
interface CorrectionRecord {
  id: string
  batchId: string
  batchLabel: string
  field: CanonicalField
  extractedValue: string | null
  correctedValue: string
  extractedConfidence: number | null
  sourcePage: number
  pageClassification: PageClassification
  correctedAt: string
}

let corrections: CorrectionRecord[] = []

/**
 * Which batches the admin asserted publish no status. Kept beside the batches
 * rather than on ImportBatchDetail, because the real thing records it on the
 * parser profile and inventing an API field here would be a contract this mock
 * has no business writing.
 */
let statusAbsentByBatch: Record<string, boolean> = {}

/** The confirmed mapping's canonical fields, so generated rows match the document. */
let mappedFieldsByBatch: Record<string, Set<CanonicalField>> = {}

/**
 * Parser profiles, empty at boot like everything else.
 *
 * A profile is not reference data, it is a record of a decision this admin made
 * about a real document. Two invented ones on the profiles screen suggested the
 * system already knew how to read two registers it had never seen.
 */
let profiles: ParserProfile[] = []

export function resetImportMockData(seeded = false) {
  batches = seeded ? structuredClone(BATCHES) : []
  staging = seeded ? { 'b-mh-aug': buildStagingRows('b-mh-aug') } : {}
  corrections = []
  statusAbsentByBatch = {}
  mappedFieldsByBatch = {}
  profiles = seeded ? structuredClone(PROFILES) : []
  // The live registry is built by promotion, so resetting the batches without
  // resetting it would leave rows behind with no batch that explains them.
  resetRegistry()
}

const notFound = () =>
  HttpResponse.json(
    { code: 'NOT_FOUND', message: 'No such batch', timestamp: new Date().toISOString() },
    { status: 404 },
  )

function find(id: string): ImportBatchDetail | undefined {
  return batches.find((b) => b.id === id)
}

function patch(id: string, next: Partial<ImportBatchDetail>): ImportBatchDetail | undefined {
  const index = batches.findIndex((b) => b.id === id)
  const current = batches[index]
  if (index < 0 || !current) return undefined
  const updated = { ...current, ...next, updatedAt: new Date().toISOString() }
  batches[index] = updated
  return updated
}

/**
 * Advances a running extraction a little on every read, so the progress bar and
 * the polling interval can be seen doing something. The real progress comes
 * from the sidecar's callbacks; this stands in for them.
 */
function tick(batch: ImportBatchDetail): ImportBatchDetail {
  if (batch.status !== 'PARSING' || !batch.pageCount) return batch
  const pagesDone = Math.min(batch.pageCount, batch.pagesDone + 3)
  const done = pagesDone >= batch.pageCount
  return (
    patch(batch.id, {
      pagesDone,
      rowsExtracted: batch.rowsExtracted + 3 * 27,
      extractionHeartbeatAt: new Date().toISOString(),
      ...(done ? { status: 'AWAITING_PROMOTE_OK' as const } : {}),
    }) ?? batch
  )
}

function toSummary(batch: ImportBatchDetail) {
  return {
    id: batch.id,
    label: batch.label,
    status: batch.status,
    councilCode: batch.councilCode,
    profileName: batch.profileName,
    sourceFilename: batch.sourceFilename,
    pageCount: batch.pageCount,
    rowsExtracted: batch.rowsExtracted,
    rowsRejected: batch.rowsRejected,
    needsConfirmationCount: batch.needsConfirmationCount,
    rowsPromoted: batch.rowsPromoted,
    staleDiffCount: batch.staleDiffCount,
    createdAt: batch.createdAt,
    uploadedBy: batch.uploadedBy,
  }
}

/**
 * Materialises staged rows the first time a batch is asked for them.
 *
 * A batch uploaded during this session has no hand written fixture, and before
 * this it got an empty array: the diff preview then showed "2,592 staged rows"
 * above "No rows match these filters". Generating on demand rather than at
 * upload keeps the extraction simulation honest, since rowsExtracted is still
 * climbing while the batch is PARSING and only settles when it finishes.
 */
function ensureStaging(batchId: string) {
  if (staging[batchId]) return
  const batch = find(batchId)
  if (!batch || batch.rowsExtracted === 0) return
  // Not while extraction is still running: rowsExtracted is climbing, and
  // generating against a half finished count would freeze the batch at whatever
  // it happened to be when the first request landed.
  if (batch.status === 'PARSING' || batch.status === 'CLASSIFYING') return

  staging[batchId] = buildGeneratedRows(
    batchId,
    batch.councilCode,
    batch.rowsExtracted,
    statusAbsentByBatch[batchId] ?? false,
    mappedFieldsByBatch[batchId],
  )
  syncCounts(batchId)
}

/**
 * Recomputes the batch's counters from the rows themselves. Both are batch wide
 * on purpose: the client must never derive them from the page of rows it
 * happens to be showing, because filters hide exactly the rows that matter.
 */
function syncCounts(batchId: string) {
  // Only rows still staged. A promoted row can neither need confirming nor have
  // a stale diff any more, and counting it would leave the blockers on screen
  // permanently after the first partial promotion.
  const rows = (staging[batchId] ?? []).filter((r) => r.promotedAt === null)
  patch(batchId, {
    needsConfirmationCount: rows.filter((r) => r.needsConfirmation && r.confirmedAt === null).length,
    staleDiffCount: rows.filter((r) => r.diffComputedAt === null).length,
  })
}

export const importHandlers = [
  // ---- batches -----------------------------------------------------------
  http.get('/api/v1/admin/imports', ({ request }) => {
    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '0')
    const size = Number(url.searchParams.get('size') ?? '25')

    batches.filter((b) => b.status === 'PARSING').forEach(tick)

    const sorted = [...batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const start = page * size
    return HttpResponse.json({
      content: sorted.slice(start, start + size).map(toSummary),
      totalElements: sorted.length,
      totalPages: Math.max(1, Math.ceil(sorted.length / size)),
      number: page,
      size,
    })
  }),

  http.post('/api/v1/admin/imports', async ({ request }) => {
    const form = await request.formData()
    const label = String(form.get('label') ?? 'untitled')
    const profileId = form.get('profileId') ? String(form.get('profileId')) : null
    const file = form.get('file') as File | null

    // Half the natural key, so a batch without one cannot produce a promotable
    // row. Rejected here rather than surfacing five screens later.
    const councilCode = String(form.get('councilCode') ?? '')
    if (!COUNCILS.some((c) => c.code === councilCode)) {
      return HttpResponse.json(
        {
          code: 'UNKNOWN_COUNCIL',
          message: 'Pick a council. Every promoted row is keyed on it.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      )
    }

    const created: ImportBatchDetail = {
      ...structuredClone(BATCHES[2] as ImportBatchDetail),
      id: crypto.randomUUID(),
      label,
      councilCode,
      profileId,
      // The live list, not the fixture: a profile picked at upload is one this
      // admin created by confirming a mapping earlier.
      profileName: profiles.find((p) => p.id === profileId)?.name ?? null,
      sourceFilename: file?.name ?? `${label}.pdf`,
      sourceBytes: file?.size ?? 0,
      sourceSha256: crypto.randomUUID().replace(/-/g, '').repeat(2).slice(0, 64),
      status: 'CLASSIFYING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    batches = [created, ...batches]

    // Classification is the cheap pass, so it finishes quickly and the batch
    // lands on the screen that asks the admin to look at the page mix.
    setTimeout(() => patch(created.id, { status: 'AWAITING_CLASSIFY_OK' }), 1200)
    return HttpResponse.json(created, { status: 201 })
  }),

  http.get('/api/v1/admin/imports/:batchId', ({ params }) => {
    const id = String(params['batchId'])
    const batch = find(id)
    if (!batch) return notFound()
    const ticked = tick(batch)
    // After the tick, so a batch that just finished parsing gets its rows and
    // its needsConfirmation count in the same response that reports it done.
    ensureStaging(id)
    return HttpResponse.json(find(id) ?? ticked)
  }),

  http.get('/api/v1/admin/imports/:batchId/pages', ({ params }) =>
    HttpResponse.json(pagesFor(String(params['batchId']))),
  ),

  http.post('/api/v1/admin/imports/:batchId/classify', ({ params }) => {
    const updated = patch(String(params['batchId']), { status: 'CLASSIFYING' })
    return updated ? HttpResponse.json(updated) : notFound()
  }),

  http.post('/api/v1/admin/imports/:batchId/extract', ({ params }) => {
    const id = String(params['batchId'])
    const batch = find(id)
    if (!batch) return notFound()

    // Without a confirmed profile the mapping has to be settled first. This is
    // the branch the AWAITING_MAPPING state exists for.
    const next = batch.profileId ? 'PARSING' : 'AWAITING_MAPPING'
    return HttpResponse.json(
      patch(id, {
        status: next,
        ...(next === 'PARSING'
          ? {
              pagesDone: 0,
              rowsExtracted: 0,
              extractionStartedAt: new Date().toISOString(),
              extractionHeartbeatAt: new Date().toISOString(),
            }
          : {}),
      }),
    )
  }),

  http.post('/api/v1/admin/imports/:batchId/cancel', ({ params }) => {
    const updated = patch(String(params['batchId']), { status: 'CANCELLED' })
    return updated ? HttpResponse.json(updated) : notFound()
  }),

  http.post('/api/v1/admin/imports/:batchId/retry', ({ params }) => {
    const updated = patch(String(params['batchId']), {
      status: 'PARSING',
      failureCode: null,
      failureDetail: null,
      pagesDone: 0,
      rowsExtracted: 0,
      extractionStartedAt: new Date().toISOString(),
      extractionHeartbeatAt: new Date().toISOString(),
    })
    return updated ? HttpResponse.json(updated) : notFound()
  }),

  // ---- mapping -----------------------------------------------------------
  http.get('/api/v1/admin/imports/:batchId/mapping', ({ params }) => {
    const id = String(params['batchId'])
    return HttpResponse.json(mappingFor(id, find(id)?.councilCode ?? 'MH'))
  }),

  http.post('/api/v1/admin/imports/:batchId/mapping', async ({ params, request }) => {
    const id = String(params['batchId'])
    const body = (await request.json().catch(() => null)) as {
      statusAbsent?: boolean
      saveToProfile?: boolean
      columnMap?: Record<string, CanonicalField>
    } | null
    statusAbsentByBatch[id] = body?.statusAbsent === true
    mappedFieldsByBatch[id] = new Set(Object.values(body?.columnMap ?? {}))

    /**
     * Confirming a mapping is what creates a profile. That is the only context
     * in which these values can be judged, which is why the profiles screen is
     * read only: editing a licence regex blind there is how you break next
     * quarter's import without noticing.
     */
    const batch = find(id)
    if (batch && body?.saveToProfile !== false) {
      const columnMap = body?.columnMap ?? {}
      profiles = [
        {
          id: crypto.randomUUID(),
          // Named for the register shape, not the batch that revealed it. A
          // profile is reused by every future upload of this register, so
          // "ga-2026-08-05" would date a thing that outlives that date.
          name: `${batch.councilCode.toLowerCase()}-register`,
          councilCode: batch.councilCode,
          tableMode: 'AUTO',
          headerPatterns: [],
          columnMap: Object.fromEntries(
            Object.entries(columnMap).map(([index, field]) => [Number(index), field]),
          ) as Record<number, CanonicalField>,
          licenseFormatRegex: '',
          dateConvention: 'DMY',
          datePatterns: ['DD/MM/YYYY'],
          // Empty on purpose. A status not in this map is a reject, and there is
          // no default, because a defaulted status is how a suspended
          // practitioner reads as active.
          statusVocabulary: {},
          minLicenseCharConfidence: 0.95,
          minFieldConfidence: 0.7,
          confirmedAt: new Date().toISOString(),
          confirmedBy: 'shaurya',
          batchCount: 1,
          updatedAt: new Date().toISOString(),
        },
        ...profiles.filter((p) => p.councilCode !== batch.councilCode),
      ]
    }

    const updated = patch(id, {
      status: 'PARSING',
      profileName: find(id)?.profileName ?? 'new-profile',
      pagesDone: 0,
      rowsExtracted: 0,
      extractionStartedAt: new Date().toISOString(),
      extractionHeartbeatAt: new Date().toISOString(),
    })
    return updated ? HttpResponse.json(updated) : notFound()
  }),

  // ---- staging rows ------------------------------------------------------
  http.get('/api/v1/admin/imports/:batchId/staging', ({ params, request }) => {
    const id = String(params['batchId'])
    ensureStaging(id)
    const url = new URL(request.url)
    const page = Number(url.searchParams.get('page') ?? '0')
    const size = Number(url.searchParams.get('size') ?? '50')
    const needsConfirmation = url.searchParams.get('needsConfirmation') === 'true'
    const verdicts = url.searchParams.getAll('verdict')
    const q = (url.searchParams.get('q') ?? '').toLowerCase()

    // Promoted rows leave the staging list. They are not deleted, and
    // promoted_at still records them, but this screen answers "what is left to
    // decide" and a promoted row is not that. Without this, a partially
    // promoted batch shows 2,592 rows of which all but 9 are already live.
    let rows = (staging[id] ?? []).filter((r) => r.promotedAt === null)
    if (needsConfirmation) rows = rows.filter((r) => r.needsConfirmation && r.confirmedAt === null)
    if (verdicts.length > 0) rows = rows.filter((r) => r.diffVerdict && verdicts.includes(r.diffVerdict))
    if (q) {
      rows = rows.filter(
        (r) =>
          (r.cells.licenseNo.raw ?? '').toLowerCase().includes(q) ||
          (r.cells.fullName.raw ?? '').toLowerCase().includes(q),
      )
    }
    // Worst first, which is what the endpoint promises regardless of the sort
    // parameter the client sent.
    rows = [...rows].sort((a, b) => a.rowConfidence - b.rowConfidence)

    const start = page * size
    return HttpResponse.json({
      content: rows.slice(start, start + size),
      totalElements: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / size)),
      number: page,
      size,
    })
  }),

  http.patch('/api/v1/admin/imports/:batchId/staging/:rowId', async ({ params, request }) => {
    const id = String(params['batchId'])
    const rowId = String(params['rowId'])
    const body = (await request.json()) as { corrections: RowCorrection[] }

    const rows = staging[id] ?? []
    const index = rows.findIndex((r) => r.id === rowId)
    const row = rows[index]
    if (!row) return notFound()

    const cells = { ...row.cells }
    for (const correction of body.corrections) {
      // A field re-typed to the value it already held is not a parser error.
      // Recording it would count against accuracy and, when the parser had been
      // confident, against the calibration bug total, which is the number most
      // likely to be acted on. Confirming a row is how you say "this was right".
      const unchanged = (cells[correction.field]?.raw ?? null) === correction.value
      if (unchanged) continue

      corrections.push({
        id: crypto.randomUUID(),
        batchId: id,
        batchLabel: find(id)?.label ?? id,
        field: correction.field,
        extractedValue: cells[correction.field]?.raw ?? null,
        correctedValue: correction.value,
        extractedConfidence: cells[correction.field]?.confidence ?? null,
        sourcePage: row.sourcePage,
        // Denormalized on purpose. The question this dataset answers is "are
        // scanned pages worse than text pages, and by how much", and that has
        // to stay answerable after a reparse rewrites the page table.
        pageClassification: row.pageClassification,
        correctedAt: new Date().toISOString(),
      })
      cells[correction.field] = {
        raw: correction.value,
        // The Java Normalizer produces this, never the browser and never the
        // Python side. Stubbed here as uppercase so the round trip is visible.
        normalized: correction.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
        confidence: 1,
      }
    }

    const updated: StagingRow = {
      ...row,
      cells,
      // A corrected row is confirmed by definition: a human just looked at it.
      needsConfirmation: false,
      confirmedAt: new Date().toISOString(),
      licenseConfidence: cells.licenseNo.confidence,
      rowConfidence: Math.min(...Object.values(cells).map((c) => c.confidence ?? 1)),
      // The correction may have changed the natural key, so the diff no longer
      // describes this row. Cleared rather than recomputed here, because the
      // recompute is a batch operation and promotion refuses to run while any
      // row is stale.
      diffComputedAt: null,
    }

    rows[index] = updated
    staging[id] = rows
    syncCounts(id)
    return HttpResponse.json(updated)
  }),

  http.post('/api/v1/admin/imports/:batchId/staging/:rowId/confirm', ({ params }) => {
    const id = String(params['batchId'])
    const rows = staging[id] ?? []
    const index = rows.findIndex((r) => r.id === String(params['rowId']))
    const row = rows[index]
    if (!row) return notFound()

    const updated = { ...row, needsConfirmation: false, confirmedAt: new Date().toISOString() }
    rows[index] = updated
    staging[id] = rows
    syncCounts(id)
    return HttpResponse.json(updated)
  }),

  http.post('/api/v1/admin/imports/:batchId/diff', ({ params }) => {
    const id = String(params['batchId'])
    ensureStaging(id)
    const rows = staging[id] ?? []
    staging[id] = rows.map((row) => ({
      ...row,
      diffComputedAt: new Date().toISOString(),
      diffVerdict: row.diffVerdict ?? 'INSERT',
    }))
    syncCounts(id)
    const updated = find(id)
    return updated ? HttpResponse.json(updated) : notFound()
  }),

  http.get('/api/v1/admin/imports/:batchId/rejects', ({ params }) =>
    HttpResponse.json(REJECTS[String(params['batchId'])] ?? []),
  ),

  http.post('/api/v1/admin/imports/:batchId/promote', async ({ params, request }) => {
    const id = String(params['batchId'])
    ensureStaging(id)
    const batch = find(id)
    if (!batch) return notFound()

    const body = (await request.json()) as { reason: string; expectedUpdatedAt: string }
    if (!body.reason || body.reason.trim().length < 10) {
      return HttpResponse.json(
        { code: 'REASON_REQUIRED', message: 'A reason is required', timestamp: new Date().toISOString() },
        { status: 400 },
      )
    }
    // Someone else moved the batch while this tab was open. Same reasoning as
    // the already-decided 409 in the review console.
    if (body.expectedUpdatedAt !== batch.updatedAt) {
      return HttpResponse.json(
        {
          code: 'BATCH_MODIFIED',
          message: 'This batch changed since you opened the preview. Reload before promoting.',
          timestamp: new Date().toISOString(),
        },
        { status: 409 },
      )
    }

    const rows = staging[id] ?? []
    if (rows.some((r) => r.promotedAt === null && r.diffComputedAt === null)) {
      return HttpResponse.json(
        {
          code: 'DIFF_STALE',
          message: 'Some rows were corrected after the diff ran. Recompute it first.',
          timestamp: new Date().toISOString(),
        },
        { status: 409 },
      )
    }

    /**
     * A row promotes when it has not already, and no longer needs a human.
     * Everything else stays staged.
     *
     * This is the whole of partial promotion: the confirmation gate is
     * unchanged and still absolute per row, it simply no longer holds the rest
     * of the batch hostage. A held row is skipped, not promoted with a caveat.
     */
    const ready = rows.filter(
      (r) => r.promotedAt === null && (!r.needsConfirmation || r.confirmedAt !== null),
    )
    const held = rows.filter(
      (r) => r.promotedAt === null && r.needsConfirmation && r.confirmedAt === null,
    )

    if (ready.length === 0) {
      return HttpResponse.json(
        {
          code: 'NOTHING_TO_PROMOTE',
          message: 'Every remaining row still needs confirming. Nothing would be written.',
          timestamp: new Date().toISOString(),
        },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()
    const promotedIds = new Set(ready.map((r) => r.id))
    staging[id] = rows.map((r) => (promotedIds.has(r.id) ? { ...r, promotedAt: now } : r))

    /**
     * Promotion is the only thing that writes to the live registry, and this is
     * the moment a claim can start matching against these rows. Before this the
     * import pipeline and the verification pipeline were unconnected: an admin
     * could promote a full register and every practitioner claim still found
     * nothing.
     */
    addRegistryRows(
      ready.map((row) => {
        const licence = row.cells.licenseNo.raw ?? ''
        const council = row.cells.council.normalized ?? batch.councilCode
        const name = row.cells.fullName.raw ?? ''
        return {
          councilCode: council,
          licenceRaw: licence,
          licenceKeys: licenceKeys(licence, council),
          fullNameRaw: name,
          fullNameNormalized: normalizeName(name),
          status: row.cells.status.normalized ?? 'UNKNOWN',
          validUntil: row.cells.validUntil.normalized,
          specialty: row.cells.specialty.normalized,
          sourceBatch: batch.label,
        }
      }),
    )

    // Terminal only when nothing is left. A batch with held rows is still
    // waiting on a person, and saying PROMOTED would lose exactly that fact.
    const status = held.length > 0 ? ('PARTIALLY_PROMOTED' as const) : ('PROMOTED' as const)
    patch(id, {
      status,
      rowsPromoted: (find(id)?.rowsPromoted ?? 0) + ready.length,
      promotedAt: now,
      promotedBy: 'shaurya',
      promoteReason: body.reason,
    })
    syncCounts(id)

    return HttpResponse.json({
      batchId: id,
      status,
      inserted: ready.filter((r) => r.diffVerdict === 'INSERT').length,
      updated: ready.filter((r) => r.diffVerdict === 'UPDATE').length,
      unchanged: ready.filter((r) => r.diffVerdict === 'UNCHANGED').length,
      flaggedNotPresent: 528,
      held: held.length,
    })
  }),

  // ---- the live registry -------------------------------------------------
  //
  // What a claim is actually matched against, as opposed to /admin/imports
  // which shows how it got there. Two different questions, and before this the
  // console could only answer the second one.
  http.get('/api/v1/admin/registry', ({ request }) => {
    const url = new URL(request.url)
    return HttpResponse.json(
      queryRegistry({
        q: url.searchParams.get('q') ?? '',
        council: url.searchParams.get('council') ?? '',
        status: url.searchParams.get('status') ?? '',
        page: Number(url.searchParams.get('page') ?? '0'),
        size: Number(url.searchParams.get('size') ?? '50'),
      }),
    )
  }),

  http.get('/api/v1/admin/registry/summary', () => HttpResponse.json(registrySummary())),

  // ---- reference data, profiles and accuracy -----------------------------
  http.get('/api/v1/admin/councils', () => HttpResponse.json(COUNCILS)),

  http.get('/api/v1/admin/profiles', () => HttpResponse.json(profiles)),

  /**
   * Computed from what this admin actually corrected, never from a fixture.
   *
   * It used to serve a static report with session corrections stapled on top,
   * each stamped with a hardcoded batch label, page number and confidence. So
   * the one screen whose entire job is telling you where the parser is weak was
   * reporting numbers no parser had produced.
   *
   * Biased in a known direction, and the page says so: it measures fields a
   * human looked at, and the diff preview sorts the worst rows first, so real
   * accuracy across a whole register is higher than what is shown.
   */
  http.get('/api/v1/admin/accuracy', () => {
    const reviewed = Object.entries(staging).flatMap(([batchId, rows]) =>
      rows.filter((r) => r.confirmedAt !== null).map((r) => ({ batchId, row: r })),
    )

    const byField = CANONICAL_FIELD_LIST.map((field) => {
      // Rows where the parser produced something for this field. A field the
      // document does not contain is not an accuracy result, it is absent, and
      // counting it as a pass would inflate every register that omits a column.
      const extractedCount = reviewed.filter(({ row }) => row.cells[field].raw !== null).length
      const forField = corrections.filter((c) => c.field === field)
      return {
        field,
        extractedCount,
        correctedCount: forField.length,
        accuracy: extractedCount === 0 ? 1 : 1 - forField.length / extractedCount,
        // High confidence and still wrong. These are calibration bugs and they
        // matter more than the rest: a low confidence miss is the system
        // working, a high confidence miss is the system lying.
        highConfidenceMisses: forField.filter((c) => (c.extractedConfidence ?? 0) >= 0.95).length,
      }
    }).filter((f) => f.extractedCount > 0)

    const byClassification = (['TEXT_LAYER', 'SCANNED', 'UNREADABLE'] as const)
      .map((classification) => {
        const rows = reviewed.filter(({ row }) => row.pageClassification === classification)
        const corrected = corrections.filter((c) => c.pageClassification === classification).length
        return {
          classification,
          rowsReviewed: rows.length,
          correctedCount: corrected,
          accuracy: rows.length === 0 ? 1 : Math.max(0, 1 - corrected / rows.length),
        }
      })
      .filter((c) => c.rowsReviewed > 0)

    return HttpResponse.json({
      batchesCovered: new Set(reviewed.map((r) => r.batchId)).size,
      rowsReviewed: reviewed.length,
      byField,
      byClassification,
      recentCorrections: [...corrections]
        .sort((a, b) => b.correctedAt.localeCompare(a.correctedAt))
        .slice(0, 20),
    })
  }),
]
