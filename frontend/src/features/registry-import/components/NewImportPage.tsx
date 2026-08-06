import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Panel } from '@/components/ui/Panel'
import { ErrorState, errorCopy } from '@/components/ui/States'
import { useCouncils, useCreateBatch, useProfiles } from '../hooks/useImports'

const MAX_BYTES = 200 * 1024 * 1024

/** council code plus today, which is the convention the existing batches use. */
function suggestLabel(councilCode: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return councilCode ? `${councilCode.toLowerCase()}-${today}` : ''
}

/**
 * Upload a register PDF and open a batch.
 *
 * Uploading does not start extraction. It runs the cheap classification pass
 * and stops, because a register that comes back fully scanned will extract far
 * worse and that is worth knowing before waiting out a 400 page OCR run.
 *
 * Three inputs, and only one of them is a real decision. The council is the one
 * fact this screen has to collect, because it is half the natural key and no
 * later screen can derive it. The label proposes itself from the council and the
 * date, and the profile defaults to detection.
 */
export function NewImportPage() {
  const navigate = useNavigate()
  const profiles = useProfiles()
  const councils = useCouncils()
  const create = useCreateBatch()

  const [file, setFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [councilCode, setCouncilCode] = useState('')
  const [profileId, setProfileId] = useState('')
  // Once the label has been typed in, it stops following the council. Rewriting
  // a value someone has edited is the kind of helpfulness that loses work.
  const [labelEdited, setLabelEdited] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const selectedProfile = (profiles.data ?? []).find((p) => p.id === profileId)
  // A profile belongs to exactly one council, so picking one settles the council
  // and asking again would only create a way for the two to disagree.
  const effectiveCouncil = selectedProfile?.councilCode ?? councilCode

  const tooBig = file !== null && file.size > MAX_BYTES
  const canSubmit =
    file !== null && !tooBig && effectiveCouncil !== '' && label.trim().length >= 3

  function onFile(next: File | null) {
    setLocalError(null)
    if (next && next.type !== 'application/pdf') {
      setLocalError('That is not a PDF. This pipeline reads council register PDFs only.')
      setFile(null)
      return
    }
    setFile(next)
  }

  function onCouncil(next: string) {
    setCouncilCode(next)
    if (!labelEdited) setLabel(suggestLabel(next))
  }

  function onProfile(next: string) {
    setProfileId(next)
    const council = (profiles.data ?? []).find((p) => p.id === next)?.councilCode
    if (council && !labelEdited) setLabel(suggestLabel(council))
  }

  function submit() {
    if (!file || !canSubmit) return
    create.mutate(
      {
        file,
        label: label.trim(),
        councilCode: effectiveCouncil,
        profileId: profileId || null,
      },
      { onSuccess: (batch) => void navigate(`/admin/imports/${batch.id}`) },
    )
  }

  return (
    <div className="max-w-2xl space-y-4 pt-8">
      <header className="border-b-2 border-ink pb-3">
        <h1 className="text-heading-md font-bold tracking-tight text-content">
          Upload a register
        </h1>
        <p className="mt-1 text-body-sm text-content-muted">
          The PDF is classified page by page first. Extraction only starts once you have seen the
          page mix and confirmed it.
        </p>
      </header>

      <Panel title="Source document">
        <div className="space-y-4">
          <div>
            <label htmlFor="pdf" className="mono-label mb-1.5 block">
              Register PDF
            </label>
            <input
              id="pdf"
              type="file"
              accept="application/pdf"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-content file:mr-3 file:border file:border-border-strong file:bg-canvas file:px-3 file:py-1.5 file:text-xs file:text-content hover:file:border-ink"
            />
            {file && (
              <p className="mt-1.5 font-mono text-2xs text-content-muted">
                {file.name} / {(file.size / 1024 / 1024).toFixed(1)} MB
              </p>
            )}
            {tooBig && (
              <p className="mt-1.5 text-2xs text-rejected">
                That file is over 200 MB. Split the register or raise the limit in configuration.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="council" className="mono-label mb-1.5 block">
              Council
            </label>
            {selectedProfile ? (
              <p className="flex h-9 items-center border border-border bg-surface-raised px-2.5 font-mono text-xs text-content">
                {selectedProfile.councilCode}
                <span className="ml-2 text-content-muted">
                  set by profile {selectedProfile.name}
                </span>
              </p>
            ) : (
              <select
                id="council"
                value={councilCode}
                onChange={(e) => onCouncil(e.target.value)}
                className="h-9 w-full rounded-[--radius-control] border border-border-strong bg-surface px-2 text-xs text-content outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
              >
                <option value="">Pick the council that published this register</option>
                {(councils.data ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} / {c.canonicalName}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1.5 text-2xs text-content-muted">
              Stamped on every row this batch promotes. It is half of the natural key, and most
              registers never print it inside the document, so it is collected once here rather
              than mapped from a column that may not exist.
            </p>
          </div>

          <div>
            <label htmlFor="label" className="mono-label mb-1.5 block">
              Batch label
            </label>
            <input
              id="label"
              value={label}
              onChange={(e) => {
                setLabelEdited(true)
                setLabel(e.target.value)
              }}
              placeholder="fills in once you pick a council"
              className="h-9 w-full rounded-[--radius-control] border border-border-strong bg-surface px-2.5 font-mono text-xs text-content outline-none placeholder:text-content-subtle focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
            />
            <p className="mt-1.5 text-2xs text-content-muted">
              Proposed from the council and today's date. This becomes the source batch on every
              row it promotes and the public verify endpoint prints it, so edit it if a member of
              the public would not make sense of it.
            </p>
          </div>

          <div>
            <label htmlFor="profile" className="mono-label mb-1.5 block">
              Parser profile
            </label>
            <select
              id="profile"
              value={profileId}
              onChange={(e) => onProfile(e.target.value)}
              className="h-9 w-full rounded-[--radius-control] border border-border-strong bg-surface px-2 text-xs text-content outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus"
            >
              <option value="">Detect from the document (first import of this register)</option>
              {(profiles.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} / {p.councilCode} / {p.batchCount} batches
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-2xs text-content-muted">
              With a profile set, the document is checked against its expected shape and the
              import fails loudly if the council reformatted. Without one, you confirm a column
              mapping and it is saved as a new profile.
            </p>
          </div>
        </div>
      </Panel>

      {/*
        Four steps, stated up front. Every one of them is a stop where a person
        decides something, and knowing that in advance is the difference between
        a pipeline that feels slow and one that feels careful.
      */}
      <Panel title="What happens after you upload">
        <ol className="space-y-1.5 text-body-sm text-content-muted">
          <li>
            <span className="mono-label mr-2">1</span>Pages are classified as text or scanned. You
            see the mix before any OCR runs.
          </li>
          <li>
            <span className="mono-label mr-2">2</span>
            {selectedProfile
              ? `Columns come from ${selectedProfile.name}, so this step is skipped unless the council reformatted.`
              : 'You confirm once which column is which. Saved as a profile, so the next upload skips it.'}
          </li>
          <li>
            <span className="mono-label mr-2">3</span>Rows the parser was unsure about are listed
            worst first for you to confirm or correct.
          </li>
          <li>
            <span className="mono-label mr-2">4</span>You review the diff against the live registry,
            then promote it.
          </li>
        </ol>
      </Panel>

      {localError && (
        <p role="alert" className="text-body-sm text-rejected">
          {localError}
        </p>
      )}

      {create.isError && <ErrorState {...errorCopy(create.error)} />}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={!canSubmit} loading={create.isPending}>
          Upload and classify
        </Button>
        <Link
          to="/admin/imports"
          className="text-body-sm text-content-muted underline decoration-border-strong underline-offset-4 hover:text-content"
        >
          Cancel
        </Link>
      </div>
    </div>
  )
}
