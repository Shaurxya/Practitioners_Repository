-- V4__councils_statewise.sql
--
-- Seeds every Indian state and union territory into councils, so a register can
-- be uploaded for any of them without a migration per state.
--
-- WHY THESE CODES
--
-- The codes are ISO 3166-2:IN subdivision codes, and that is not an arbitrary
-- choice. NCISM's own National Registration Number embeds the same code:
--
--     NR/AY/GA/0000001
--            ^^ Goa
--
-- So keying on the ISO code means our council_code and the source document's
-- own identifier agree, rather than us inventing a parallel scheme that has to
-- be translated at every boundary. The four councils seeded in V2 (MH, KA, KL,
-- GJ) already used these codes, so nothing is renamed here.
--
-- WHY canonical_name IS A STATE NAME FOR MOST ROWS
--
-- canonical_name is display text: it is what the upload screen shows and what
-- an admin reads back to confirm they picked the right register. It is NOT the
-- matching surface. Matching goes through council_aliases, which is keyed on
-- the normalized spelling actually observed in a document.
--
-- We have a verified board name for only five states so far, taken from the
-- registers themselves. Inventing formal board titles for the other 31 would
-- put unverified text in front of an admin who is using it to make exactly the
-- decision it would mislead them on. So the rest carry the state name until
-- that state's first register arrives and tells us what the board is called.
--
-- Adding a board name later is an UPDATE to one row. Adding a spelling is one
-- INSERT into council_aliases. Neither is a schema change.


-- ---------------------------------------------------------------------------
-- States
-- ---------------------------------------------------------------------------
INSERT INTO councils (code, canonical_name) VALUES
    ('AP', 'Andhra Pradesh'),
    ('AR', 'Arunachal Pradesh'),
    ('AS', 'Assam'),
    ('BR', 'Bihar'),
    ('CT', 'Chhattisgarh'),
    ('GA', 'Goa Board of Indian System of Medicine and Homoeopathy'),
    ('HR', 'Haryana'),
    ('HP', 'Himachal Pradesh'),
    ('JH', 'Jharkhand'),
    ('MP', 'Madhya Pradesh'),
    ('MN', 'Manipur'),
    ('ML', 'Meghalaya'),
    ('MZ', 'Mizoram'),
    ('NL', 'Nagaland'),
    ('OR', 'Odisha'),
    ('PB', 'Punjab'),
    ('RJ', 'Rajasthan'),
    ('SK', 'Sikkim'),
    ('TN', 'Tamil Nadu'),
    ('TG', 'Telangana'),
    ('TR', 'Tripura'),
    ('UP', 'Uttar Pradesh'),
    ('UT', 'Uttarakhand'),
    ('WB', 'West Bengal')
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Union territories
-- ---------------------------------------------------------------------------
INSERT INTO councils (code, canonical_name) VALUES
    ('AN', 'Andaman and Nicobar Islands'),
    ('CH', 'Chandigarh'),
    ('DH', 'Dadra and Nagar Haveli and Daman and Diu'),
    ('DL', 'Delhi'),
    ('JK', 'Jammu and Kashmir'),
    ('LA', 'Ladakh'),
    ('LD', 'Lakshadweep'),
    ('PY', 'Puducherry')
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Goa aliases, taken from the NCISM provisional national register for Goa
--
-- Every row of that document spells the registering body as
--   "Goa Board of Indian System of Medicine and Homoeopathy (Goa)"
-- which Normalizer.normalizeCouncilAlias uppercases and collapses to the first
-- entry below. The second is the same name without the trailing "(Goa)", which
-- the same document uses in its header.
--
-- Only Goa gets aliases here. A state with no observed spelling gets none,
-- because an alias invented without a document to back it is a guess that
-- ingestion would then trust.
-- ---------------------------------------------------------------------------
INSERT INTO council_aliases (alias_normalized, council_code) VALUES
    ('GOA BOARD OF INDIAN SYSTEM OF MEDICINE AND HOMOEOPATHY GOA', 'GA'),
    ('GOA BOARD OF INDIAN SYSTEM OF MEDICINE AND HOMOEOPATHY',     'GA'),
    ('GOA BOARD OF INDIAN SYSTEM OF MEDICINE AND HOMEOPATHY GOA',  'GA'),
    ('GOA BOARD OF INDIAN SYSTEM OF MEDICINE AND HOMEOPATHY',      'GA')
ON CONFLICT (alias_normalized) DO NOTHING;
