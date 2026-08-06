import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'

interface ApiKey {
  id: string
  key: string
  name: string
  createdAt: string
  lastUsed: string | null
}

/**
 * Generates a mock API key that looks realistic.
 * In production this would hit a backend endpoint.
 */
function generateMockApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return `hi_live_${Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')}`
}

const ROUTES = [
  { method: 'POST', path: '/api/v1/verifications', note: 'Submit a claim, 202 with a case id' },
  { method: 'GET', path: '/api/v1/verifications/{id}', note: 'Status, rule results, next action' },
  { method: 'GET', path: '/api/v1/verifications', note: 'Your cases, paginated' },
  { method: 'GET', path: '/api/v1/public/verify?immortalId=', note: 'No auth, cached, rate limited' },
  {
    method: 'GET',
    path: '/api/v1/internal/practitioners/{immortalId}',
    note: 'Service auth, gated at the gateway by path',
  },
  { method: 'DELETE', path: '/api/v1/keys/{id}', note: 'Revoke a key immediately' },
]

export function DeveloperPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [appName, setAppName] = useState('')
  const [nameError, setNameError] = useState<string | undefined>()
  const [isCreating, setIsCreating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  const handleCreate = useCallback(() => {
    if (!appName.trim()) {
      setNameError('Give the key a name so you can identify it later.')
      return
    }
    if (appName.trim().length < 2) {
      setNameError('Name must be at least 2 characters.')
      return
    }
    setNameError(undefined)
    setIsCreating(true)

    // Simulate API call
    setTimeout(() => {
      const newKey: ApiKey = {
        id: crypto.randomUUID(),
        key: generateMockApiKey(),
        name: appName.trim(),
        createdAt: new Date().toISOString(),
        lastUsed: null,
      }
      setKeys((prev) => [newKey, ...prev])
      setAppName('')
      setIsCreating(false)
      setShowCreateForm(false)
    }, 800)
  }, [appName])

  const copyToClipboard = useCallback(async (key: string, id: string) => {
    await navigator.clipboard.writeText(key)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const revokeKey = useCallback((id: string) => {
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }, [])

  return (
    <div className="doc">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          Developer reference
        </p>
        <h1>Ask the registry a question from your own platform.</h1>
        <p>
          One call submits a claim, one call reads a status, and one call resolves an Immortal ID
          without authentication. Everything else is detail.
        </p>
      </header>

      <div className="doc-body pt-10">
        <h3>Endpoints</h3>
        <div className="doc-routes">
          {ROUTES.map((route) => (
            <div className="doc-route" key={route.method + route.path}>
              <i>{route.method}</i>
              <code>{route.path}</code>
              <span>{route.note}</span>
            </div>
          ))}
        </div>

        <h3>A request</h3>
        <pre className="doc-pre">
          <code>{`curl -X POST https://api.herbimmortal.com/v1/verifications \\
  -H "Authorization: Bearer hi_live_xxxxx" \\
  -H "Idempotency-Key: 6f1c2b90" \\
  -H "Content-Type: application/json" \\
  -d '{
    "fullName": "Dr. Ramesh Sharma",
    "registrationNumber": "MH-12345",
    "council": "MH",
    "specialty": "Ayurveda"
  }'`}</code>
        </pre>

        <h3>And the answer</h3>
        <pre className="doc-pre">
          <code>{`{
  "status": "VERIFIED",
  "confidence": 0.97,
  "verifiedAsOf": "2026-08-04",
  "registrySourceBatch": "council-2026-08-01",
  "matchedRecord": {
    "fullName": "RAMESH SHARMA",
    "registrationNumber": "MH12345",
    "council": "MH",
    "status": "ACTIVE",
    "validUntil": "2027-03-15"
  }
}`}</code>
        </pre>

        <div className="doc-aside">
          <p>
            The batch name travels with every answer on purpose. It is what lets a consumer trace a
            decision back to the registry export it came from, months later, without asking us.
          </p>
        </div>

        <h3>Keys</h3>
        <p>
          A key is scoped to one application, so revoking a leaked key takes one integration down
          rather than all of them. Keys are shown once, at creation.
        </p>

        {showCreateForm ? (
          <div className="border border-border bg-surface p-5">
            <p className="text-body-md font-medium text-content">Create a key</p>
            <p className="mt-1 text-body-sm text-content-muted">
              Name it after the application that will use it.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <TextField
                  label="Application name"
                  placeholder="Clinic booking backend"
                  value={appName}
                  error={nameError}
                  onChange={(e) => {
                    setAppName(e.target.value)
                    if (nameError) setNameError(undefined)
                  }}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="primary" loading={isCreating} onClick={handleCreate}>
                  {isCreating ? 'Generating' : 'Generate key'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setShowCreateForm(false)
                    setAppName('')
                    setNameError(undefined)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 border-t-2 border-ink pt-4">
            <p className="mono-label">
              {keys.length === 0 ? 'No keys yet' : `${keys.length} active`}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setShowCreateForm(true)}>
              Create a key
            </Button>
          </div>
        )}

        {keys.length > 0 && (
          <ul className="border-t border-border">
            {keys.map((apiKey) => (
              <li
                key={apiKey.id}
                className="flex flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  <p className="text-body-sm font-medium text-content">{apiKey.name}</p>
                  <code className="block truncate font-mono text-caption-sm text-content-muted">
                    {apiKey.key}
                  </code>
                  <p className="mono-label mono-label--faint">
                    Created{' '}
                    {new Date(apiKey.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {apiKey.lastUsed ? ` / last used ${apiKey.lastUsed}` : ' / never used'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void copyToClipboard(apiKey.key, apiKey.id)}
                  >
                    {copiedId === apiKey.id ? 'Copied' : 'Copy'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => revokeKey(apiKey.id)}>
                    Revoke
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="doc-aside">
          <p>
            A key grants access to verification data about real people. Keep it server side, out of
            repositories, and rotate it on a schedule rather than after an incident.
          </p>
        </div>

        <div className="flex flex-wrap gap-7 pt-4">
          <Link className="cta" to="/verify">
            Try the public lookup <span aria-hidden="true">→</span>
          </Link>
          <Link className="cta cta--quiet" to="/#api">
            Full API surface <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
