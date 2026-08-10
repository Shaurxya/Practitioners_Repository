/**
 * Validates a `next` redirect parameter, in one place.
 *
 * <p>An unvalidated `next` is an open redirect. A link to our own sign in page
 * carrying `next=https://evil.example` sends someone who trusts this domain
 * somewhere else, having just typed their password, and the URL they hovered
 * over was genuinely ours.
 *
 * <p>Only same origin paths are honoured, which means:
 *
 * <ul>
 *   <li>must start with a single `/` — anything else is another origin</li>
 *   <li>must not start with `//` — a protocol relative URL, so `//evil.example`
 *       is a different host that merely looks like a path</li>
 *   <li>must not start with `/\` — some browsers normalise the backslash to a
 *       slash, making `/\evil.example` protocol relative after the fact</li>
 * </ul>
 *
 * <p>Shared by the sign in and sign up pages rather than written twice, because
 * two copies of a check like this drift and only one of them gets fixed.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null
  if (!next.startsWith('/')) return null
  if (next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}
