-- V1__init.sql
--
-- Filename format: V<version>__<description>.sql
-- Note the TWO underscores between the version and the description. One
-- underscore is the single most common Flyway mistake: the file is silently
-- ignored and you spend twenty minutes wondering why nothing happened.
--
-- Migrations are append only. Once Flyway has applied a file it stores that
-- file's checksum in flyway_schema_history. Editing an applied file makes the
-- next startup fail validation. To change something, add V2__whatever.sql.

-- pgcrypto provides gen_random_uuid(), so future tables can generate their own
-- primary keys in the database rather than relying on the application.
-- IF NOT EXISTS makes this safe to run against a database that already has it.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
