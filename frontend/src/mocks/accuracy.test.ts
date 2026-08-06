import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockData } from '@/mocks/handlers'

/**
 * Accuracy is measured, not asserted.
 *
 * The endpoint used to serve a static report with session corrections stapled
 * on top, each stamped with a hardcoded batch label, page number and
 * confidence. The one screen whose job is telling you where the parser is weak
 * was reporting numbers no parser had produced.
 */
/**
 * Seeded, because these tests need staging rows to correct and the upload path
 * cannot be driven from jsdom: request.formData() on a multipart body hangs
 * under msw/node. The rows are fixtures; every number asserted below is
 * computed from what the test does to them.
 */
beforeEach(() => resetMockData(true))

async function json(path: string, init?: RequestInit) {
  const response = await fetch(path, init)
  return { status: response.status, body: await response.json().catch(() => null) }
}

const BATCH = 'b-mh-aug'

/** The rows the parser was least sure about, which is where corrections happen. */
async function heldRows() {
  const page = await json(
    `/api/v1/admin/imports/${BATCH}/staging?needsConfirmation=true&page=0&size=50`,
  )
  return page.body.content as { id: string }[]
}

describe('the accuracy report', () => {
  it('is empty before anyone has corrected anything', async () => {
    const report = await json('/api/v1/admin/accuracy')

    expect(report.body.rowsReviewed).toBe(0)
    expect(report.body.byField).toEqual([])
    expect(report.body.recentCorrections).toEqual([])
    expect(report.body.batchesCovered).toBe(0)
  })

  it('counts a confirmed row as reviewed without counting it as an error', async () => {
    const rows = await heldRows()
    await fetch(`/api/v1/admin/imports/${BATCH}/staging/${rows[0]?.id}/confirm`, { method: 'POST' })

    const report = await json('/api/v1/admin/accuracy')
    expect(report.body.rowsReviewed).toBe(1)
    expect(report.body.batchesCovered).toBe(1)
    expect(report.body.recentCorrections).toEqual([])
    // Accepted as extracted, so every field it carried is still correct.
    expect(report.body.byField.every((f: { accuracy: number }) => f.accuracy === 1)).toBe(true)
  })

  it('records a correction against the field, batch and page it happened on', async () => {
    const rows = await heldRows()
    await fetch(`/api/v1/admin/imports/${BATCH}/staging/${rows[0]?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrections: [{ field: 'licenseNo', value: 'MH/04471/2018' }] }),
    })

    const report = await json('/api/v1/admin/accuracy')
    expect(report.body.recentCorrections).toHaveLength(1)

    const correction = report.body.recentCorrections[0]
    expect(correction.field).toBe('licenseNo')
    expect(correction.correctedValue).toBe('MH/04471/2018')
    // The real label, not a hardcoded one.
    expect(correction.batchLabel).toBe('council-2026-08-01')
    // The confidence the parser actually reported when it got this wrong.
    expect(correction.extractedConfidence).toBeLessThan(1)
    expect(['TEXT_LAYER', 'SCANNED', 'UNREADABLE']).toContain(correction.pageClassification)

    const licence = report.body.byField.find((f: { field: string }) => f.field === 'licenseNo')
    expect(licence.correctedCount).toBe(1)
    expect(licence.accuracy).toBeLessThan(1)
  })

  /**
   * A low confidence miss is the system working. A high confidence miss is the
   * system lying, and those are the ones worth chasing.
   */
  it('separates calibration bugs from ordinary misses', async () => {
    const rows = await heldRows()

    // The held rows are the low confidence ones, so correcting one is an
    // ordinary miss rather than a calibration bug.
    await fetch(`/api/v1/admin/imports/${BATCH}/staging/${rows[0]?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrections: [{ field: 'licenseNo', value: 'MH/04471/2018' }] }),
    })

    const report = await json('/api/v1/admin/accuracy')
    const licence = report.body.byField.find((f: { field: string }) => f.field === 'licenseNo')
    expect(licence.correctedCount).toBe(1)
    expect(licence.highConfidenceMisses).toBe(0)
  })

  /**
   * Re-typing a value the parser already had right is not a parser error, and
   * counting it would land in the calibration bug total, which is the number
   * most likely to be acted on.
   */
  it('ignores a correction that changes nothing', async () => {
    const rows = await heldRows()
    const before = await json(
      `/api/v1/admin/imports/${BATCH}/staging?needsConfirmation=true&page=0&size=50`,
    )
    const name = before.body.content[0].cells.fullName.raw as string

    await fetch(`/api/v1/admin/imports/${BATCH}/staging/${rows[0]?.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corrections: [{ field: 'fullName', value: name }] }),
    })

    const report = await json('/api/v1/admin/accuracy')
    expect(report.body.recentCorrections).toEqual([])
    // Still reviewed: a person looked at it and accepted it.
    expect(report.body.rowsReviewed).toBe(1)
  })

  it('does not score a field the document never contained', async () => {
    const rows = await heldRows()
    await fetch(`/api/v1/admin/imports/${BATCH}/staging/${rows[0]?.id}/confirm`, { method: 'POST' })

    const report = await json('/api/v1/admin/accuracy')
    const fields = report.body.byField.map((f: { field: string }) => f.field)
    // Nothing mapped a registration date, so it has no accuracy to report.
    expect(fields).not.toContain('registrationDate')
    expect(fields).toContain('licenseNo')
  })
})
