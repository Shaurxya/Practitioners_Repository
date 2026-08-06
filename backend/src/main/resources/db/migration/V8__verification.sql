-- V8__verification.sql
--
-- Practitioners, verification cases and rule results: the half of the domain
-- that V1 left as a placeholder. Until now nothing in Postgres could hold a
-- claim, so the entire verification flow lived in a browser mock.


-- ---------------------------------------------------------------------------
-- Practitioners
--
-- Keyed on the natural key of the registry itself, (council, licence), rather
-- than on an account. There is no signup yet, and the identity that matters
-- here is the registration, not the login: two claims for the same registration
-- are the same practitioner even if they arrive from different sessions.
--
-- immortal_id is NULLABLE until the first approval. Every read path has to
-- handle a practitioner without one.
-- ---------------------------------------------------------------------------
CREATE TABLE practitioners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    council_code          text NOT NULL REFERENCES councils (code),
    license_no_normalized text NOT NULL,
    full_name_raw         text NOT NULL,

    -- Issued once, on the FIRST approval, and never reissued. Unique at the
    -- database level because the generator must never be the only thing
    -- standing between two practitioners and the same identifier: 45 bits makes
    -- a collision a once-in-a-lifetime event, and this constraint is what turns
    -- that event into a retry instead of a silent identity merge.
    immortal_id text UNIQUE,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_practitioner_registration UNIQUE (council_code, license_no_normalized)
);


-- ---------------------------------------------------------------------------
-- Verification cases
--
-- One attempt to verify one practitioner. Immutable once terminal: a case that
-- could be reopened is a mutable record whose decided_at and registry_snapshot
-- get overwritten, and then we can no longer prove what we saw. Re-verification
-- opens a NEW case (D1).
-- ---------------------------------------------------------------------------
CREATE TABLE verification_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    practitioner_id uuid NOT NULL REFERENCES practitioners (id),

    status text NOT NULL
        CONSTRAINT verification_cases_status_check CHECK (status IN (
            'SUBMITTED', 'MATCHING', 'RULES_EVAL', 'NO_MATCH', 'MANUAL_REVIEW',
            'AUTO_VERIFIED', 'APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED', 'FAILED'
        )),

    -- ---- the claim exactly as submitted ----
    -- On the case, not the practitioner: a rejected practitioner can submit a
    -- corrected claim, and the original has to survive to explain the decision.
    claimed_full_name           text NOT NULL,
    claimed_registration_number text NOT NULL,
    claimed_council             text NOT NULL,
    claimed_specialty           text,

    -- ---- what matching found ----
    matched_registry_record_id uuid REFERENCES registry_records (id),
    match_confidence           numeric(4, 3),
    candidate_count            integer NOT NULL DEFAULT 0,

    -- The matched row exactly as it looked at decision time. If the registry
    -- changes later we can still prove what we saw. Non negotiable 2.
    registry_snapshot jsonb,

    submitted_at    timestamptz NOT NULL DEFAULT now(),
    decided_at      timestamptz,
    decided_by      text,
    decision_reason text
);

-- At most one open case per practitioner, enforced by the database rather than
-- by application logic. A double click must not create two cases, and a check
-- in Java loses that race.
CREATE UNIQUE INDEX uq_practitioner_open_case
    ON verification_cases (practitioner_id)
    WHERE status NOT IN ('APPROVED', 'REJECTED', 'EXPIRED', 'REVOKED');

CREATE INDEX idx_verification_cases_queue
    ON verification_cases (status, submitted_at)
    WHERE status IN ('MANUAL_REVIEW', 'NO_MATCH');


-- ---------------------------------------------------------------------------
-- Rule results
--
-- Four outcomes, not a boolean. A boolean cannot express a catalog that has to
-- say "pass", "send this to a person", "no" and "could not run", and the
-- difference between the last two is the difference between a register that
-- omits a field and a parser that failed.
-- ---------------------------------------------------------------------------
CREATE TABLE case_rule_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    case_id uuid NOT NULL REFERENCES verification_cases (id) ON DELETE CASCADE,

    rule_code text NOT NULL,
    outcome   text NOT NULL
        CONSTRAINT case_rule_results_outcome_check
        CHECK (outcome IN ('PASS', 'REVIEW', 'FAIL', 'SKIPPED')),

    -- Human readable, shown in the review console. A reviewer deciding a case
    -- needs the sentence, not the code.
    detail text NOT NULL,

    evaluated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_case_rule UNIQUE (case_id, rule_code)
);

CREATE INDEX idx_case_rule_results_case ON case_rule_results (case_id);


-- ---------------------------------------------------------------------------
-- Audit
--
-- Append only. Never updated, never deleted. No foreign key on subject_id is
-- deliberate: a polymorphic FK is not expressible in Postgres without a join
-- table per subject type, and the audit log has to outlive shape changes in the
-- tables it describes.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    event_type   text NOT NULL,
    subject_type text NOT NULL,
    subject_id   uuid NOT NULL,

    actor_type text NOT NULL
        CONSTRAINT audit_events_actor_check CHECK (actor_type IN ('USER', 'SYSTEM', 'SCHEDULED_JOB')),
    actor_id   text,

    from_status text,
    to_status   text,
    reason      text,

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_events_subject ON audit_events (subject_type, subject_id, created_at);

COMMENT ON TABLE audit_events IS
    'Append only. A decision that cannot be explained later is not a decision, '
    'it is an outcome.';
