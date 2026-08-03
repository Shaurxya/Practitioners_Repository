import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/**
 * Loading, empty and error states as first class components, because they are
 * the states a user actually meets most often and they are the ones that get
 * left as a bare "Loading..." otherwise.
 *
 * Copy rules applied here: say what happened and what to do, in the active
 * voice, and never apologise.
 */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex items-center">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-content"
      />
    </span>
  )
}

/** Grey block standing in for content whose shape we already know. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded bg-surface-raised', className)} />
}

export function LoadingPanel({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-10 text-sm text-content-muted">
      <Spinner label={label} />
      {label}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  body?: string
  action?: ReactNode
}

/** An empty state is an invitation to act, not a dead end. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="rounded-[--radius-panel] border border-dashed border-border px-6 py-12 text-center">
      <p className="text-base font-medium text-content">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-md text-sm text-content-muted">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

interface ErrorStateProps {
  title: string
  body?: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({ title, body, onRetry, retryLabel = 'Try again' }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-[--radius-panel] border border-rejected/40 bg-rejected-soft px-6 py-8 text-center"
    >
      <p className="text-base font-medium text-content">{title}</p>
      {body && <p className="mx-auto mt-1.5 max-w-md text-sm text-content-muted">{body}</p>}
      {onRetry && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Turns whatever a query threw into copy. Kept in one place so a 500 and a
 * network drop do not get two different vocabularies across screens.
 */
export function errorCopy(error: unknown): { title: string; body: string } {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status: unknown }).status)
    : undefined

  if (status === 404) {
    return { title: 'Not found', body: 'That record does not exist, or is not yours to view.' }
  }
  if (status === 401 || status === 403) {
    return { title: 'Not signed in', body: 'Sign in again to continue.' }
  }
  if (status !== undefined && status >= 500) {
    return { title: 'The service did not respond', body: 'This is a problem at our end. Try again in a moment.' }
  }
  return {
    title: 'Could not load this',
    body: 'Check your connection and try again.',
  }
}
