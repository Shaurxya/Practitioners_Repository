import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  className?: string
}

export function Badge({ children, className }: BadgeProps) {
  return (
    <span className={cn(
      "inline-flex items-center justify-center border border-border bg-surface-soft px-2 py-0.5",
      "font-mono text-utility-xs uppercase tracking-wider text-content-muted",
      className
    )}>
      {children}
    </span>
  )
}
