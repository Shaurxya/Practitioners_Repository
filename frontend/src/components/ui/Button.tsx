import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Five variants, and they map to intent rather than to colour: do the thing,
 * do a lesser thing, do a quiet thing, destroy something, or read as text.
 *
 * There is no brand colour here. Primary is ink on paper, the only filled
 * surface in the system, so the eye finds it without a hue. Status colour
 * belongs to StatusBadge and nowhere else.
 *
 * outline, outline-on-dark and ghost-link are kept as aliases so older call
 * sites keep compiling; they resolve onto secondary and link.
 */
type Variant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'link'
  | 'outline'
  | 'outline-on-dark'
  | 'ghost-link'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Shows a spinner and blocks clicks. Distinct from disabled so the label stays readable. */
  loading?: boolean
  children: ReactNode
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'border border-ink bg-ink text-accent-content hover:bg-accent-hover hover:border-accent-hover',
  secondary: 'border border-border-strong bg-canvas text-content hover:border-ink',
  ghost:
    'border border-transparent bg-transparent text-content-muted hover:bg-surface-raised hover:text-content',
  danger: 'border border-danger bg-canvas text-danger hover:bg-rejected-soft',
  /* Reads as a sentence, not a control. For tertiary actions in dense views. */
  link: 'border-0 bg-transparent text-content underline decoration-border-strong underline-offset-4 hover:decoration-current',
  outline: 'border border-border-strong bg-canvas text-content hover:border-ink',
  'outline-on-dark': 'border border-on-dark bg-transparent text-on-dark hover:bg-surface-elevated',
  'ghost-link':
    'border-0 bg-transparent text-content underline decoration-border-strong underline-offset-4 hover:decoration-current',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-button-sm gap-2',
  md: 'h-10 px-4 text-button-md gap-2',
  lg: 'h-11 px-5 text-button-lg gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isTextual = variant === 'link' || variant === 'ghost-link'

  return (
    <button
      // type defaults to "submit" inside a form, which fires unwanted submits
      // from any button that forgot to say otherwise. Default it to button and
      // let submit buttons opt in.
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-none font-medium',
        'transition-colors outline-none',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-ash',
        VARIANTS[variant],
        isTextual ? 'h-auto gap-2 p-0 text-body-sm' : SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="mr-1 size-3 animate-spin rounded-full border border-current border-t-transparent"
        />
      )}
      {children}
      {isTextual && !loading && <span aria-hidden="true">→</span>}
    </button>
  )
}
