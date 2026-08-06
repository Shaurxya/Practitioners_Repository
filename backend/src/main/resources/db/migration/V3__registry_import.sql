-- V3__registry_import.sql
--
-- The PDF import pipeline: parser profiles, batch lifecycle, staged rows,
-- per page telemetry, and the correction log that measures parser accuracy.
--
-- Nothing here writes to registry_records. That happens once, in the PROMOTING
-- transition, from rows an admin has already looked at. The whole point of a
-- staging table is that extracted data is never live data until a human says so.


-- ---------------------------------------------------------------------------
-- Parser profiles
--
-- One profile per register shape, not per upload. A council publishes the same
-- layout every quarter, so the column mapping is confirmed once and reused.
--
-- Everything the Python extraction service needs to know about the DOMAIN lives
-- in this row and is sent to it in the request body. The sidecar carries
-- algorithms only: no regexes, no status vocabulary, no date conventions of its
-- own. Two copies of that knowledge would drift, and a drifted status
-- vocabulary silently maps ACTIVE rows to UNKNOWN with no error anywhere.
-- ---------------------------------------------------------------------------
CREATE TABLE parser_profile (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL UNIQUE,
    council_code text NOT NULL REFERENCES councils (code),

    -- LATTICE for ruled tables, STREAM for whitespace aligned ones. AUTO lets
    -- the sidecar decide per page and report which it chose, which is useful
    -- while a profile is being tuned and a liability once it is trusted.
    table_mode text NOT NULL DEFAULT 'AUTO'
        CONSTRAINT parser_profile_table_mode_check
        CHECK (table_mode IN ('LATTICE', 'STREAM', 'AUTO')),

    -- ---- shape fingerprint, checked on every upload ----
    -- Ordered list of regexes, one per expected column, matched against the
    -- detected header row. This is the "fail loudly if the document shape
    -- changed" check. A council reformatting is common and a silently
    -- mismapped column is worse than a failed import, so a mismatch is an
    -- error, never a best effort remap.
    header_patterns jsonb NOT NULL,

    -- Detected column index -> canonical field name. Confirmed by a human, once.
    column_map jsonb NOT NULL,

    -- ---- field level expectations ----
    license_format_regex text NOT NULL,

    -- Separate from any format string on purpose. 03/04/2019 is not resolvable
    -- without knowing whether this register writes day first. Guessing here
    -- puts expiry dates a month or a decade out with nothing to show for it.
    date_convention text NOT NULL
        CONSTRAINT parser_profile_date_convention_check
        CHECK (date_convention IN ('DMY', 'MDY', 'YMD')),

    -- Every date pattern observed in this register, in try order. A date
    -- matching none of them is a reject, not a guess.
    date_patterns jsonb NOT NULL,

    -- Raw status string -> one of the registry_records status values. A raw
    -- status absent from this map is a reject. There is no default, because a
    -- defaulted status is how a suspended practitioner reads as active.
    status_vocabulary jsonb NOT NULL,

    -- Below this per character OCR confidence a license number is never auto
    -- accepted, it is flagged for confirmation in the diff preview. High on
    -- purpose: this field is the natural key the matcher runs on, so one wrong
    -- character invents a practitioner and erases a real one at the same time.
    min_license_char_confidence numeric(4, 3) NOT NULL DEFAULT 0.950,

    -- Other fields tolerate a bad character, so they get a lower bar.
    min_field_confidence numeric(4, 3) NOT NULL DEFAULT 0.700,

    confirmed_at timestamptz,
    confirmed_by text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN parser_profile.header_patterns IS
    'Ordered regexes matched against the detected header row. A mismatch fails '
    'the import loudly rather than remapping columns on a guess.';


-- ---------------------------------------------------------------------------
-- Import batches
--
-- The lifecycle in the original brief was UPLOADED -> PARSING -> PARSED ->
-- PROMOTING -> PROMOTED. That cannot express this pipeline, because two steps
-- stop and wait for a human:
--
--   1. the page classification breakdown is shown BEFORE extraction runs, so
--      a fully scanned register is known to be a hard one upfront
--   2. the column mapping is confirmed before any row is parsed
--
-- Without states for those, the choice is to block a request thread on a human
-- or to proceed without the confirmation the design exists to require.
-- Hence AWAITING_CLASSIFY_OK and AWAITING_MAPPING.
--
-- Three failure states rather than one, for the same reason case FAILED exists
-- in the verification machine: "your PDF is encrypted", "the sidecar died at
-- page 380" and "promotion hit a constraint" need different screens and
-- different actions.
-- ---------------------------------------------------------------------------
CREATE TABLE import_batch (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Becomes registry_records.source_batch on promotion, which is the string
    -- the public verify endpoint prints. It is shown to the outside world, so
    -- it is chosen by a human rather than derived from a filename.
    label text NOT NULL,

    parser_profile_id uuid REFERENCES parser_profile (id),

    status text NOT NULL DEFAULT 'UPLOADED'
        CONSTRAINT import_batch_status_check CHECK (status IN (
            'UPLOADED',
            'CLASSIFYING',
            'AWAITING_CLASSIFY_OK',
            'CLASSIFY_FAILED',
            'AWAITING_MAPPING',
            'PARSING',
            'PARSED',
            'AWAITING_PROMOTE_OK',
            'PARSE_FAILED',
            'PROMOTING',
            'PROMOTED',
            'PROMOTE_FAILED',
            'CANCELLED'
        )),

    -- ---- the source PDF ----
    source_object_key text   NOT NULL,
    source_filename   text   NOT NULL,
    source_sha256     text   NOT NULL,
    source_bytes      bigint NOT NULL,

    -- ---- classification pass, cheap, runs before extraction ----
    page_count        integer,
    text_layer_pages  integer,
    scanned_pages     integer,
    unreadable_pages  integer,

    -- ---- extraction progress and totals ----
    pages_done     integer NOT NULL DEFAULT 0,
    rows_extracted integer NOT NULL DEFAULT 0,
    rows_rejected  integer NOT NULL DEFAULT 0,

    -- What the document itself claims to contain, when it says so anywhere
    -- ("This register contains 12,480 practitioners"). Null when it does not.
    -- The gap between this and rows_extracted is the single most valuable
    -- number on the report screen: silent partial extraction is the failure
    -- that causes mass revocation on the next re-verification run.
    declared_row_count integer,

    extraction_report jsonb,

    failure_code   text,
    failure_detail text,

    extraction_started_at   timestamptz,
    -- Written by every progress callback from the sidecar. A sweep moves any
    -- PARSING batch with a stale heartbeat to PARSE_FAILED, so a sidecar that
    -- dies mid run cannot leave a batch stuck in PARSING forever.
    extraction_heartbeat_at timestamptz,

    promoted_at     timestamptz,
    promoted_by     text,
    promote_reason  text,

    uploaded_by text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Uploading the same PDF twice is a mistake, not an intention. Same reasoning
-- as content_hash on registry_records: identity comes from content, not name.
-- Partial, so a cancelled batch does not block a corrected re-upload.
CREATE UNIQUE INDEX uq_import_batch_source_sha
    ON import_batch (source_sha256)
    WHERE status <> 'CANCELLED';

CREATE INDEX idx_import_batch_status ON import_batch (status, created_at DESC);

-- Feeds the watchdog sweep. Partial, because only a running extraction can be
-- stuck, and this keeps the index to the handful of live rows.
CREATE INDEX idx_import_batch_heartbeat
    ON import_batch (extraction_heartbeat_at)
    WHERE status IN ('CLASSIFYING', 'PARSING', 'PROMOTING');


-- ---------------------------------------------------------------------------
-- Per page telemetry
--
-- One row per page of the PDF. This table is what makes page level confidence
-- computable at all: without it there is no way to ask "which pages yielded
-- fewer rows than this document's own average", and that question is the one
-- that catches the last fifty pages failing silently.
-- ---------------------------------------------------------------------------
CREATE TABLE import_page (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id uuid    NOT NULL REFERENCES import_batch (id),
    page_number     integer NOT NULL,

    -- Classified per page, never per document. Hybrid registers are normal: a
    -- text layer cover with a scanned body, or scans inserted into a digital
    -- file. Classifying once for the document loses half the register quietly.
    classification text NOT NULL
        CONSTRAINT import_page_classification_check
        CHECK (classification IN ('TEXT_LAYER', 'SCANNED', 'UNREADABLE')),

    -- Extractable characters relative to page area is what decides the above.
    -- A page with 12 characters is a scan with a stray watermark, not a text page.
    char_count       integer,
    rotation_degrees integer NOT NULL DEFAULT 0,

    -- Which strategy actually ran, which matters when table_mode is AUTO.
    table_mode_used text,

    rows_extracted      integer NOT NULL DEFAULT 0,
    mean_ocr_confidence numeric(4, 3),

    -- Rows on this page against the document's own per page average. Not an
    -- absolute threshold: a register with 8 rows a page and one with 60 are
    -- both normal, and only the document can say which it is.
    page_confidence numeric(4, 3),

    anomaly_code text
        CONSTRAINT import_page_anomaly_check CHECK (anomaly_code IS NULL OR anomaly_code IN (
            'ZERO_ROWS',
            'LOW_ROW_COUNT',
            'LOW_OCR_CONFIDENCE',
            'COLUMN_DRIFT',
            'NO_TABLE_FOUND',
            'ROTATED'
        )),

    CONSTRAINT uq_import_page UNIQUE (import_batch_id, page_number)
);

CREATE INDEX idx_import_page_anomaly
    ON import_page (import_batch_id)
    WHERE anomaly_code IS NOT NULL;


-- ---------------------------------------------------------------------------
-- Staged rows
--
-- Extracted rows waiting for a human. Same raw and normalized column pairs as
-- registry_records, so promotion is a straight copy with no reshaping, plus the
-- provenance and confidence that only exist while a row is still a candidate.
-- ---------------------------------------------------------------------------
CREATE TABLE registry_staging_record (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id uuid NOT NULL REFERENCES import_batch (id),

    source_page      integer NOT NULL,
    source_row_index integer NOT NULL,

    -- The whole row exactly as extracted, before column splitting. When a
    -- reviewer disagrees with a parsed field this is what they read to decide,
    -- and it is the only way to tell a bad OCR from a bad column mapping.
    raw_row_text text NOT NULL,

    -- ---- raw, as extracted ----
    license_no_raw        text,
    full_name_raw         text,
    council_raw           text,
    status_raw            text,
    specialty_raw         text,
    qualification_raw     text,
    registration_date_raw text,
    valid_until_raw       text,

    -- ---- normalized by the Java Normalizer, never by Python ----
    -- Null until the row parses cleanly. A second normalizer implementation in
    -- the sidecar would drift from the matcher's, and when it does nothing
    -- matches and there is no error message anywhere to say why.
    license_no_normalized text,
    full_name_normalized  text,
    council_code          text REFERENCES councils (code),
    status                text,
    registration_date     date,
    valid_until           date,

    -- ---- confidence ----
    -- Field name -> per cell confidence. OCR engine confidence on scanned
    -- pages, 1.0 on text layer pages.
    cell_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Lowest cell confidence across required fields, penalised for parse and
    -- format failures. The diff preview sorts ascending on this, so the worst
    -- rows are read first rather than found by scrolling.
    row_confidence numeric(4, 3) NOT NULL DEFAULT 1.000,

    -- Broken out of cell_confidence because it alone gates promotion.
    license_confidence numeric(4, 3),

    -- Set when license_confidence is under the profile threshold, or when the
    -- license number failed its format check, or when the classic OCR
    -- confusions are present in it: 0/O, 1/I/l, 5/S, 8/B, 2/Z.
    needs_confirmation boolean NOT NULL DEFAULT false,
    confirmation_codes jsonb  NOT NULL DEFAULT '[]'::jsonb,

    confirmed_at timestamptz,
    confirmed_by text,

    -- ---- diff against the live registry ----
    content_hash text,

    diff_verdict text
        CONSTRAINT registry_staging_diff_check CHECK (diff_verdict IS NULL OR diff_verdict IN (
            'INSERT', 'UPDATE', 'UNCHANGED', 'CONFLICT'
        )),
    diff_against_record_id uuid REFERENCES registry_records (id),

    -- Nulled whenever a field is corrected, which forces a re-diff before
    -- promotion can run. A corrected license number changes the natural key,
    -- which changes which registry row this diffs against, which can flip an
    -- INSERT into an UPDATE. Promoting from a diff computed before the
    -- correction writes the row the admin just fixed to the wrong place.
    diff_computed_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_registry_staging_source UNIQUE (import_batch_id, source_page, source_row_index)
);

-- The diff preview's default ordering, worst first.
CREATE INDEX idx_staging_worst_first
    ON registry_staging_record (import_batch_id, row_confidence ASC);

-- The "show me only what needs confirming" filter, which is where an admin
-- reviewing a large batch actually starts.
CREATE INDEX idx_staging_needs_confirmation
    ON registry_staging_record (import_batch_id)
    WHERE needs_confirmation AND confirmed_at IS NULL;

-- Promotion reads by verdict, and refuses to run while any row in the batch
-- still has a null diff_computed_at.
CREATE INDEX idx_staging_verdict
    ON registry_staging_record (import_batch_id, diff_verdict);


-- ---------------------------------------------------------------------------
-- Correction log
--
-- Every field an admin fixes in the diff preview. This is the accuracy
-- dataset, and it is the only honest way to know whether a change to the
-- pipeline improved anything: without a before and after on the same
-- documents, a parser change is a feeling.
-- ---------------------------------------------------------------------------
CREATE TABLE field_correction (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    staging_record_id  uuid NOT NULL REFERENCES registry_staging_record (id),
    import_batch_id    uuid NOT NULL REFERENCES import_batch (id),

    field_name       text NOT NULL,
    extracted_value  text,
    corrected_value  text NOT NULL,

    extracted_confidence numeric(4, 3),
    source_page          integer NOT NULL,

    -- Denormalized from import_page on purpose. The question this table exists
    -- to answer is "are scanned pages worse than text pages, and by how much",
    -- and that has to stay answerable after a reparse rewrites import_page.
    page_classification text NOT NULL,

    corrected_by text        NOT NULL,
    corrected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_field_correction_field ON field_correction (field_name, page_classification);
CREATE INDEX idx_field_correction_batch ON field_correction (import_batch_id);

COMMENT ON TABLE field_correction IS
    'Extraction accuracy dataset. One row per field an admin corrected, with '
    'the confidence the parser reported when it got it wrong. A high '
    'confidence correction is a calibration bug and matters more than a low '
    'confidence one, which is the system working as designed.';


-- ---------------------------------------------------------------------------
-- Rejects, extended for the PDF path
--
-- The CSV path already writes here keyed on source_batch text. Both paths keep
-- using one table, because "rows that could not become a registry_record" is
-- one question regardless of what the source was.
-- ---------------------------------------------------------------------------
ALTER TABLE registry_import_rejects
    ADD COLUMN import_batch_id uuid REFERENCES import_batch (id),
    ADD COLUMN source_page     integer,
    ADD COLUMN raw_row_text    text,
    ADD COLUMN row_confidence  numeric(4, 3);

CREATE INDEX idx_registry_import_rejects_import_batch
    ON registry_import_rejects (import_batch_id)
    WHERE import_batch_id IS NOT NULL;
