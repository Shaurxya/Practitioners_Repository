import { describe, expect, it } from 'vitest'
import { formatVerifiedAsOf } from './formatters'

/**
 * Proves the Vitest harness runs. Also pins the one piece of copy that is a
 * product requirement: never a bare tick, always "verified as of".
 */
describe('formatVerifiedAsOf', () => {
  it('states the date and the source batch', () => {
    expect(formatVerifiedAsOf('2026-07-14', 'council-2026-07-14')).toBe(
      'Verified as of 14 July 2026, source council-2026-07-14',
    )
  })
})
