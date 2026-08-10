-- V9__practitioner_id_format.sql
--
-- The Immortal ID stops being nine random characters and starts carrying its
-- own provenance:
--
--     HI-YYCCM-RRRRR        HI-26INA-K3M7Q
--        ││││└─ medical system code   A S U Y T
--        ││└┴── ISO 3166-1 alpha-2 country
--        └┴──── last two digits of the registration year
--
-- Three of those five characters are facts about the practitioner, so this
-- migration has to give the database somewhere to keep those facts. Deriving
-- them at read time from whatever the row happens to say today would break the
-- one promise the identifier makes: it never changes. If a practitioner later
-- corrects their medical system, the ID they were issued still has to decode
-- back to what was true when it was issued, which means the inputs are stored
-- next to the output, once, at issuance.
--
-- WHAT THIS COSTS
--
-- Nine random Crockford characters was 45 bits with a Luhn check character.
-- The new body is five characters of A-Z0-9, which is 36^5 = 60,466,176 per
-- (year, country, system) bucket, and there is no check character: a mistyped
-- ID now reaches the server instead of being caught in the browser. The public
-- endpoint is rate limited (D5) and answers identically for an unknown and an
-- unverified ID, so a walk of the space still learns nothing per request, but
-- the rate limiter is now doing more of that work than it was.
--
-- Existing IDs are NOT rewritten. See the CHECK constraint below.


-- ---------------------------------------------------------------------------
-- Countries
--
-- A table, for the same reason councils is a table rather than a Java enum:
-- adding a country is a migration, not a redeploy. It also gives councils a
-- foreign key to hang off, which is what makes "the country of a claim" a fact
-- the database can enforce rather than something the browser asserts.
--
-- The code is the ISO 3166-1 alpha-2 code, which is exactly the CC segment of
-- the identifier. No translation layer anywhere.
-- ---------------------------------------------------------------------------
CREATE TABLE countries (
    code text PRIMARY KEY
        CONSTRAINT countries_code_check CHECK (code ~ '^[A-Z]{2}$'),
    name text NOT NULL,

    -- A country we hold a register for, versus one that merely exists. The
    -- claim form offers only enabled rows, so switching a country on is one
    -- UPDATE rather than a deploy.
    enabled boolean NOT NULL DEFAULT true
);

INSERT INTO countries (code, name) VALUES
    ('IN', 'India'),
    ('US', 'United States'),
    ('CA', 'Canada'),
    ('GB', 'United Kingdom'),
    ('AU', 'Australia'),
    ('NP', 'Nepal'),
    ('LK', 'Sri Lanka'),
    ('BD', 'Bangladesh'),
    ('SG', 'Singapore'),
    ('MY', 'Malaysia'),
    ('AE', 'United Arab Emirates'),
    ('NZ', 'New Zealand'),
    ('ZA', 'South Africa'),
    ('CN', 'China')
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE countries IS
    'ISO 3166-1 alpha-2. The CC segment of an Immortal ID is read straight from '
    'here, so a code invented locally would corrupt every ID issued under it.';


-- ---------------------------------------------------------------------------
-- Medical systems
--
-- The M segment. Five rows today, and a table rather than an enum for the same
-- reason as above: Homoeopathy and Naturopathy are the obvious next two and
-- neither should require a redeploy.
--
-- The code is a single character because it is a single character of the
-- identifier. That is a hard constraint, not a preference, which is why the
-- CHECK is here rather than in Java: a two character code would silently
-- lengthen every ID issued after it.
-- ---------------------------------------------------------------------------
CREATE TABLE medical_systems (
    code text PRIMARY KEY
        CONSTRAINT medical_systems_code_check CHECK (code ~ '^[A-Z]$'),
    name text NOT NULL,

    -- Display order on the claim form. Alphabetical by name would put
    -- Ayurveda, the overwhelming majority of this register, in the middle.
    sort_order integer NOT NULL DEFAULT 100,
    enabled    boolean NOT NULL DEFAULT true
);

INSERT INTO medical_systems (code, name, sort_order) VALUES
    ('A', 'Ayurveda',                     10),
    ('S', 'Siddha',                       20),
    ('U', 'Unani',                        30),
    ('Y', 'Yoga',                         40),
    ('T', 'Traditional Chinese Medicine', 50)
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Councils belong to a country
--
-- DEFAULT 'IN' because every one of the 36 rows V2 and V4 seeded is an Indian
-- state or union territory, and because it keeps those migrations correct
-- without editing them. A council in another country sets it explicitly.
--
-- This is the authority for the CC segment. The claim form asks the
-- practitioner to pick a country, but what it actually does with the answer is
-- narrow the council list: the council is in a country whether or not the form
-- agrees, and the server rejects a claim whose two answers disagree rather than
-- quietly preferring one.
-- ---------------------------------------------------------------------------
ALTER TABLE councils
    ADD COLUMN country_code text NOT NULL DEFAULT 'IN'
        REFERENCES countries (code);

CREATE INDEX idx_councils_country ON councils (country_code);


-- ---------------------------------------------------------------------------
-- Practitioners carry the inputs their identifier was built from
--
-- country_code and medical_system_code are NOT NULL with no default. A default
-- here would be a guess written into the one row that has to be able to explain
-- an ID years later, and 'A' guessed wrong is indistinguishable from 'A' meant.
-- Existing rows are backfilled below from evidence, which is a different thing.
-- ---------------------------------------------------------------------------
ALTER TABLE practitioners
    ADD COLUMN country_code          text,
    ADD COLUMN medical_system_code   text,
    -- The registration year of the ID, kept as a timestamp rather than inferred
    -- from created_at. A practitioner created in December and approved in
    -- January must decode to the year printed in their ID, and created_at is
    -- the wrong one of those two dates.
    ADD COLUMN immortal_id_issued_at timestamptz;

