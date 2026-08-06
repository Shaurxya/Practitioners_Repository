import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * A block of related facts under a monospace overline, bounded by hairlines.
 *
 * Not a card: no shadow, no radius, no lift on hover. Elevation implies a stack
 * of surfaces and there is only ever one surface here, so separation is done
 * with rules and space instead.
 */
interface PanelProps {
  title?: string
  /** Right hand slot in the header, for counts or actions. */
  aside?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Panel({ title, aside, children, className, bodyClassName }: PanelProps) {
  return (
    <section className={cn('border border-border bg-surface', className)}>
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          {title && <h2 className="mono-label">{title}</h2>}
          {aside}
        </header>
      )}
      <div className={cn('px-4 py-3.5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Key/value row used by the portal. The console uses its own diff layout. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="mono-label w-44 shrink-0">{label}</dt>
      <dd className="text-body-sm text-content">{value}</dd>
    </div>
  )
}
