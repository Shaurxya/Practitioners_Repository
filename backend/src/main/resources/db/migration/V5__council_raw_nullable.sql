-- V5__council_raw_nullable.sql
--
-- council_raw becomes nullable, because the council can now come from the batch
-- rather than from a column in the document.
--
-- WHY
--
-- V2 declared council_raw NOT NULL under the assumption that every source row
-- carries a council string, which was true of the CSV export the schema was
-- written against. It is not true of the registers we actually import. A council
-- publishes its own register and does not reprint its own name on every line:
-- the NCISM provisional national register for Goa prints the board name inside a
-- composite "registration particulars" cell, and most state registers omit it
-- entirely. The council for those rows is asserted once at upload and stamped on
-- every row of the batch.
--
-- The alternative was to synthesise a raw value, copying the council's canonical
-- name into council_raw at promote time. That is worse, and specifically it is
-- worse in the way this schema is otherwise careful to avoid. The column's
-- contract is "raw, exactly as the source gave it, never destroyed". A row whose
-- council_raw reads "Goa Board of Indian System of Medicine and Homoeopathy"
-- when the document said no such thing is indistinguishable, later, from a row
-- where the document did say it. That is a fabricated provenance record, and
-- provenance is the entire reason the raw columns exist.
--
-- NULL says the true thing: this row's council was not read from the document.
-- Where it did come from is already recorded, on the batch.
--
-- council_code stays NOT NULL. A row still cannot exist without a resolved
-- council, because that is half the natural key. Only the raw evidence is
-- optional, and only because sometimes there is none.

ALTER TABLE registry_records
    ALTER COLUMN council_raw DROP NOT NULL;

COMMENT ON COLUMN registry_records.council_raw IS
    'The council exactly as the source row spelled it, or NULL when the source '
    'row carried no council and the value was asserted for the whole batch at '
    'upload. Never synthesised from council_code: a fabricated raw value is '
    'indistinguishable later from one the document actually contained.';
