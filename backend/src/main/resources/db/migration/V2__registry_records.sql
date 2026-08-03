-- V2__registry_records.sql
--
-- The registry: a normalized copy of the external practitioner register.
-- Written only by the ingestion job, never by the verification flow, never by
-- hand. Every design choice below traces to a finding in the phase 2A profile.

-- Trigram index support, for the fuzzy name matching in step 7. Installed now
-- so the index can be created in the same migration as the column.
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ---------------------------------------------------------------------------
-- Council aliases
--
-- The profile found 13 distinct council spellings covering 4 real bodies,
-- including a misspelling ("Counsil") and an ampersand variant. If raw council
-- text entered the natural key, one practitioner recorded under two spellings
-- would become two different keys and the matcher would treat them as
-- different councils.
--
-- A table rather than a Java constant, so adding a council or a newly observed
-- spelling is a migration rather than a redeploy.
-- ---------------------------------------------------------------------------
-- One row per real body. This is the thing a council_code points at.
CREATE TABLE councils (
    code           text PRIMARY KEY,     -- MH, KA, KL, GJ
    canonical_name text NOT NULL
);

-- Many spellings, one code. Separate table because the alias list grows every
-- time the source export changes wording, while the council list almost never does.
CREATE TABLE council_aliases (
    alias_normalized text PRIMARY KEY,   -- uppercased, punctuation collapsed
    council_code     text NOT NULL REFERENCES councils (code)
);

COMMENT ON TABLE council_aliases IS
    'Maps every observed spelling of a council to one canonical code. '
    'Ingestion rejects rows whose council is not listed here, rather than '
    'guessing, because a wrong council code silently breaks the natural key.';


-- ---------------------------------------------------------------------------
-- Registry records
-- ---------------------------------------------------------------------------
CREATE TABLE registry_records (
    -- Surrogate key. External identifiers make bad primary keys: they change,
    -- they repeat, and they leak into URLs.
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ---- raw, exactly as the source gave it, never destroyed ----
    license_no_raw        text NOT NULL,
    full_name_raw         text NOT NULL,
    council_raw           text NOT NULL,
    status_raw            text,
    specialty_raw         text,
    qualification_raw     text,
    registration_date_raw text,
    valid_until_raw       text,

    -- ---- normalized, produced by com.herbimmortal.verification.util.Normalizer ----
    -- license_no_normalized is council-prefixed and alphanumeric only.
    -- The profile found 10.3% of rows omit the council prefix, so 'MH4471' and
    -- '4471' on a Maharashtra row must land on the same value or one exact
    -- match in ten fails for no visible reason.
    license_no_normalized text NOT NULL,
    full_name_normalized  text NOT NULL,
    council_code          text NOT NULL REFERENCES councils (code),
    status                text NOT NULL,
    registration_date     date,
    valid_until           date,

    -- ---- provenance ----
    source_batch      text        NOT NULL,
    source_row_number integer     NOT NULL,
    raw_payload       jsonb       NOT NULL,
    content_hash      text        NOT NULL,
    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    synced_at         timestamptz NOT NULL DEFAULT now(),

    -- Nothing is hard deleted. A row that vanishes from a later full batch is
    -- flagged, not removed, so a decision made against it can still be explained.
    present_in_latest_batch boolean NOT NULL DEFAULT true,

    -- A text column with a CHECK rather than a native Postgres enum. Native
    -- enums cannot have a value removed and adding one is a schema change that
    -- locks; a CHECK constraint is a one line migration to alter.
    CONSTRAINT registry_records_status_check CHECK (
        status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'INACTIVE', 'UNKNOWN')
    )
);

-- ---------------------------------------------------------------------------
-- Indexes. One justification each, and the write cost each one adds.
-- ---------------------------------------------------------------------------

-- 1. THE UPSERT KEY, and the reason ingestion can be re-run safely.
--
-- The natural key is NOT unique: the profile found 47 license+council pairs on
-- more than one row, 29 of which genuinely differ in status and expiry. Those
-- are real rows, not import noise, and dropping either one loses information.
--
-- So uniqueness includes content_hash, a digest of the normalized business
-- fields only (not provenance). Consequences:
--   - two genuinely different rows sharing a licence coexist, as they must
--   - re-running the same file produces identical hashes, so ON CONFLICT fires
--     and only source_batch and synced_at change. That is idempotency.
-- Write cost: one B-tree maintained per insert. Unavoidable, it is the upsert
-- target.
CREATE UNIQUE INDEX uq_registry_records_identity
    ON registry_records (license_no_normalized, council_code, content_hash);

