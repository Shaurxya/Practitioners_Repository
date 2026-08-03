import { describe, expect, it } from 'vitest'
import { OUTCOME_COPY, isTerminalOutcome, outcomeCopy } from './outcome'
import { OUTCOME_CODE } from './types'

describe('outcome copy', () => {
  it('covers every outcome code', () => {
    for (const code of OUTCOME_CODE) {
      expect(outcomeCopy(code)).toBeDefined()
    }
  })

  it('gives every terminal state something to do next', () => {
    // A rejection with no route to a human is a dead end, and a dead end turns
    // into a support email that starts with "your system says".
    for (const code of OUTCOME_CODE) {
      const copy = outcomeCopy(code)
      expect(copy.action.trim().length).toBeGreaterThan(0)
    }
  })

  it('never leaks a rule code or internal vocabulary to a practitioner', () => {
    const forbidden = [
      'NAME_MATCH',
      'NOT_EXPIRED',
      'LICENSE_ACTIVE',
      'NOT_SANCTIONED',
      'SINGLE_CANDIDATE',
      'DOC_CONSISTENT',
      'MANUAL_REVIEW',
      'NO_MATCH',
      'registry',
      'license_no',
      'candidate',
    ]
    for (const code of OUTCOME_CODE) {
      const copy = outcomeCopy(code)
      const text = `${copy.headline} ${copy.body} ${copy.action}`.toLowerCase()
      for (const term of forbidden) {
        expect(text).not.toContain(term.toLowerCase())
      }
    }
  })

  it('never apologises and never uses an em dash', () => {
    for (const code of OUTCOME_CODE) {
      const copy = outcomeCopy(code)
      const text = `${copy.headline} ${copy.body} ${copy.action}`
      expect(text.toLowerCase()).not.toContain('sorry')
      expect(text.toLowerCase()).not.toContain('apolog')
      expect(text).not.toContain('—')
    }
  })

  it('marks in progress states as non terminal so polling continues', () => {
    expect(isTerminalOutcome('IN_PROGRESS')).toBe(false)
    expect(isTerminalOutcome('IN_REVIEW')).toBe(false)
  })

  it('marks decided states as terminal so polling stops', () => {
    expect(isTerminalOutcome('VERIFIED')).toBe(true)
    expect(isTerminalOutcome('COULD_NOT_VERIFY')).toBe(true)
    expect(isTerminalOutcome('LAPSED')).toBe(true)
    expect(isTerminalOutcome('WITHDRAWN')).toBe(true)
    // Retryable server side, but nothing the practitioner does moves it, so
    // polling on it is pure load.
    expect(isTerminalOutcome('SYSTEM_ERROR')).toBe(true)
  })

  it('gives the same message for every pre approval failure', () => {
    // The privacy boundary: no match, name mismatch, expired and suspended must
    // be indistinguishable, or the endpoint becomes a registry lookup oracle.
    expect(OUTCOME_COPY.COULD_NOT_VERIFY.headline).toBe('We could not verify this claim')
  })
})
