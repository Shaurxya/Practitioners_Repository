import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safeNext'

/**
 * An unvalidated `next` is an open redirect, and the sign in page is the worst
 * possible place for one: the link genuinely points at our domain, the person
 * types their password, and then they are somewhere else entirely.
 */
describe('safeNextPath', () => {
  it('allows a same origin path', () => {
    expect(safeNextPath('/admin')).toBe('/admin')
    expect(safeNextPath('/cases/123?tab=rules')).toBe('/cases/123?tab=rules')
  })

  it('rejects an absolute URL', () => {
    expect(safeNextPath('https://evil.example')).toBeNull()
    expect(safeNextPath('http://evil.example')).toBeNull()
  })

  it('rejects a protocol relative URL', () => {
    // //evil.example is a different host that reads as a path at a glance, and
    // it is the form that gets through a naive startsWith('/') check.
    expect(safeNextPath('//evil.example')).toBeNull()
  })

  it('rejects a backslash that browsers normalise into a slash', () => {
    // Some browsers treat /\evil.example as protocol relative after
    // normalisation, so it becomes an absolute URL after the check has passed.
    expect(safeNextPath('/\\evil.example')).toBeNull()
  })

  it('rejects a scheme that is not http at all', () => {
    expect(safeNextPath('javascript:alert(1)')).toBeNull()
    expect(safeNextPath('data:text/html,<script>')).toBeNull()
  })

  it('treats absent or empty as no request', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
    expect(safeNextPath('')).toBeNull()
  })
})
