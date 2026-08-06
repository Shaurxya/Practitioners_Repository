import { cn } from '@/lib/cn'
import { Button } from './Button'
import { Badge } from './Badge'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'

// The signature decorative element: 12px primary green square
export function CornerSquare({ position = 'top-left' }: { position?: 'top-left' | 'bottom-right' }) {
  return (
    <div 
      className={cn(
        "absolute w-[12px] h-[12px] bg-primary",
        position === 'top-left' ? 'top-0 left-0' : 'bottom-0 right-0'
      )}
    />
  )
}

// ---------------------
// PRODUCT CARD
// ---------------------
interface ProductCardProps {
  imageSrc: string
  title: string
  description: string
  linkHref?: string
  className?: string
}

export function ProductCard({ imageSrc, title, description, linkHref = '#', className }: ProductCardProps) {
  return (
    <div className={cn("relative flex flex-col bg-canvas border border-hairline p-xl rounded-[--radius-sm] overflow-hidden", className)}>
      <CornerSquare position="top-left" />
      <div className="aspect-[16/9] w-full mb-4 bg-surface-soft overflow-hidden">
        <img src={imageSrc} alt={title} className="w-full h-full object-cover" />
      </div>
      <h3 className="text-card-title font-bold text-ink mb-1.5">{title}</h3>
      <p className="text-body-sm text-body mb-4 flex-grow">{description}</p>
      <div className="mt-auto">
        <a href={linkHref}>
          <Button variant="ghost-link" className="!pl-0">Learn More</Button>
        </a>
      </div>
    </div>
  )
}

// ---------------------
// FEATURE CARD
// ---------------------
interface FeatureCardProps {
  icon: IconDefinition
  title: string
  description: string
  className?: string
}

export function FeatureCard({ icon, title, description, className }: FeatureCardProps) {
  return (
    <div className={cn("relative flex flex-col bg-canvas border border-hairline p-xxl rounded-[--radius-sm]", className)}>
      <CornerSquare position="top-left" />
      <div className="mb-4 text-primary text-[24px]">
        <FontAwesomeIcon icon={icon} />
      </div>
      <h3 className="text-heading-md font-bold text-ink mb-2">{title}</h3>
      <p className="text-body-md text-body">{description}</p>
    </div>
  )
}

// ---------------------
// RESOURCE CARD
// ---------------------
interface ResourceCardProps {
  type: string
  imageSrc: string
  title: string
  description: string
  linkHref?: string
  className?: string
}

export function ResourceCard({ type, imageSrc, title, description, linkHref = '#', className }: ResourceCardProps) {
  return (
    <div className={cn("relative flex flex-col bg-canvas border border-hairline p-xl rounded-[--radius-sm]", className)}>
      <CornerSquare position="top-left" />
      <div className="mb-3">
        <Badge>{type}</Badge>
      </div>
      <div className="aspect-[3/2] w-full mb-4 bg-surface-soft overflow-hidden">
        <img src={imageSrc} alt={title} className="w-full h-full object-cover" />
      </div>
      <h3 className="text-card-title font-bold text-ink mb-2">{title}</h3>
      <p className="text-body-sm text-body mb-4 flex-grow">{description}</p>
      <div className="mt-auto">
        <a href={linkHref}>
          <Button variant="ghost-link" className="!pl-0">Read More</Button>
        </a>
      </div>
    </div>
  )
}

// ---------------------
// CALLOUT STAT
// ---------------------
export function CalloutStat({ stat, caption, className }: { stat: string, caption: string, className?: string }) {
  return (
    <div className={cn("bg-canvas border border-hairline p-xxl rounded-[--radius-sm]", className)}>
      <div className="text-display-lg font-bold text-primary mb-2">{stat}</div>
      <div className="text-body-md text-body">{caption}</div>
    </div>
  )
}

// ---------------------
// HERO CARD DARK
// ---------------------
export function HeroCardDark({
  headline,
  subhead,
  ctaText,
  imageSrc,
  className
}: {
  headline: string
  subhead: string
  ctaText: string
  imageSrc?: string
  className?: string
}) {
  return (
    <div className={cn("relative bg-surface-dark overflow-hidden rounded-none px-[48px] py-[80px]", className)}>
      {imageSrc && (
        <div className="absolute inset-0 z-0 w-full h-full">
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 to-transparent z-10" />
          <img src={imageSrc} className="w-full h-full object-cover opacity-70" alt="" />
        </div>
      )}
      <div className="relative z-10 max-w-2xl">
        <h1 className="text-display-xl font-bold text-on-dark mb-4">{headline}</h1>
        <p className="text-heading-lg font-normal text-on-dark-mute mb-8">{subhead}</p>
        <Button variant="primary" size="lg">{ctaText}</Button>
      </div>
    </div>
  )
}
