-- V10__accounts.sql
--
-- Accounts. Until now this system had no idea who was calling it: the review
-- console was open to anyone who could reach the port, /api/v1/verifications
-- returned every case in the database to every caller, and "sign in" was a
-- fixture in the React bundle. This is phase 8 of the build order.
--
-- WHAT AN ACCOUNT IS, AND WHAT IT IS NOT
--
-- A user is a login. A practitioner is a registration. They are deliberately
-- different tables and neither owns the other:
--
--   - a user may hold no practitioner record at all (a reviewer, an admin, or
--     someone who signed up and has not claimed yet)
--   - a practitioner record exists whether or not anyone ever logs in for it,
--     because 3.1 keys it on (council, licence) and the registry is external
--
-- So the link is a nullable pointer on practitioners, not a join table and not
-- a merge. Collapsing the two would mean either inventing a login for every row
-- of a council register, or losing the registration identity that matching
-- depends on.


-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Stored already lowercased and trimmed by the application, and UNIQUE on
    -- that normalized value. Case sensitivity here is a support ticket
    -- generator: someone signs up as Anita@example.com and can never sign in
    -- again as anita@example.com, and nothing in the logs says why.
    email text NOT NULL
        CONSTRAINT users_email_lowercase CHECK (email = lower(email))
        CONSTRAINT users_email_shape CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

    -- BCrypt. Never a password, never a reversible encryption of one. The
    -- column is named for what it holds so that a query written in a hurry
    -- cannot read as though it returns something usable.
    password_hash text NOT NULL,

    full_name text NOT NULL,

    role text NOT NULL DEFAULT 'PRACTITIONER'
        CONSTRAINT users_role_check CHECK (role IN ('PRACTITIONER', 'REVIEWER', 'ADMIN')),

    -- ACTIVE is the only state that may sign in. LOCKED is temporary and
    -- automatic (see locked_until), DISABLED is deliberate and permanent until
    -- an admin says otherwise. Three states rather than a boolean because
    -- "locked out by failed attempts" and "shut down by a human" need different
    -- messages and different exits.
    status text NOT NULL DEFAULT 'ACTIVE'
        CONSTRAINT users_status_check CHECK (status IN ('ACTIVE', 'LOCKED', 'DISABLED')),

    -- Nullable, and nothing enforces it yet. Email delivery is not in this
    -- phase; the column exists so that turning verification on later is a
    -- policy change rather than a migration on a live users table.
    email_verified_at timestamptz,

    -- Online brute force protection. Reset to zero on any successful sign in.
    failed_login_count integer     NOT NULL DEFAULT 0,
    locked_until       timestamptz,

    last_login_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The hottest lookup in the system after this migration: every sign in, and
-- every signup checking for a duplicate. UNIQUE gives us the index for free.
CREATE UNIQUE INDEX uq_users_email ON users (email);

COMMENT ON COLUMN users.password_hash IS
    'BCrypt output, including its own salt and cost. Never logged, never '
    'returned by any endpoint, never compared with = in SQL.';


-- ---------------------------------------------------------------------------
-- Refresh tokens
--
-- WHY THESE EXIST AT ALL
--
-- A JWT cannot be withdrawn. Once signed it is valid until it expires, because
-- validating it is arithmetic rather than a lookup, and that is the entire
-- reason it is fast. Non negotiable 3 says a revoked practitioner stops reading
-- as verified the moment the case flips, and an access token that stays good
-- for a week directly contradicts it.
--
-- So: access tokens live 15 minutes and are never stored anywhere. Refresh
-- tokens live 30 days, are opaque random strings rather than JWTs, and are
-- stored here as a SHA-256 hash so a database leak does not hand out sessions.
-- Signing out, locking an account or revoking a role kills the refresh token,
-- and the access token dies of old age within the quarter hour.
--
-- WHY THE ROTATION CHAIN
--
-- Every refresh issues a new token and marks the old one replaced. If a token
-- that was already replaced is presented again, one of two things happened: a
-- retry after a dropped response, or a stolen token being used alongside the
-- real one. We cannot tell which, so we assume the worse and revoke the whole
-- chain. The legitimate user signs in again; the thief gets nothing.
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- SHA-256 of the opaque token, not the token. Unlike a password this is a
    -- high entropy random value, so a plain digest is right: bcrypt here would
    -- add 60ms to every token refresh to defend against a dictionary attack on
    -- 256 bits of randomness, which is not a thing.
    token_hash text NOT NULL,

    -- The rotation chain. NULL means this is the live token for its family.
    replaced_by uuid REFERENCES refresh_tokens (id),

    issued_at  timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,

    -- Context, for the account page and for an operator reading an incident.
    -- Deliberately coarse: enough to say "a Chrome on a new IP", not enough to
    -- rebuild someone's browsing.
    user_agent text,
    ip_address text
);

