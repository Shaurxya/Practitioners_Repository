-- V13__identity_documents.sql
--
-- Persona verification: the photo ID and the liveness selfie, plus the record
-- of what an identity provider made of them.
--
-- This is the most sensitive data the system will ever hold, and the schema is
-- shaped by that more than by anything else. Non negotiable 5 requires
-- encryption at rest, role restricted access and an audit event on every read.
-- Non negotiable 1 forbids hard deletion. Section 10 flags that those two
-- collide with a person's right to erasure and asks for PII to sit where it
-- could later be crypto shredded. The encryption columns below are that answer.


-- ---------------------------------------------------------------------------
-- Documents
--
-- The bytes live in object storage; this table is the index and the key ring.
--
-- ENCRYPTION, and why it is per document rather than per bucket.
--
-- Each object is encrypted with its own data key (a DEK), and that key is
-- stored here wrapped by a master key held in configuration. MinIO never sees
-- either one: the ciphertext arrives already encrypted.
--
-- Bucket level encryption would have been less code and cannot do the thing
-- this design needs. To erase one person you would have to delete their
-- objects, and non negotiable 1 says nothing is hard deleted, so the audit
-- trail would end up describing a document that silently no longer exists.
-- Destroying a single wrapped_dek instead leaves the row, the case, and every
-- audit event intact while making those particular bytes permanently
-- unreadable by anyone, including us. That is the difference between deleting
-- a record and revoking access to its contents, and only the second one is
-- compatible with an append only log.
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who uploaded it. Not the practitioner: a registration exists without an
    -- account, but nobody uploads a selfie without being signed in.
    owner_user_id uuid NOT NULL REFERENCES users (id),

    kind text NOT NULL
        CONSTRAINT documents_kind_check CHECK (kind IN (
            'PHOTO_ID', 'SELFIE', 'REGISTRATION_CERTIFICATE'
        )),

    -- Where it is in the bucket. Opaque and unguessable: a key derived from
    -- anything about the person would leak that thing to anyone who can list.
    storage_key text NOT NULL UNIQUE,

    content_type text NOT NULL,
    size_bytes   bigint NOT NULL CHECK (size_bytes > 0),

    -- Of the PLAINTEXT, computed before encryption. Two uploads of the same
    -- scan produce the same digest even though their ciphertexts differ,
    -- because each gets its own key and IV. That is what makes it useful for
    -- spotting the same document submitted across several claims.
    sha256 text NOT NULL,

    status text NOT NULL DEFAULT 'CONFIRMED'
        CONSTRAINT documents_status_check CHECK (status IN (
            'PENDING', 'CONFIRMED', 'QUARANTINED'
        )),

    -- ---- the key ring ----
    -- wrapped_dek NULL means crypto shredded: the object is still in the
    -- bucket and can never be read again. dek_destroyed_at records when, so
    -- the difference between "shredded" and "never had a key" stays visible.
    wrapped_dek      bytea,
    dek_iv           bytea,
    content_iv       bytea,
    dek_destroyed_at timestamptz,

    CONSTRAINT documents_shred_is_recorded
        CHECK ((wrapped_dek IS NULL) = (dek_destroyed_at IS NOT NULL)),

    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_documents_owner ON documents (owner_user_id, uploaded_at DESC);

-- Retention sweep: find everything whose key is still live and whose case went
-- terminal long enough ago. Partial, because a shredded row is never a
-- candidate again and there is no reason to keep it in the index.
CREATE INDEX idx_documents_shreddable
    ON documents (uploaded_at)
    WHERE wrapped_dek IS NOT NULL;

COMMENT ON TABLE documents IS
    'Identity evidence. Encrypted with a per document key stored wrapped in '
    'wrapped_dek. Destroying that key is how one person is erased without '
    'deleting a row the audit log refers to.';


-- ---------------------------------------------------------------------------
-- Case documents
--
-- A join table rather than two columns on verification_cases, because the same
-- ID scan can support several claims over time: a practitioner rejected on a
-- name mismatch resubmits, and re-uploading the same passport to prove the same
-- thing is pure friction.
-- ---------------------------------------------------------------------------
CREATE TABLE case_documents (
    case_id     uuid NOT NULL REFERENCES verification_cases (id) ON DELETE CASCADE,
    document_id uuid NOT NULL REFERENCES documents (id),
    linked_at   timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (case_id, document_id)
);

CREATE INDEX idx_case_documents_document ON case_documents (document_id);


-- ---------------------------------------------------------------------------
-- Identity checks
--
-- What a provider concluded about one case. Its own table rather than columns
-- on the case, for two reasons: a vendor call has its own timestamp and its own
-- retry, and a case decided by a human has no vendor result at all. Columns on
-- verification_cases would make those two states indistinguishable from a row
-- where the vendor simply has not answered yet.
--
-- PENDING_HUMAN is the outcome that matters most today. With no KYC vendor
-- wired, ManualIdentityProvider returns it, the identity rules read it as
-- REVIEW, and every claim reaches a reviewer who compares the two images
-- themselves. A human is the liveness check until a provider replaces them.
-- ---------------------------------------------------------------------------
CREATE TABLE identity_checks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- One per case. A second check for the same case would mean two answers
    -- with no rule for which wins.
    case_id uuid NOT NULL UNIQUE REFERENCES verification_cases (id) ON DELETE CASCADE,

    -- Which implementation answered. Recorded because a case decided under the
    -- manual provider and one decided by a vendor are different evidence, and
    -- a year from now nobody will remember which was running when.
    provider     text NOT NULL,
    provider_ref text,

    outcome text NOT NULL
        CONSTRAINT identity_checks_outcome_check CHECK (outcome IN (
            'PASS', 'FAIL', 'PENDING_HUMAN', 'UNAVAILABLE'
        )),

    -- 0.000 to 1.000, null when no provider computed one. Null is not zero:
    -- "nobody looked" and "looked and found no resemblance" must not collapse.
    face_match_score numeric(4, 3) CHECK (face_match_score BETWEEN 0 AND 1),
    liveness_score   numeric(4, 3) CHECK (liveness_score BETWEEN 0 AND 1),

    -- Whatever the provider returned, verbatim. Same reasoning as
    -- registry_snapshot: if the provider changes its response shape or its
    -- thresholds later, we can still say what we were told at decision time.
    evidence jsonb,

    checked_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE identity_checks IS
    'One provider verdict per case. PENDING_HUMAN means no automated check ran '
    'and a reviewer is the liveness check.';
