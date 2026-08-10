-- V11__audit_metadata.sql
--
-- Adds the metadata column CLAUDE.md section 3.6 specifies and V8 omitted.
--
-- The registry lookup is what forces the issue. Its audit event has no status
-- transition to record, so from_status and to_status are both null, and the
-- only facts worth keeping are what was searched for: the council and the
-- normalized registration number. Without somewhere structured to put those,
-- an audit row for a lookup says "somebody looked something up", which does
-- not answer the one question the log exists to answer.
--
-- jsonb rather than more columns because the shape differs per event type. A
-- lookup records a search, a document read records a storage key, a registry
-- sync records a batch. Adding a nullable column per event type would give a
-- table that is mostly nulls and a migration for every new event.
--
-- PII placement, per the tension recorded in section 10: values in here are
-- addressable by key, so a future erasure can null one field of one row. That
-- is the whole reason the search terms go in metadata rather than being
-- stringified into reason, which is free text and would have to be destroyed
-- wholesale or parsed to be redacted.
ALTER TABLE audit_events ADD COLUMN metadata jsonb;

COMMENT ON COLUMN audit_events.metadata IS
    'Event specific facts. Keys are addressable so a single field can be '
    'redacted later without destroying the row. Never free text.';

-- Lookups are the highest volume event this table will hold and they are read
-- exactly one way: everything one account did, most recent first, when someone
-- is deciding whether an account is harvesting the register.
CREATE INDEX idx_audit_events_actor
    ON audit_events (actor_id, created_at DESC)
    WHERE actor_id IS NOT NULL;
