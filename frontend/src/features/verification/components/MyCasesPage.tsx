import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, LoadingPanel, errorCopy } from '@/components/ui/States'
import { formatDate } from '@/lib/formatters'
import { useMyCases } from '../hooks/useVerificationCase'
import { outcomeCopy } from '../outcome'
import { councilLabel } from '../councils'

/**
 * Most practitioners have exactly one claim, so the router sends them straight
 * to it and this list is only reached deliberately. It is a stack of cards
 * rather than a table: the portal may well be read one handed on a phone.
 */
export function MyCasesPage() {
  const navigate = useNavigate()
  const query = useMyCases()

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
          <Button variant="primary" size="lg" onClick={() => void navigate('/')}>
            Start a claim
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-content">Your claims</h1>
      <ul className="space-y-3">
        {cases.map((item) => {
          const copy = outcomeCopy(item.outcomeCode)
          return (
            <li key={item.caseId}>
              <Link
                to={`/cases/${item.caseId}`}
                className="block rounded-[--radius-panel] border border-border bg-surface p-4 transition-colors hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
              >
                <p className="text-base font-medium text-content">{copy.headline}</p>
                <p className="mt-1 text-sm text-content-muted">
                  <span className="font-mono tabular-nums">{item.claim.registrationNumber}</span>
                  {' at '}
                  {councilLabel(item.claim.council)}
                </p>
                <p className="mt-1 text-sm text-content-subtle">
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
