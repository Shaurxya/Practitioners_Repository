import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="py-12 text-center">
      <p className="text-lg font-medium text-content">That page does not exist</p>
      <p className="mt-1.5 text-base text-content-muted">
        The link may be wrong, or the page may have moved.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block text-base text-accent underline underline-offset-2"
      >
        Go to the start
      </Link>
    </div>
  )
}
