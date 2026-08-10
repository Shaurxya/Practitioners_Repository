import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Colophon, Masthead } from '@/app/layouts/Chrome'
import { buildImmortalId } from '@/features/public-verify/immortalId'
import {
  API,
  DECISIONS,
  ENTITIES,
  IN_FLIGHT,
  PHASES,
  PIPELINE,
  RULES,
  SECTIONS,
  SPEC_ROWS,
  STACK,
  TENETS,
  TERMINAL,
  TRANSITIONS,
} from '@/features/landing/content'

/**
 * The landing page, and the only page that documents the whole system.
 *
 * It sits outside RootLayout because it carries no application shell of its
 * own beyond the shared masthead and colophon, but it uses the same chrome,
 * palette and type as every other route.
 *
 * The one piece of application code it imports is buildImmortalId, so the
 * specimen in section 02 is a genuinely valid identifier rather than a
 * plausible looking one. If the format changes, this page breaks at the build
 * rather than quietly documenting a format nothing issues any more.
 */
export function LandingPage() {
  const rootRef = useReveal()

  return (
    <div className="doc" ref={rootRef}>
      <Masthead />

      <main id="top">
        <Hero />
        <Contents />

        <Section id="premise" index="01" title="Premise">
          <p className="doc-lead">
            A license is only worth what the registry says about it today. This service holds a
            normalized copy of the council registry, decides whether a claimed identity corresponds
            to a real record in good standing, and keeps the reasoning where a person can read it.
          </p>
          <p>
            A practitioner signs up, submits a claimed identity and supporting documents, and the
            system answers with a decision plus the evidence behind it. When the answer is yes, the
            practitioner receives an <strong>Immortal ID</strong>, a permanent public identifier the
            rest of the platform uses to ask one question and only one: is this person verified
            right now.
          </p>
          <div className="doc-notes doc-notes--2">
            <div className="doc-note">
              <h4>Not a document store</h4>
              <p>
                Certificates and identity scans are evidence. The registry is truth. A document can
                support a claim, it can never establish one, and the system is built so that no
                amount of convincing paperwork outranks a registry row that says suspended.
              </p>
            </div>
            <div className="doc-note">
              <h4>Not fully automated</h4>
              <p>
                Ambiguity routes to a human by design. Two registry rows with the same name in the
                same council is not noise to be scored away, it is a question that a reviewer with
                the case in front of them answers in ten seconds.
              </p>
            </div>
          </div>
          <div className="doc-aside">
            <p>
              Scope for v1 is one country, one script, four state councils and roughly thirty
              thousand registry rows. Council is already half the natural key, so a fifth registry
              is a new set of rows rather than a schema change.
            </p>
          </div>
        </Section>

        <Section id="immortal-id" index="02" title="The Immortal ID">
          <p className="doc-lead">
            One identifier, issued once, on the first approval, in the same transaction as the
            status change.
          </p>
          <Specimen />
          <div className="doc-facts doc-facts--3">
            <Fact term="Readable">
              <b>HI-26INA</b> reads as registered in 2026, in India, in Ayurveda. Four of the
              fourteen characters carry meaning, which is what lets a support agent recognise a
              wrong ID without a database behind them.
            </Fact>
            <Fact term="Entropy">
              Five random characters from A-Z and 0-9 is <b>60,466,176</b> per year, country and
              system. That space is per prefix, not global, which is the number that matters: two
              practitioners registered in the same year, country and system draw from one bucket.
            </Fact>
            <Fact term="What that cost">
              The earlier format spent those characters on entropy instead and carried a check
              character, so a typo was caught in the browser. This one cannot do that. A mistyped
              ID now reaches the server and comes back <b>not verified</b> rather than "you
              mistyped that", and the rate limiter carries more of the load than it did.
            </Fact>
            <Fact term="Permanence">
              Issued on the <b>first</b> transition into APPROVED and never reissued. A practitioner
              who is revoked and later approved again gets the same ID back. Status changes,
              identity does not.
            </Fact>
            <Fact term="Not the matching key">
              First contact keys on council plus normalized license number, because the registry is
              external data and <b>cannot contain an identifier we invented</b>. The two lookups are
              never interchangeable.
            </Fact>
            <Fact term="Collisions">
              A unique constraint at the database, generation retried on violation. The retry lives
              <b> outside</b> the transaction: in Postgres a constraint violation aborts the whole
              transaction, so retrying inside it fails a second time on a dead session.
            </Fact>
          </div>
          <div className="doc-aside">
            <p>
              Issuance writes its own IMMORTAL_ID_ISSUED audit event, separate from the status
              change event for the same transition. Two facts happened, so two rows record them.
            </p>
          </div>
        </Section>

        <Section id="model" index="03" title="Domain model">
          <p className="doc-lead">
            Six tables. The interesting decisions are about what each one is forbidden to hold.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Holds</th>
                  <th>Constraint that matters</th>
                </tr>
              </thead>
              <tbody>
                {ENTITIES.map((entity) => (
                  <tr key={entity.name}>
                    <td>
                      <span className="doc-code">{entity.name}</span>
                      <br />
                      <span style={{ fontSize: 12.5 }}>{entity.role}</span>
                    </td>
                    <td className="doc-code" style={{ whiteSpace: 'normal', fontSize: 11.5 }}>
                      {entity.fields}
                    </td>
                    <td>{entity.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Practitioner status is <strong>derived, never stored</strong>. There is no is_verified
            column. The public endpoint reads practitioner, then current case, then that case's
            status, every single time, because a denormalized flag is precisely how a revoked
            practitioner keeps reading as verified for another six hours.
          </p>
        </Section>

        <Section id="pipeline" index="04" title="Verification pipeline">
          <p className="doc-lead">
            Intake answers immediately. Everything after it is asynchronous, so no request thread
            ever waits on OCR or a fuzzy match.
          </p>
          <div className="doc-flow">
            {PIPELINE.map((step) => (
              <div
                key={step.title}
                className={step.branch ? 'doc-step doc-step--branch' : 'doc-step'}
              >
                <h4>{step.title}</h4>
                <p>{step.detail}</p>
              </div>
            ))}
          </div>
          <h3>Why a rule interface instead of a chain of conditionals</h3>
          <p>
            The alternative is one DecisionService full of branches. It works until someone asks for
            a new check, and then the diff lands in the single class every verification path runs
            through, which is also the class with the most test coverage and the most risk. With one
            component per rule, adding a check is: write a class, write a test for it in isolation,
            done. The engine never inspects rule codes, it only aggregates outcomes, so it is closed
            for modification.
          </p>
          <p>
            Revisit that when rules need ordering or short circuiting for cost reasons. At seven in
            memory checks, running all of them always is both correct and simpler.
          </p>
        </Section>

        <Section id="states" index="05" title="Status machine">
          <p className="doc-lead">
            An explicit map of allowed transitions. Anything not in the map throws, and the handler
            turns that into a 409 rather than a corrupted case.
          </p>
          <div className="doc-states">
            <section>
              <h4>In flight</h4>
              <ul>
                {IN_FLIGHT.map((status) => (
                  <li key={status}>{status}</li>
                ))}
              </ul>
            </section>
            <section>
              <h4>Terminal</h4>
              <ul>
                {TERMINAL.map((status) => (
                  <li key={status} data-terminal="true">
                    {status}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <ul className="doc-transitions">
            {TRANSITIONS.map(([from, to]) => (
              <li key={`${from}-${to}`}>
                <b>{from}</b> → {to}
              </li>
            ))}
          </ul>
          <h3>Four corrections to the obvious version</h3>
          <div className="doc-notes doc-notes--2">
            <div className="doc-note">
              <h4>Re-verification opens a new case</h4>
              <p>
                Sending an expired case back to MATCHING would overwrite its decision timestamp and
                its registry snapshot, which contradicts both "one case is one attempt" and the
                promise that a decision can be reconstructed later. EXPIRED stays terminal and the
                practitioner's current case pointer moves.
              </p>
            </div>
            <div className="doc-note">
              <h4>Revoked has a way back</h4>
              <p>
                Same mechanism. The case stays terminal, a later case can approve the person again,
                and the Immortal ID lives on the practitioner so it survives the round trip
                untouched.
              </p>
            </div>
            <div className="doc-note">
              <h4>Found or not found is not a rule</h4>
              <p>
                The matching stage decides it. Zero candidates means NO_MATCH means a human, always.
                A LICENSE_FOUND rule could never fail where it ran, because reaching evaluation
                already proves a record was found.
              </p>
            </div>
            <div className="doc-note">
              <h4>A crashed pipeline needs a state</h4>
              <p>
                OCR times out, the registry table is locked, the matcher throws. Without FAILED
                those cases sit in MATCHING forever and nothing distinguishes in progress from dead.
                FAILED has a retry edge back to MATCHING and raises an alert.
              </p>
            </div>
          </div>
        </Section>

        <Section id="rules" index="06" title="Rule catalog">
          <p className="doc-lead">
            Four outcomes, not a boolean. Pass, route to a human, hard fail, and could not run.
          </p>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Check</th>
                  <th>Pass</th>
                  <th>Review</th>
                  <th>Fail</th>
                  <th>Required</th>
                </tr>
              </thead>
              <tbody>
                {RULES.map((rule) => (
                  <tr key={rule.code}>
                    <td className="doc-code">{rule.code}</td>
                    <td>{rule.check}</td>
                    <td>{rule.pass || <span className="doc-nil">n/a</span>}</td>
                    <td>{rule.review || <span className="doc-nil">n/a</span>}</td>
                    <td>{rule.fail || <span className="doc-nil">n/a</span>}</td>
                    <td>
                      {rule.required ? (
                        <span className="doc-yes">Yes</span>
                      ) : (
                        <span className="doc-nil">Phase 9</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The document check returns SKIPPED until OCR ships, and the engine ignores it. That is
            what the fourth outcome is for: the catalog is written once, and rules light up as their
            inputs arrive without anyone editing the engine or the decision logic. A skipped result
            for a rule marked required is promoted to review rather than quietly ignored.
          </p>
        </Section>

        <Section id="guarantees" index="07" title="Guarantees">
          <p className="doc-lead">
            Eight properties that hold regardless of what else changes. Everything above is an
            implementation of these.
          </p>
          <ol className="doc-list">
            {TENETS.map(([title, detail]) => (
              <li key={title}>
                <span>
                  <b>{title}</b> {detail}
                </span>
              </li>
            ))}
          </ol>
          <div className="doc-aside">
            <p>
              One known tension: a practitioner's right to erasure pulls against an append only
              audit log. Out of scope for v1, but personal data in audit metadata sits in its own
              columns rather than inline in free text, so it can be crypto shredded later without
              rewriting history.
            </p>
          </div>
        </Section>

        <Section id="api" index="08" title="API surface">
          <p className="doc-lead">
            Four groups, three audiences. Practitioners, reviewers, and machines.
          </p>
          <div className="doc-routes">
            {API.map((group) => (
              <div key={group.label}>
                <h4>{group.label}</h4>
                {group.routes.map((route) => (
                  <div className="doc-route" key={route.path + route.method}>
                    <i>{route.method}</i>
                    <code>{route.path}</code>
                    <span>{route.note}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <h3>The public answer is never a bare boolean</h3>
          <pre className="doc-pre">
            <code>
              {'{\n'}
              {'  '}<b>"immortalId"</b>: <em>"{buildImmortalId(2026, 'IN', 'A', 'K3M7Q')}"</em>,{'\n'}
              {'  '}<b>"displayName"</b>: <em>"A. Sharma"</em>,{'\n'}
              {'  '}<b>"status"</b>: <em>"VERIFIED"</em>,{'\n'}
              {'  '}<b>"verifiedAsOf"</b>: <em>"2026-07-14"</em>,{'\n'}
              {'  '}<b>"registrySourceBatch"</b>: <em>"council-2026-07-14"</em>,{'\n'}
              {'  '}<b>"council"</b>: <em>"MH"</em>,{'\n'}
              {'  '}<b>"country"</b>: <em>"India"</em>,{'\n'}
              {'  '}<b>"medicalSystem"</b>: <em>"Ayurveda"</em>{'\n'}
              {'}'}
            </code>
          </pre>
          <p>
            The interface renders that as "verified as of 14 July 2026, source council-2026-07-14".
            A tick with no date is a claim about the present that the underlying data cannot
            support, and the batch name is what lets anyone trace the answer back to a source.
          </p>
          <p>
            Ownership is checked separately from role. A practitioner requesting a case that is not
            theirs gets <code>404</code> rather than <code>403</code>, so the endpoint never confirms
            that someone else's case exists.
          </p>
        </Section>

        <Section id="engineering" index="09" title="Engineering">
          <h3>Stack</h3>
          <div className="doc-facts">
            {STACK.map(([label, value]) => (
              <Fact key={label} term={label}>
                {value}
              </Fact>
            ))}
          </div>

          <h3>Build order</h3>
          <p>
            No phase starts until the previous one runs on a real machine. Phases one to six are the
            actual minimum product: a verification system with a good review console and dumb
            matching is useful, one with clever matching and no console is not.
          </p>
          <div className="doc-ledger">
            {PHASES.map((phase) => (
              <div className="doc-phase" key={phase.n} data-mvp={phase.mvp}>
                <i>{phase.n}</i>
                <span>{phase.deliverable}</span>
                <em>{phase.state}</em>
              </div>
            ))}
          </div>

          <h3>Open decisions</h3>
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Question</th>
                  <th>Position</th>
                  <th>Blocks</th>
                </tr>
              </thead>
              <tbody>
                {DECISIONS.map((decision) => (
                  <tr key={decision.id}>
                    <td className="doc-num">{decision.id}</td>
                    <td>{decision.question}</td>
                    <td>{decision.answer}</td>
                    <td className="doc-code">{decision.blocks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </main>

      <section className="doc-close">
        <div className="shell">
          <p className="mono-label">
            <span className="mark" aria-hidden="true" />
            Two ways in
          </p>
          <h2>Claim your identifier, or check someone else's.</h2>
          <p>
            Practitioners submit one claim and follow it through every stage. Anyone holding an
            Immortal ID can check its status without an account, and the answer always carries the
            date and the registry batch it came from.
          </p>
          <div className="doc-close__actions">
            <Link className="cta" to="/submit">
              Submit a claim <span aria-hidden="true">→</span>
            </Link>
            <Link className="cta cta--quiet" to="/verify">
              Verify an Immortal ID <span aria-hidden="true">→</span>
            </Link>
            <Link className="cta cta--quiet" to="/developers">
              Developer reference <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <Colophon />
    </div>
  )
}

/* ------------------------------------------------------------------ sections */

function Hero() {
  return (
    <section className="doc-hero">
      <div className="shell doc-hero__inner">
        <div>
          <p className="mono-label">
            <span className="mark" aria-hidden="true" />
            Practitioner identity and credential verification
          </p>
          <h1>
            Verified against the registry, <em>on the day you ask.</em>
          </h1>
          <p className="doc-lede">
            HerbImmortal matches a practitioner's claim against a normalized copy of the council
            registry, runs an explainable catalog of rules over the match, sends anything ambiguous
            to a person, and issues a permanent identifier that answers one question: is this
            practitioner verified right now.
          </p>
          <div className="doc-hero__actions">
            <a className="cta" href="#premise">
              Read the specification <span aria-hidden="true">↓</span>
            </a>
            <Link className="cta cta--quiet" to="/verify">
              Verify an Immortal ID <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <div className="doc-spec">
          <dl>
            {SPEC_ROWS.map(([term, value]) => (
              <div key={term} style={{ display: 'contents' }}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}

function Contents() {
  return (
    <nav className="doc-contents" aria-label="Contents">
      <div className="shell">
        <p className="mono-label">Contents</p>
        <ol>
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>
                <b>{section.index}</b>
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  )
}

function Section({
  id,
  index,
  title,
  children,
}: {
  id: string
  index: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="doc-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="shell doc-section__grid doc-reveal">
        <div className="doc-section__rail">
          <p>{index}</p>
          <h2 id={`${id}-title`}>{title}</h2>
        </div>
        <div className="doc-body">{children}</div>
      </div>
    </section>
  )
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <dl className="doc-fact">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </dl>
  )
}

/**
 * The identifier, drawn as its own anatomy.
 *
 * Built through the same function that validates input, so the specimen on this
 * page is a genuinely valid ID rather than a plausible looking string. If the
 * format ever changes again and this page is not updated, the build breaks here
 * rather than shipping a marketing page that documents a format the system no
 * longer issues.
 */
function Specimen() {
  const id = buildImmortalId(2026, 'IN', 'A', 'K3M7Q')
  const [prefix, meaning, random] = id.split('-')
  const year = (meaning ?? '').slice(0, 2)
  const country = (meaning ?? '').slice(2, 4)
  const system = (meaning ?? '').slice(4)

  return (
    <div className="doc-specimen">
      <div className="doc-specimen__id" aria-label={`Example identifier ${id}`}>
        <div className="doc-glyphs" aria-hidden="true">
          {[...(prefix ?? '')].map((char, i) => (
            <span className="doc-glyph doc-glyph--fixed" key={`p${i}`}>
              {char}
            </span>
          ))}
        </div>
        <span className="doc-specimen__sep" aria-hidden="true">
          -
        </span>
        <div className="doc-glyphs" aria-hidden="true">
          {[...year].map((char, i) => (
            <span className="doc-glyph doc-glyph--check" key={`y${i}`}>
              {char}
            </span>
          ))}
          {[...country].map((char, i) => (
            <span className="doc-glyph doc-glyph--check" key={`c${i}`}>
              {char}
            </span>
          ))}
          <span className="doc-glyph doc-glyph--check">{system}</span>
        </div>
        <span className="doc-specimen__sep" aria-hidden="true">
          -
        </span>
        <div className="doc-glyphs" aria-hidden="true">
          {[...(random ?? '')].map((char, i) => (
            <span className="doc-glyph" key={`r${i}`}>
              {char}
            </span>
          ))}
        </div>
      </div>
      <div className="doc-specimen__legend">
        <div>
          <b>Prefix</b>
          Fixed. Makes the identifier recognisable in a log line or a support ticket.
        </div>
        <div>
          <b>Year, country, system</b>
          26 IN A reads as registered in 2026, in India, in Ayurveda. Set once at issue and never
          recomputed, so the identifier still decodes to what was true the day it was made.
        </div>
        <div>
          <b>Five random characters</b>
          A-Z and 0-9, which is 60,466,176 per year, country and system. Checked against the
          register before it is written, and unique at the database level so the generator is never
          the only thing standing between two people and one identifier.
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------------- hooks */

/**
 * One observer for the whole page rather than one per block. Sections are
 * visible by default in CSS terms only after this marks them, so the fallback
 * when IntersectionObserver is missing is to show everything immediately.
 */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return

    const blocks = Array.from(root.querySelectorAll<HTMLElement>('.doc-reveal'))
    if (typeof IntersectionObserver === 'undefined') {
      blocks.forEach((block) => block.setAttribute('data-shown', 'true'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          entry.target.setAttribute('data-shown', 'true')
          observer.unobserve(entry.target)
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    )

    blocks.forEach((block) => observer.observe(block))
    return () => observer.disconnect()
  }, [])

  return ref
}
