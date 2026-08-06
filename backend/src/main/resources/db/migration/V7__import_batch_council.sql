-- V7__import_batch_council.sql
--
-- Records which council a batch belongs to.
--
-- WHY THIS WAS MISSING
--
-- D6 moved the council off the row and onto the batch: most registers never
-- print their own council on every line, so requiring it as a mapped column made
-- the column mapping screen unfinishable for the ordinary case. The console was
-- updated, the staging table already had council_code, and import_batch was
-- not. So the value an admin picks at upload had nowhere to live, and the only
-- reason nothing broke is that no Java has read this table yet.
--
-- Nullable, because batches predating this migration have no council and there
-- is no honest value to invent for them. New uploads set it; the extraction
-- service never sees it, since it carries algorithms only.

ALTER TABLE import_batch
    ADD COLUMN council_code text REFERENCES councils (code);

COMMENT ON COLUMN import_batch.council_code IS
    'The council whose register this batch contains, asserted once at upload. '
    'Stamped onto every row the batch promotes unless the document itself '
    'carries a council column, which overrides it per row. Nullable only for '
    'batches created before the council moved onto the batch.';

CREATE INDEX idx_import_batch_council
    ON import_batch (council_code, created_at DESC)
    WHERE council_code IS NOT NULL;
