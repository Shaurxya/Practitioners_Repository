import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { formatDate } from '@/lib/formatters'
import { useMyCases } from '../hooks/useVerificationCase'
import { outcomeCopy } from '../outcome'
import { councilLabel, useCouncils } from '../councils'

/**
 * Most practitioners have exactly one claim, so the router sends them straight
 * to it and this list is only reached deliberately. It is a stack of cards
 * rather than a table: the portal may well be read one handed on a phone.
 */
export function MyCasesPage() {
  const navigate = useNavigate()
  const query = useMyCases()
  // Not gated on: a claim list that will not render until the council names
  // arrive is worse than one that shows "MH" for a moment. councilLabel falls
  // back to the code.
  const councils = useCouncils()

  if (query.isPending) return <LoadingPanel label="Loading your claims" />

  if (query.isError) {
    const copy = errorCopy(query.error)
    return <ErrorState title={copy.title} body={copy.body} onRetry={() => void query.refetch()} />
  }

  const cases = query.data.content

  if (cases.length === 0) {
    return (
      <EmptyState
        title="You have not made a claim yet"
        body="Verify your registration to get an Immortal ID that other services can check."
        action={
          <Button variant="primary" size="lg" onClick={() => void navigate('/submit')}>
            Start a claim
          </Button>
        }
      />
    )
  }

  return (
    <div className="doc">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          History
        </p>
        <h1>Your claims</h1>
      </header>
      <ul className="mt-8 border-t border-border">
        {cases.map((item) => {
          const copy = outcomeCopy(item.outcomeCode)
          return (
            <li key={item.caseId}>
              <Link
                to={`/cases/${item.caseId}`}
                className="block border-b border-border px-1 py-4 transition-colors hover:bg-surface-raised"
              >
                <p className="text-body-md font-medium text-content">{copy.headline}</p>
                <p className="mt-1 text-body-sm text-content-muted">
                  <span className="font-mono tabular-nums">{item.claim.registrationNumber}</span>
                  {' at '}
                  {councilLabel(item.claim.council, councils.data)}
                </p>
                <p className="mono-label mono-label--faint mt-1.5">
                  Submitted {formatDate(item.submittedAt)}
                </p>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
