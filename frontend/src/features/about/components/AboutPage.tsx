import { Link } from 'react-router-dom'
import { useCouncils } from '@/features/verification/councils'

/**
 * The short version of the story, for someone who followed a link and wants to
 * know what this is before deciding whether to read the full specification on
 * the overview page.
 *
 * Set with the shared document primitives, so it is the same document as the
 * overview, the API reference and the review console, at a different length.
 */
export function AboutPage() {
  const councils = useCouncils().data ?? []

  return (
    <div className="doc">
      <header className="page-head page-head--ruled">
        <p className="mono-label">
          <span className="mark" aria-hidden="true" />
          About
        </p>
        <h1>A licence is a fact about today, not a certificate from 2019.</h1>
        <p>
          HerbImmortal Verification checks a practitioner against the council registry that issued
          their licence, records how it reached that answer, and gives a permanent identifier that
          anyone can check later without an account.
        </p>
      </header>

      <div className="doc-body pt-10">
        <p className="doc-lead">
          Verification usually means someone looked at a PDF once. That answers a question about the
          past. The question worth answering is whether this person is in good standing right now.
        </p>

        <p>
          So the registry is the authority here, not the paperwork. A practitioner submits a claimed
          identity, the system normalizes it the same way it normalized the registry, matches it,
          runs a catalog of explicit checks over the match, and either decides or hands the case to
          a reviewer with everything laid out. Every decision keeps a copy of the registry row
          exactly as it looked at that moment, so an answer given in July can still be explained in
          December.
        </p>

        <div className="doc-notes doc-notes--2">
          <div className="doc-note">
            <h4>For practitioners</h4>
            <p>
              One claim, submitted once. You can follow it through every stage, and if it needs a
              person to look at it you are told that rather than left watching a spinner. Approval
              issues your Immortal ID, which is yours permanently.
            </p>
          </div>
          <div className="doc-note">
            <h4>For anyone checking</h4>
            <p>
              An Immortal ID resolves to a status, a date and the registry batch behind it. Never a
              bare green tick: an answer with no date is a claim about the present that the data
              cannot support.
            </p>
          </div>
        </div>

        <h3>What it checks</h3>
        <p>
          Six rules run against every match: the licence is active, it has not expired, the holder is
          not sanctioned, the name is close enough to the registry name, exactly one registry row
          matched, and any uploaded document agrees with the claim. Each returns pass, review, fail
          or skipped, and the aggregate decides. Anything ambiguous goes to a person.
        </p>

        <h3>Which registers</h3>
        {/*
          The record count column is gone. It was an array of four figures
          indexed by position, which produced nothing at all once the council
          list grew past four, and the only way to keep it would have been to
          invent counts for registers we hold no rows for. Made up numbers on a
          public page about verification is the wrong trade.
        */}
        <div className="doc-table-wrap">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Council or state</th>
              </tr>
            </thead>
            <tbody>
              {councils.map((council) => (
                <tr key={council.code}>
                  <td className="doc-code">{council.code}</td>
                  <td>{council.canonicalName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="doc-aside">
          <p>
            Council is half the natural key for a registry record, so adding a register is a new
            set of rows rather than a change to the schema. Nothing in the system hardcodes a
            single council outside configuration. Codes follow ISO 3166-2:IN, which is also what
            the national registration numbers embed, so our key and the source document's own
            identifier agree.
          </p>
        </div>

        <div className="flex flex-wrap gap-7 pt-4">
          <Link className="cta" to="/submit">
            Submit a claim <span aria-hidden="true">→</span>
          </Link>
          <Link className="cta cta--quiet" to="/">
            Read the full specification <span aria-hidden="true">→</span>
          </Link>
          <Link className="cta cta--quiet" to="/developers">
            Developer reference <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
