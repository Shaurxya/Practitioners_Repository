import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { useId } from 'react'
import { cn } from '@/lib/cn'

const CONTROL = cn(
  'w-full rounded-[--radius-control] border bg-surface px-3 text-content',
  'placeholder:text-content-subtle outline-none transition-colors',
  'focus-visible:ring-2 focus-visible:ring-focus focus-visible:border-focus',
  'disabled:cursor-not-allowed disabled:opacity-60',
)

interface FieldShellProps {
  label: string
  hint?: string
  error?: string | undefined
  required?: boolean
  children: (ids: { controlId: string; describedBy: string | undefined }) => ReactNode
}

/**
 * Owns the label, hint, error and the aria wiring between them. Controls
 * plug in through the render prop so the ids only exist in one place.
 */
function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  const controlId = useId()
  const hintId = `${controlId}-hint`
  const errorId = `${controlId}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className="space-y-1.5">
      <label htmlFor={controlId} className="block text-sm font-medium text-content">
        {label}
        {required && (
          <span className="ml-1 text-content-muted" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-content-muted">
          {hint}
        </p>
      )}
      {children({ controlId, describedBy: describedBy || undefined })}
      {/* role=alert so a screen reader announces the error when it appears,
          rather than only on the next focus move. */}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-rejected">
          {error}
        </p>
      )}
    </div>
  )
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string | undefined
  /** Registration numbers and IDs read mono with tabular numerals. */
  mono?: boolean
}

export function TextField({ label, hint, error, mono, className, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {({ controlId, describedBy }) => (
        <input
          id={controlId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            CONTROL,
            'h-11',
            mono && 'font-mono tabular-nums tracking-tight',
            error ? 'border-rejected' : 'border-border-strong',
            className,
          )}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string
  hint?: string
  error?: string | undefined
}

export function TextAreaField({ label, hint, error, className, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {({ controlId, describedBy }) => (
        <textarea
          id={controlId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(
            CONTROL,
            'min-h-20 py-2 leading-relaxed',
            error ? 'border-rejected' : 'border-border-strong',
            className,
          )}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

interface SelectFieldProps {
  label: string
  hint?: string
  error?: string | undefined
  required?: boolean
  value: string
  onChange: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
  placeholder?: string
}

export function SelectField({
  label,
  hint,
  error,
  required,
  value,
  onChange,
  options,
  placeholder,
}: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={required}>
      {({ controlId, describedBy }) => (
        <select
          id={controlId}
          value={value}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={cn(CONTROL, 'h-11', error ? 'border-rejected' : 'border-border-strong')}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  )
}