CREATE UNIQUE INDEX uq_refresh_tokens_hash ON refresh_tokens (token_hash);

-- Listing a user's live sessions, and revoking all of them at once.
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id)
    WHERE revoked_at IS NULL;

-- The expiry sweep. Partial, because a job deleting expired rows never looks
-- at the ones that are already revoked.
CREATE INDEX idx_refresh_tokens_expiry ON refresh_tokens (expires_at)
    WHERE revoked_at IS NULL;


-- ---------------------------------------------------------------------------
-- API keys
--
-- What a practitioner or an integrator generates to call the platform without a
-- browser. Shown in full exactly once, at creation, and never again: we keep
-- only a digest, so "I lost my key" is answered by issuing a new one rather
-- than by reading the old one back.
--
-- key_prefix is the human handle. A key list showing eight identical rows of
-- asterisks is unusable, and the alternative people reach for is storing enough
-- of the key to be recognisable, which is storing the key. The prefix is
-- generated as a separate non secret value for exactly this.
-- ---------------------------------------------------------------------------
CREATE TABLE api_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

    -- What it is for, in the owner's words. Revoking the right key six months
    -- later is impossible when they are all called "key".
    name text NOT NULL,

    -- Non secret, indexed, shown in the UI: "hi_live_7Q3M...".
    key_prefix text NOT NULL,

    -- SHA-256 of the whole key. Same reasoning as refresh tokens: high entropy
    -- input, so a digest rather than a password hash, and this one is read on
    -- every authenticated API request where 60ms of bcrypt would be the
    -- dominant cost of the call.
    key_hash text NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,

    -- Written lazily, not on every request. See ApiKeyService: a write per call
    -- turns a read only endpoint into a write endpoint and puts a row lock in
    -- the path of every request that shares a key.
    last_used_at timestamptz
);

CREATE UNIQUE INDEX uq_api_keys_hash ON api_keys (key_hash);
CREATE INDEX idx_api_keys_user ON api_keys (user_id, created_at DESC);

COMMENT ON TABLE api_keys IS
    'Only a SHA-256 digest is stored. The key itself is returned once, at '
    'creation, and cannot be recovered afterwards by us or by anyone reading '
    'this table.';


-- ---------------------------------------------------------------------------
-- The link between an account and a registration
--
-- Nullable, and it has to stay nullable. Every practitioner row created before
-- this migration was created by a claim from an anonymous browser, and there is
-- no honest way to guess which account it belongs to. Backfilling a guess here
-- would attach a stranger's verified identity to somebody's login.
--
-- ON DELETE SET NULL rather than CASCADE: deleting an account must not delete a
-- verified practitioner and their Immortal ID. Non negotiable 1 says nothing is
-- hard deleted, and the identifier outlives the login by design.
-- ---------------------------------------------------------------------------
ALTER TABLE practitioners
    ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_practitioners_user ON practitioners (user_id)
    WHERE user_id IS NOT NULL;

COMMENT ON COLUMN practitioners.user_id IS
    'The account that claimed this registration. NULL for rows created before '
    'accounts existed, and for registry-derived rows nobody has claimed.';


-- ---------------------------------------------------------------------------
-- Cases carry their submitter directly
--
-- Denormalized from practitioners.user_id on purpose, and this one is worth
-- defending. The ownership check runs on every read of every case, and going
-- through practitioners means a join on the hottest authorization path in the
-- system. Worse, it is a join to a value that can change: if a practitioner
-- record is ever relinked to a different account, every past case silently
-- changes hands, including cases decided before that account existed.
--
-- Who submitted a case is a fact about the moment it was submitted. It belongs
-- on the case, like the claimed fields in 3.3.
-- ---------------------------------------------------------------------------
ALTER TABLE verification_cases
    ADD COLUMN submitted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX idx_verification_cases_submitter
    ON verification_cases (submitted_by_user_id, submitted_at DESC)
    WHERE submitted_by_user_id IS NOT NULL;