-- 2. THE MATCH LOOKUP. Every verification does exactly this:
--      WHERE license_no_normalized = ? AND council_code = ?
-- Deliberately NOT unique. Duplicate resolution is the matcher's problem and
-- surfaces to a human through the SINGLE_CANDIDATE rule.
-- Write cost: a second B-tree on the same two columns. Index 1 could serve
-- this query as a prefix, so this is arguably redundant. It is kept because
-- index 1 is wider by a 64 character hash, which makes it roughly 3x the pages
-- to scan for the hottest query in the system. Drop it if writes ever hurt.
-- PARTIAL, on present_in_latest_batch. When a council corrects a name, the new
-- content hash inserts a NEW row and the old one is flagged out by the sweep at
-- the end of ingestion. Without the partial predicate the matcher would see
-- both versions, fail SINGLE_CANDIDATE, and route every one of those
-- practitioners to a human for no reason. The old row stays in the table so a
-- past decision can still be explained.
CREATE INDEX idx_registry_records_natural_key
    ON registry_records (license_no_normalized, council_code)
    WHERE present_in_latest_batch;

-- 3. FUZZY NAME SEARCH, for step 7. GIN over trigrams supports
--      WHERE full_name_normalized % ?      (similarity operator)
--    which no B-tree can answer.
-- Write cost: GIN is the expensive one here, meaningfully slower to update
-- than a B-tree and larger on disk. Acceptable because this table is written
-- by a batch job a few times a day and read on every verification.
CREATE INDEX idx_registry_records_name_trgm
    ON registry_records USING gin (full_name_normalized gin_trgm_ops);

-- 4. INGESTION RECONCILIATION. The job counts and flags rows by batch, and the
--    "rows that vanished from this batch" sweep filters on exactly this.
-- Write cost: small, a narrow B-tree on a low cardinality column.
CREATE INDEX idx_registry_records_source_batch
    ON registry_records (source_batch);

-- No index on valid_until yet. The re-verification job in step 10 will filter
-- on it, and it gets added then, with that query in hand. Adding it now would
-- be speculative.


-- ---------------------------------------------------------------------------
-- Rejects. Rows that cannot be parsed are never silently dropped.
-- ---------------------------------------------------------------------------
CREATE TABLE registry_import_rejects (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_batch      text        NOT NULL,
    source_row_number integer     NOT NULL,
    raw_payload       jsonb       NOT NULL,
    reason_code       text        NOT NULL,
    reason_detail     text,
    rejected_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_registry_import_rejects_batch
    ON registry_import_rejects (source_batch, reason_code);

COMMENT ON TABLE registry_import_rejects IS
    'One row per source row that could not become a registry_record. '
    'Row counts must reconcile: source rows = inserted + updated + unchanged + rejected.';


-- ---------------------------------------------------------------------------
-- Seed the council aliases observed in the current export.
-- alias_normalized is uppercase with all non-alphanumeric characters collapsed
-- to single spaces, which is what Normalizer.normalizeCouncilAlias produces.
-- ---------------------------------------------------------------------------
INSERT INTO councils (code, canonical_name) VALUES
    ('MH', 'Maharashtra Council of Indian Medicine'),
    ('KA', 'Karnataka Ayurvedic and Unani Practitioners Board'),
    ('KL', 'Kerala State Medical Council (Indian Systems of Medicine)'),
    ('GJ', 'Gujarat Board of Ayurvedic and Unani Systems of Medicine');

INSERT INTO council_aliases (alias_normalized, council_code) VALUES
    ('MAHARASHTRA COUNCIL OF INDIAN MEDICINE',  'MH'),
    ('MAHARASHTRA COUNSIL OF INDIAN MEDICINE',  'MH'),
    ('MAHARASHTRA COUNCIL OF INDIAN MED',       'MH'),
    ('KARNATAKA AYURVEDIC AND UNANI PRACTITIONERS BOARD', 'KA'),
    ('KARNATAKA AYURVEDIC UNANI PRACTITIONERS BOARD',     'KA'),
    ('KERALA STATE MEDICAL COUNCIL INDIAN SYSTEMS OF MEDICINE', 'KL'),
    ('KERALA STATE MEDICAL COUNCIL ISM',        'KL'),
    ('KERALA STATE MEDICAL COUNCIL',            'KL'),
    ('GUJARAT BOARD OF AYURVEDIC AND UNANI SYSTEMS OF MEDICINE', 'GJ'),
    ('GUJARAT BOARD OF AYURVEDIC UNANI SYSTEMS OF MEDICINE',     'GJ');