-- Backfill 1: country from the council the practitioner is registered with.
UPDATE practitioners p
   SET country_code = c.country_code
  FROM councils c
 WHERE c.code = p.council_code
   AND p.country_code IS NULL;

-- Backfill 2: medical system from what the practitioner actually claimed, using
-- the most recent case that names a specialty. Unani is the only non Ayurvedic
-- system this register has ever seen spelled out; Kayachikitsa, Panchakarma,
-- Rasashastra, Shalya Tantra and Prasuti Tantra are all Ayurvedic branches, so
-- they map to A rather than to a sixth system.
UPDATE practitioners p
   SET medical_system_code = COALESCE((
        SELECT CASE
                 WHEN upper(v.claimed_specialty) LIKE '%UNANI%'  THEN 'U'
                 WHEN upper(v.claimed_specialty) LIKE '%SIDDHA%' THEN 'S'
                 WHEN upper(v.claimed_specialty) LIKE '%YOGA%'   THEN 'Y'
                 WHEN upper(v.claimed_specialty) LIKE '%CHINESE%' THEN 'T'
                 ELSE 'A'
               END
          FROM verification_cases v
         WHERE v.practitioner_id = p.id
           AND v.claimed_specialty IS NOT NULL
         ORDER BY v.submitted_at DESC
         LIMIT 1
       ), 'A')
 WHERE p.medical_system_code IS NULL;

-- Backfill 3: an ID that already exists was issued at some point, and the only
-- evidence of when is the approval that issued it.
UPDATE practitioners p
   SET immortal_id_issued_at = COALESCE((
        SELECT min(v.decided_at)
          FROM verification_cases v
         WHERE v.practitioner_id = p.id
           AND v.status = 'APPROVED'
       ), p.created_at)
 WHERE p.immortal_id IS NOT NULL
   AND p.immortal_id_issued_at IS NULL;

ALTER TABLE practitioners
    ALTER COLUMN country_code        SET NOT NULL,
    ALTER COLUMN medical_system_code SET NOT NULL,
    ADD CONSTRAINT fk_practitioners_country
        FOREIGN KEY (country_code) REFERENCES countries (code),
    ADD CONSTRAINT fk_practitioners_medical_system
        FOREIGN KEY (medical_system_code) REFERENCES medical_systems (code);

-- An ID and the moment it was issued arrive together or not at all. Without
-- this, a row can claim an identifier whose YY segment nothing can corroborate.
ALTER TABLE practitioners
    ADD CONSTRAINT practitioners_issued_at_with_id
        CHECK ((immortal_id IS NULL) = (immortal_id_issued_at IS NULL));

-- ---------------------------------------------------------------------------
-- Shape of the identifier, enforced by the database
--
-- NOT VALID on purpose, and this is the whole legacy story in one word.
--
-- Postgres applies a NOT VALID check to every INSERT and UPDATE from now on but
-- does not scan what is already there. So an ID issued under the old
-- HI-XXXXX-XXXXX Crockford scheme keeps working, resolves at the public
-- endpoint, and stays exactly as printed on whatever certificate carries it,
-- while nothing can ever write another one. Rewriting those rows would have
-- been the alternative, and it breaks section 8.1: permanent and immutable is
-- not a property you get to suspend for a format change.
--
-- Do not run VALIDATE CONSTRAINT on this. It will fail, and it is supposed to.
-- ---------------------------------------------------------------------------
ALTER TABLE practitioners
    ADD CONSTRAINT practitioners_immortal_id_format
        CHECK (immortal_id IS NULL
               OR immortal_id ~ '^HI-[0-9]{2}[A-Z]{2}[A-Z]-[A-Z0-9]{5}$')
        NOT VALID;

-- immortal_id was already UNIQUE in V8 as a column constraint. Named here so it
-- is findable, and restated because uniqueness is the thing that turns a
-- generator collision into a retry instead of two people sharing an identity.
COMMENT ON COLUMN practitioners.immortal_id IS
    'HI-YYCCM-RRRRR. Issued once, on the first approval, never reissued, never '
    'edited. UNIQUE at the database level because the generator must never be '
    'the only thing standing between two practitioners and one identifier.';


-- ---------------------------------------------------------------------------
-- The claim records what was selected
--
-- On the case, not only on the practitioner, for the reason 3.1 gives for the
-- licence number: a corrected claim after a rejection has to leave the original
-- readable. If someone picks Unani, is rejected, and resubmits as Ayurveda, the
-- first case still has to say Unani or the rejection cannot be explained.
-- Nullable, because cases submitted before this migration never asked.
-- ---------------------------------------------------------------------------
ALTER TABLE verification_cases
    ADD COLUMN claimed_country        text REFERENCES countries (code),
    ADD COLUMN claimed_medical_system text REFERENCES medical_systems (code);

UPDATE verification_cases v
   SET claimed_country        = p.country_code,
       claimed_medical_system = p.medical_system_code
  FROM practitioners p
 WHERE p.id = v.practitioner_id
   AND v.claimed_country IS NULL;
