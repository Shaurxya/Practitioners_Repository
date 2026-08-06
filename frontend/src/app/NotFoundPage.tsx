import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="doc page-head">
      <p className="mono-label">
        <span className="mark" aria-hidden="true" />
        404
      </p>
      <h1>That page does not exist</h1>
      <p>The link may be wrong, or the page may have moved.</p>
      <div className="mt-8">
        <Link className="cta" to="/">
          Go to the overview <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  )
}
