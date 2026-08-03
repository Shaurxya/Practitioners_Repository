import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

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
    <section
      className={cn(
        'overflow-hidden rounded-[--radius-panel] border border-border bg-surface',
        className,
      )}
    >
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          {title && (
            <h2 className="text-2xs font-semibold uppercase tracking-wider text-content-muted">
              {title}
            </h2>
          )}
          {aside}
        </header>
      )}
      <div className={cn('px-4 py-3', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Key/value row used by the portal. The console uses its own diff layout. */
export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-content-muted">{label}</dt>
      <dd className="text-sm text-content">{value}</dd>
    </div>
  )
}
