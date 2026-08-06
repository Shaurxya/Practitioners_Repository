-- V6__partial_promotion.sql
--
-- Lets a batch promote the rows that are ready and keep the rest staged.
--
-- WHY
--
-- Promotion was all or nothing: one unconfirmed licence number held back the
-- whole batch. On a text layer register that is a minor annoyance. On a scanned
-- one it is the normal case, because OCR flags a handful of rows in every
-- document, and it meant 2,583 verified rows sat outside the registry waiting on
-- 9 that a human had not read yet.
--
-- The pressure that creates is the dangerous part. An admin facing "confirm all
-- 9 or promote none" is being pushed toward confirming rows they have not really
-- checked, which is precisely the judgement the confirmation step exists to
-- protect. Letting the clean rows through removes the incentive to rubber stamp
-- the dirty ones.
--
-- What does NOT change: a row still cannot promote while it needs confirmation,
-- and still cannot promote on a stale diff. Partial promotion widens what may
-- proceed, never what may skip a check.


-- ---------------------------------------------------------------------------
-- Which staged rows have already reached the registry
--
-- Set once, never cleared. This is what stops a second promotion writing the
-- same row twice, and it is what the diff preview reads to show an admin what
-- is left rather than what was.
--
-- Nullable rather than a boolean because the timestamp is the useful part: with
-- partial promotion a single batch reaches the registry in several passes, and
-- "which pass did this row go in" is a question the audit log will be asked.
-- ---------------------------------------------------------------------------
ALTER TABLE registry_staging_record
    ADD COLUMN promoted_at timestamptz;

COMMENT ON COLUMN registry_staging_record.promoted_at IS
    'When this row was written to registry_records, or NULL if it is still '
    'staged. Set once and never cleared: it is the guard against promoting the '
    'same staged row twice across successive partial promotions.';

-- The promotable set, which is the query every promotion runs first. Partial so
-- the index covers only rows still waiting, which is the shrinking side.
CREATE INDEX idx_staging_unpromoted
    ON registry_staging_record (import_batch_id, needs_confirmation)
    WHERE promoted_at IS NULL;


-- ---------------------------------------------------------------------------
-- Batch level
-- ---------------------------------------------------------------------------
ALTER TABLE import_batch
    ADD COLUMN rows_promoted integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN import_batch.rows_promoted IS
    'Rows written to registry_records so far. Reconciliation for a partially '
    'promoted batch is rows_extracted = rows_promoted + rows still staged.';

-- PARTIALLY_PROMOTED is a waiting-on-a-human state, not a terminal one: rows
-- remain staged and the batch is not finished. PROMOTED keeps its meaning of
-- "nothing left", so no existing row changes meaning under this migration.
ALTER TABLE import_batch
    DROP CONSTRAINT import_batch_status_check;

ALTER TABLE import_batch
    ADD CONSTRAINT import_batch_status_check CHECK (status IN (
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
        'PARTIALLY_PROMOTED',
        'PROMOTED',
        'PROMOTE_FAILED',
        'CANCELLED'
    ));
