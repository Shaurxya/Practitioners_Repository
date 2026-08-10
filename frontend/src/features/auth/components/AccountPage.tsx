import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { ImmortalIdDisplay } from '@/components/ui/ImmortalIdDisplay'
import { DetailRow, Panel } from '@/components/ui/Panel'
import { ErrorState, LoadingPanel } from '@/components/ui/States'
import { formatDate, formatDateTime } from '@/lib/formatters'
import {
  createApiKey,
  fetchApiKeys,
  fetchSessions,
  logoutEverywhere,
  revokeApiKey,
} from '../api/authApi'
import { useCurrentUser } from '../hooks/useCurrentUser'
import type { ApiKeyCreated } from '../types'

/**
 * The account: who you are, the identifier you hold, your API keys, and where
 * you are signed in.
 *
 * <p>All four in one place on purpose. They are the things a person comes here
 * to check or to revoke, and splitting them across screens means the revoke
 * buttons are the ones nobody finds.
 */
export function AccountPage() {
  const user = useCurrentUser()

  if (user.isPending) return <LoadingPanel label="Loading your account" />

  if (user.isError || !user.data) {
    return (
      <ErrorState
        title="We could not load your account"
        body="Your session may have ended. Sign in again."
        onRetry={() => void user.refetch()}
      />
    )
  }

  const account = user.data

  return (
    <div className="doc space-y-8">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          Account
        </p>
        <h1>{account.fullName}</h1>
        <p>{account.email}</p>
      </header>

      <Panel title="Your details">
        <dl className="divide-y divide-border">
          <DetailRow label="Name" value={account.fullName} />
          <DetailRow label="Email" value={account.email} />
          <DetailRow label="Role" value={<span className="font-mono">{account.role}</span>} />
          <DetailRow
            label="Immortal ID"
            value={
              account.immortalId ? (
                <ImmortalIdDisplay immortalId={account.immortalId} size="sm" copyable />
              ) : (
                // Not an error and not an empty field. Most accounts have none:
                // reviewers never do, and a practitioner has none until a first
                // approval. Section 3.1.
                <span className="text-content-muted">
                  None yet.{' '}
                  <Link to="/submit" className="underline decoration-border-strong underline-offset-4">
                    Claim your registration
                  </Link>{' '}
                  to be issued one.
                </span>
              )
            }
          />
        </dl>
      </Panel>

      <ApiKeysPanel />
      <SessionsPanel />
    </div>
  )
}

/**
 * API keys.
 *
 * <p>The created key is held in component state and shown once, because that is
 * all the server can offer: it stores a digest, so there is no endpoint that
 * could return the value again. The copy says so plainly rather than leaving
 * someone to discover it by closing the panel.
 */
function ApiKeysPanel() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [justCreated, setJustCreated] = useState<ApiKeyCreated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const keys = useQuery({ queryKey: ['api-keys'], queryFn: fetchApiKeys })

  const create = useMutation({
    mutationFn: createApiKey,
    onSuccess: (created) => {
      setJustCreated(created)
      setName('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: () => setError('We could not create that key.'),
  })

  const revoke = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  async function copyKey() {
    if (!justCreated) return
    try {
      await navigator.clipboard.writeText(justCreated.key)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is refused on an insecure origin and in plenty of
      // ordinary situations. The key is on screen and selectable, so this is a
      // convenience failing rather than the feature failing.
    }
  }

  return (
    <Panel
      title="API keys"
      aside={
        <span className="mono-label mono-label--faint">
          {keys.data ? `${keys.data.filter((k) => k.status === 'ACTIVE').length} active` : ''}
        </span>
      }
    >
      <p className="text-body-sm text-content-muted">
        A key calls the platform without a browser, as you. Keep it out of source control: anything
        holding it can do what you can.
      </p>

      {justCreated && (
        <div className="mt-4 border border-l-2 border-l-ink bg-surface-raised p-4">
          <p className="text-body-md font-medium text-content">Copy this key now</p>
          <p className="mt-1 text-body-sm text-content-muted">
            We store only a fingerprint of it, so this is the one and only time it can be shown. If
            you lose it, revoke it and make another.
          </p>
          <p className="mt-3 break-all font-mono text-body-sm text-content">{justCreated.key}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void copyKey()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setJustCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) {
            setError('Give the key a name you will recognise later.')
            return
          }
          create.mutate({ name: name.trim() })
        }}
      >
        <div className="grow">
          <TextField
            label="New key"
            hint="Name it after where it will be used, so you can revoke the right one later."
            placeholder="clinic booking system"
            value={name}
            error={error ?? undefined}
            onChange={(event) => {
              setName(event.target.value)
              if (error) setError(null)
            }}
          />
        </div>
        <Button type="submit" variant="secondary" size="lg" loading={create.isPending}>
          Generate
        </Button>
      </form>

      {keys.isPending && <p className="mt-4 text-body-sm text-content-muted">Loading keys</p>}

      {keys.data && keys.data.length === 0 && (
        <p className="mt-4 text-body-sm text-content-muted">You have no API keys.</p>
      )}

      {keys.data && keys.data.length > 0 && (
        <ul className="mt-4 border-t border-border">
          {keys.data.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border py-3"
            >
              <div>
                <p className="text-body-md text-content">{key.name}</p>
                <p className="mt-0.5 font-mono text-body-sm text-content-muted">{key.prefix}…</p>
                <p className="mono-label mono-label--faint mt-1">
                  Created {formatDate(key.createdAt)}
                  {/* "Recently used", not "last used": the server writes this at
                      most once every few minutes so a key in constant use does
                      not turn every read into a write. */}
                  {key.lastUsedAt ? ` · used around ${formatDateTime(key.lastUsedAt)}` : ' · never used'}
                </p>
              </div>
              {key.status === 'ACTIVE' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={revoke.isPending && revoke.variables === key.id}
                  onClick={() => revoke.mutate(key.id)}
                >
                  Revoke
                </Button>
              ) : (
                <span className="mono-label mono-label--faint">{key.status}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Where this account is signed in, and one button to end all of it. */
function SessionsPanel() {
  const queryClient = useQueryClient()
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions })

  const endAll = useMutation({
    mutationFn: logoutEverywhere,
    onSuccess: () => {
      // This browser's session is among the ones just ended, so the next
      // request will 401 and land on sign in. Refetching keeps the list honest
      // until then rather than showing sessions that no longer exist.
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
  })

  return (
    <Panel
      title="Signed in devices"
      aside={
        <Button size="sm" variant="secondary" loading={endAll.isPending} onClick={() => endAll.mutate()}>
          Sign out everywhere
        </Button>
      }
    >
      <p className="text-body-sm text-content-muted">
        Ending these signs out every browser, including this one. Use it if you signed in somewhere
        you no longer control.
      </p>

      {sessions.isPending && <p className="mt-3 text-body-sm text-content-muted">Loading</p>}

      {sessions.data && (
        <ul className="mt-3 border-t border-border">
          {sessions.data.map((session) => (
            <li key={session.id} className="border-b border-border py-2.5">
              <p className="text-body-sm text-content">{session.userAgent ?? 'Unknown device'}</p>
              <p className="mono-label mono-label--faint mt-0.5">
                Since {formatDateTime(session.issuedAt)}
                {session.ipAddress ? ` · ${session.ipAddress}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
