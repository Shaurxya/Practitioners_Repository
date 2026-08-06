import { cn } from '@/lib/cn'
import type { ReactNode } from 'react'

interface TabProps {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
}

export function PillTab({ children, active, onClick, className }: TabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center border-b-2 px-1 pb-2 pt-1 text-button-sm font-medium transition-colors outline-none",
        active
          ? "border-ink text-content"
          : "border-transparent text-content-muted hover:text-content",
        className
      )}
      aria-selected={active}
      role="tab"
    >
      {children}
    </button>
  )
}
