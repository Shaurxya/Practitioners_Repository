/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately not clsx or tailwind-merge. Nothing here relies on later
 * classes overriding earlier ones, so conflict resolution would be a
 * dependency bought for a problem the components do not have. Revisit if a
 * component ever needs to accept an overriding className from a parent.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
