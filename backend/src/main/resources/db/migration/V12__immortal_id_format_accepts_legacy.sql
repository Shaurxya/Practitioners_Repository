-- V12__immortal_id_format_accepts_legacy.sql
--
-- Unfreezes every practitioner holding a pre-V9 Immortal ID.
--
-- ---------------------------------------------------------------------------
-- WHAT WENT WRONG
--
-- V9 added practitioners_immortal_id_format as NOT VALID, accepting only the
-- current HI-YYCCM-RRRRR shape, and recorded the intent as "Postgres applies it
-- to every new write and leaves existing rows alone" (CLAUDE.md 8.2).
--
-- The first half is true and the second half is not, and the gap between them
-- is the bug. NOT VALID skips the one time backfill scan. It does NOT scope the
-- constraint to new rows. Postgres evaluates a CHECK against the new row
-- version of every INSERT *and every UPDATE*, so from V9 onward any UPDATE
-- touching a row whose immortal_id was issued under the old Crockford scheme
-- fails, even an UPDATE that never mentions immortal_id:
--
--     update practitioners set updated_at = now() where immortal_id = 'HI-B0B2P-6FZVB';
--     ERROR: new row for relation "practitioners" violates check constraint
--            "practitioners_immortal_id_format"
--
-- Every legacy practitioner was therefore frozen. They could not be claimed by
-- an account, re-verified, revoked, or have their status changed by anything.
-- Section 8.1 says an Immortal ID is permanent; it does not say the person
-- holding one stops being administrable. Found by submitting a real claim
-- against the Goa register, where the practitioner already existed.
--
-- ---------------------------------------------------------------------------
-- THE FIX, AND WHY IT IS SHAPED THIS WAY
--
-- The constraint now accepts both formats, which is what ImmortalId.isIssuable
-- already means in Java. That class draws the distinction this migration should
-- have followed from the start:
--
--     isValid     what a WRITER uses    current format only
--     isIssuable  what a READER uses    current or legacy
--
-- A storage constraint is a reader's rule, not a writer's. Its job is to keep
-- garbage out of the column, and every row that is already legitimately in
-- there has to satisfy it forever. "Only the current format may be ISSUED" is a
-- different rule with a different lifetime, and it is enforced where it can
-- actually be enforced: ImmortalId.prefix builds the fixed segments from
-- reference data and throws on anything malformed, so nothing in the
-- application can mint a legacy ID regardless of what this constraint permits.
--
-- Note the legacy shape is a superset of the current one, so the OR is
-- logically redundant. It is written out anyway because a reader of this schema
-- needs to know two formats are in circulation, and a single collapsed regex
-- would hide that. The precise guarantees live in Java either way: the current
-- format's in prefix(), the legacy format's in the Luhn mod 32 check character
-- that isLegacy() verifies and that no CHECK constraint can express.
-- ---------------------------------------------------------------------------

ALTER TABLE practitioners
    DROP CONSTRAINT practitioners_immortal_id_format;

ALTER TABLE practitioners
    ADD CONSTRAINT practitioners_immortal_id_format
        CHECK (immortal_id IS NULL
               -- current, since V9: HI-YYCCM-RRRRR
               OR immortal_id ~ '^HI-[0-9]{2}[A-Z]{2}[A-Z]-[A-Z0-9]{5}$'
               -- legacy, pre V9: ten Crockford characters grouped five and five
               OR immortal_id ~ '^HI-[0-9A-Z]{5}-[0-9A-Z]{5}$');

-- VALIDATE this time, unlike V9. Every row in the table satisfies one of the
-- two branches, so the scan succeeds and the constraint becomes a guarantee
-- rather than a promise about future writes only. A NOT VALID constraint that
-- never gets validated is one nobody can rely on when reading the schema.
ALTER TABLE practitioners
    VALIDATE CONSTRAINT practitioners_immortal_id_format;

COMMENT ON CONSTRAINT practitioners_immortal_id_format ON practitioners IS
    'Accepts both issued formats. Current is HI-YYCCM-RRRRR; legacy is ten '
    'Crockford characters and predates V9. Only the current format can be '
    'issued, and that rule lives in ImmortalId.prefix, not here: a storage '
    'constraint must keep accepting everything already legitimately stored.';
