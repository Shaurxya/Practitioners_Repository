import type { ProgressEntry, ProgressState, ProgressStep } from '../types'
import { cn } from '@/lib/cn'

/**
 * The tracker is deliberately coarser than CaseStatus.
 *
 * NO_MATCH and MANUAL_REVIEW both render as "Being reviewed by our team". They
 * are distinct internally, and exposing the distinction would tell someone
 * submitting guessed registration numbers whether the number exists. The timing
 * still leaks a weaker signal, which copy cannot fix and which we accept for v1.
 *
 * A skipped step renders greyed rather than disappearing, so the tracker does
 * not change shape underneath someone watching it.
 */
const STEP_LABEL: Record<ProgressStep, string> = {
  SUBMITTED: 'Submitted',
  CHECKING: 'Checking your details',
  REVIEW: 'Reviewed by our team',
  DECISION: 'Decision',
}

const MARKER: Record<ProgressState, { glyph: string; className: string; srLabel: string }> = {
  DONE: { glyph: '✓', className: 'bg-verified text-white', srLabel: 'completed' },
  ACTIVE: { glyph: '●', className: 'bg-accent text-accent-content', srLabel: 'in progress' },
  PENDING: { glyph: '', className: 'bg-surface-raised text-content-subtle', srLabel: 'not started' },
  SKIPPED: { glyph: '–', className: 'bg-surface-raised text-content-subtle', srLabel: 'not needed' },
  ERROR: { glyph: '✕', className: 'bg-rejected text-white', srLabel: 'failed' },
}

export function ProgressTracker({ progress }: { progress: ProgressEntry[] }) {
  return (
    <ol className="space-y-0">
      {progress.map((entry, index) => {
        const marker = MARKER[entry.state]
        const isLast = index === progress.length - 1
        return (
          <li key={entry.step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  marker.className,
                )}
              >
                <span aria-hidden="true">{marker.glyph}</span>
              </span>
              {!isLast && <span className="my-1 w-px grow bg-border" aria-hidden="true" />}
            </div>
            <div className={cn('pb-6', isLast && 'pb-0')}>
              <p
                className={cn(
                  'text-base',
                  entry.state === 'ACTIVE' ? 'font-medium text-content' : 'text-content-muted',
                )}
              >
                {STEP_LABEL[entry.step]}
              </p>
              {/* The state is announced in text, not only by colour and shape. */}
              <p className="text-sm text-content-subtle">{marker.srLabel}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
