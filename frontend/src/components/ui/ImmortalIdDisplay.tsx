import { useState } from 'react'
import { cn } from '@/lib/cn'
import { parseImmortalId } from '@/features/public-verify/immortalId'
import {
  countryName,
  medicalSystemName,
  useCountries,
  useMedicalSystems,
} from '@/features/verification/referenceData'

/**
 * One way to render an Immortal ID, everywhere one appears.
 *
 * The portal, the review console, the public lookup and any future certificate
 * all show the same identifier, and the fastest way to make a permanent
 * identifier look untrustworthy is to print it three different ways on three
 * screens. So the spacing, the casing, the segment emphasis and the decoded
 * caption live here rather than being retyped per page.
 *
 * WHY THE SEGMENTS ARE SHOWN SEPARATELY
 *
 * HI-26INA-K3M7Q means something: registered 2026, India, Ayurveda. That is the
 * entire justification for spending four of the fourteen characters on facts
 * instead of entropy, and it is worth nothing if the screen renders it as an
 * opaque string. The caption also gives a person a way to notice a wrong ID
 * without a lookup, which is the closest this format gets to the check
 * character the previous one had.
 *
 * A legacy ID carries none of those segments, so it renders as the plain string
 * with no caption. Inventing a year for it would be worse than saying nothing.
 */

type Size = 'sm' | 'md' | 'lg'

const SIZE_CLASS: Record<Size, string> = {
  sm: 'text-body-sm',
  md: 'text-body-md',
  lg: 'text-lg',
}

interface ImmortalIdDisplayProps {
  /** Null before the first approval. Every read path has to handle that. */
  immortalId: string | null | undefined
  size?: Size
  /** The decoded caption. Off in dense lists where it would be noise. */
  showParts?: boolean
  /** A copy button. Off by default: it is only useful where the ID is the point. */
  copyable?: boolean
  className?: string
  /** Shown in place of the ID when there is none yet. */
  placeholder?: string
}

export function ImmortalIdDisplay({
  immortalId,
  size = 'md',
  showParts = false,
  copyable = false,
  className,
  placeholder = 'Not yet issued',
}: ImmortalIdDisplayProps) {
  // Not gated on. A verified practitioner must see their own ID immediately,
  // not after two reference lookups resolve, so the caption fills in when the
  // names arrive and falls back to the raw codes until then.
  const countries = useCountries()
  const systems = useMedicalSystems()
  const [copied, setCopied] = useState(false)

  if (!immortalId) {
    // A marked placeholder, not an empty field and never a fake value.
    return <p className={cn('text-content-muted', SIZE_CLASS[size], className)}>{placeholder}</p>
  }

  const parts = parseImmortalId(immortalId)

  async function copy() {
    if (!immortalId) return
    try {
      await navigator.clipboard.writeText(immortalId)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is refused in plenty of ordinary situations, an
      // insecure origin among them. The ID is on screen and selectable either
      // way, so this is a convenience failing, not the feature failing.
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <p className={cn('font-mono tracking-wider text-content', SIZE_CLASS[size])}>{immortalId}</p>
        {copyable && (
          <button
            type="button"
            onClick={() => void copy()}
            className="mono-label border border-border px-2 py-1 transition-colors hover:bg-surface-raised"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      {showParts && parts && (
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
          <Part label="Registered" value={String(parts.year)} />
          <Part label="Country" value={countryName(parts.countryCode, countries.data)} />
          <Part label="System" value={medicalSystemName(parts.medicalSystemCode, systems.data)} />
        </dl>
      )}

      {showParts && !parts && (
        // Issued before the format carried its own provenance. Saying so is
        // better than a caption of blanks, and far better than a guessed year.
        <p className="mono-label mono-label--faint mt-2">
          Issued under the earlier ID format, which carries no year or country
        </p>
      )}
    </div>
  )
}

function Part({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="mono-label mono-label--faint">{label}</dt>
      <dd className="text-body-sm text-content">{value}</dd>
    </div>
  )
}
