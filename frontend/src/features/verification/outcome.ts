import type { OutcomeCode } from './types'

/**
 * The reason code to plain language table.
 *
 * This copy is the product for a practitioner. A practitioner cannot do
 * anything with NAME_MATCH or NOT_EXPIRED, so every terminal state here answers
 * "what do I do now", including rejection, which routes to a human rather than
 * dead ending.
 *
 * One table, one file. Changing the voice changes it everywhere at once.
 */
export interface OutcomeCopy {
  headline: string
  body: string
  action: string
  /** Terminal for polling purposes: the client stops asking. */
  terminal: boolean
  tone: 'progress' | 'good' | 'bad' | 'warn'
}

export const OUTCOME_COPY: Record<OutcomeCode, OutcomeCopy> = {
  IN_PROGRESS: {
    headline: 'Checking your details',
    body: 'We are comparing what you sent with the official register. This usually takes under a minute.',
    action: 'Keep this page open, or come back to it later. The link stays valid.',
    terminal: false,
    tone: 'progress',
  },
  IN_REVIEW: {
    headline: 'Being reviewed by our team',
    body: 'Your claim needs a person to look at it. This usually takes one working day.',
    action: 'Nothing to do, and nothing to resubmit. We will update this page.',
    terminal: false,
    tone: 'progress',
  },
  VERIFIED: {
    headline: 'Verified',
    body: 'Your registration was matched to a current entry on the official register.',
    action: 'Your Immortal ID is shown below and does not change.',
    terminal: true,
    tone: 'good',
  },
  COULD_NOT_VERIFY: {
    // One code covering five backend causes: no match, name below threshold,
    // expired, suspended, and multiple candidates. That is the privacy boundary
    // doing its job, and it is the biggest usability cost in the portal.
    headline: 'We could not verify this claim',
    body: 'We were not able to match what you sent to a current entry on the register. This can happen for several reasons, including a typo in what was submitted.',
    action: 'Check your registration number and name against your certificate, then submit a new claim. If they are correct, contact support and we will look into it.',
    terminal: true,
    tone: 'bad',
  },
  NUMBER_FORMAT: {
    // Safe to be specific: this is checked against the council's published
    // number format before any registry lookup, so it reveals nothing about
    // who is actually on the register.
    headline: 'That registration number does not look right',
    body: 'The number does not match the format this council issues.',
    action: 'Check the number on your certificate and submit again.',
    terminal: true,
    tone: 'warn',
  },
  SYSTEM_ERROR: {
    headline: 'Something went wrong at our end',
    body: 'We could not finish checking your claim. This is not a problem with your details.',
    action: 'We are retrying automatically. If this page still shows this in an hour, contact support and quote your case reference.',
    terminal: true,
    tone: 'bad',
  },
  LAPSED: {
    // Post approval, so identity is already established and registry facts
    // about this person are their own facts to know.
    headline: 'Your verification has lapsed',
    body: 'The registration we verified you against is no longer current on the register.',
    action: 'Renew with your council, then submit a new claim once the register shows the update. Registers can take a few weeks to catch up after a renewal.',
    terminal: true,
    tone: 'warn',
  },
  WITHDRAWN: {
    headline: 'Your verification has been withdrawn',
    body: 'We were notified of a change to your registration status.',
    action: 'Contact support to discuss this.',
    terminal: true,
    tone: 'bad',
  },
}

export function outcomeCopy(code: OutcomeCode): OutcomeCopy {
  return OUTCOME_COPY[code]
}

export function isTerminalOutcome(code: OutcomeCode): boolean {
  return OUTCOME_COPY[code].terminal
}
