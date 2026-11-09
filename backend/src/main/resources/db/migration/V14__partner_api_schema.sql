-- Partner credentials are separate from the existing user-owned api_keys.
-- No existing credentials, verification rows, or applied migrations are changed.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('PRACTITIONER', 'DEVELOPER', 'REVIEWER', 'ADMIN'));

CREATE TABLE api_client (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id uuid NOT NULL UNIQUE REFERENCES users(id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    contact_email text NOT NULL CHECK (length(contact_email) BETWEEN 3 AND 320),
    purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 2000),
    terms_version text NOT NULL CHECK (length(btrim(terms_version)) BETWEEN 1 AND 100),
    terms_accepted_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED')),
    live_access_status text NOT NULL DEFAULT 'NOT_REQUESTED'
        CHECK (live_access_status IN ('NOT_REQUESTED', 'PENDING', 'APPROVED', 'REJECTED')),
    live_decided_by uuid REFERENCES users(id),
    live_decided_at timestamptz,
    live_decision_reason text,
    -- Null overrides use configuration. TEST and LIVE have independent budgets.
    test_monthly_quota bigint CHECK (test_monthly_quota >= 0),
    live_monthly_quota bigint CHECK (live_monthly_quota >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version bigint NOT NULL DEFAULT 0,
    CONSTRAINT api_client_live_decision_complete CHECK (
        (live_access_status IN ('APPROVED', 'REJECTED')
         AND live_decided_by IS NOT NULL AND live_decided_at IS NOT NULL
         AND live_decision_reason IS NOT NULL
         AND length(btrim(live_decision_reason)) BETWEEN 1 AND 2000)
        OR
        (live_access_status IN ('NOT_REQUESTED', 'PENDING')
         AND live_decided_by IS NULL AND live_decided_at IS NULL
         AND live_decision_reason IS NULL)
    )
);

CREATE INDEX idx_api_client_live_requests ON api_client(created_at)
    WHERE live_access_status = 'PENDING';

CREATE TABLE api_client_scope (
    client_id uuid NOT NULL REFERENCES api_client(id),
    scope text NOT NULL CHECK (scope IN ('verify:basic', 'verify:detail')),
    PRIMARY KEY (client_id, scope)
);

CREATE TABLE partner_api_key (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES api_client(id),
    label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 100),
    environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
    public_key_id text NOT NULL UNIQUE CHECK (public_key_id ~ '^[A-Za-z0-9_-]{22}$'),
    display_prefix text NOT NULL,
    -- SHA-256 digest only. There is deliberately no plaintext credential column.
    secret_hash bytea NOT NULL UNIQUE CHECK (octet_length(secret_hash) = 32),
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    last_used_at timestamptz,
    revoked_at timestamptz,
    revoked_by uuid REFERENCES users(id),
    rotated_from uuid UNIQUE,
    version bigint NOT NULL DEFAULT 0,
    UNIQUE (id, client_id, environment),
    -- A rotation cannot silently move a key into another client or environment.
    FOREIGN KEY (rotated_from, client_id, environment)
        REFERENCES partner_api_key(id, client_id, environment),
    CHECK (expires_at IS NULL OR expires_at > created_at),
    CHECK (rotated_from IS NULL OR rotated_from <> id),
    CHECK (display_prefix = 'hi_' || lower(environment) || '_' || public_key_id),
    CONSTRAINT partner_api_key_revocation_complete CHECK (
        (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
        OR (status <> 'REVOKED' AND revoked_at IS NULL AND revoked_by IS NULL)
    )
);

CREATE INDEX idx_partner_api_key_client ON partner_api_key(client_id, created_at DESC);
CREATE INDEX idx_partner_api_key_expiry ON partner_api_key(expires_at)
    WHERE status = 'ACTIVE' AND expires_at IS NOT NULL;

CREATE TABLE partner_api_key_scope (
    key_id uuid NOT NULL REFERENCES partner_api_key(id),
    scope text NOT NULL CHECK (scope IN ('verify:basic', 'verify:detail')),
    PRIMARY KEY (key_id, scope)
);

CREATE TABLE api_usage_daily (
    key_id uuid NOT NULL REFERENCES partner_api_key(id),
    day date NOT NULL,
    endpoint_template text NOT NULL CHECK (endpoint_template IN (
        'PARTNER_LOOKUP', 'PARTNER_BATCH', 'PARTNER_ME'
    )),
    status_class text NOT NULL CHECK (status_class IN ('2xx', '3xx', '4xx', '5xx')),
    request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
    lookup_units bigint NOT NULL DEFAULT 0 CHECK (lookup_units >= 0),
    rate_limit_hits bigint NOT NULL DEFAULT 0 CHECK (rate_limit_hits >= 0),
    PRIMARY KEY (key_id, day, endpoint_template, status_class)
);
CREATE INDEX idx_api_usage_daily_day ON api_usage_daily(day, key_id);

CREATE TABLE api_quota_monthly (
    client_id uuid NOT NULL REFERENCES api_client(id),
    environment text NOT NULL CHECK (environment IN ('TEST', 'LIVE')),
    month_start date NOT NULL CHECK (extract(day FROM month_start) = 1),
    consumed_units bigint NOT NULL DEFAULT 0 CHECK (consumed_units >= 0),
    limit_units bigint NOT NULL CHECK (limit_units >= 0),
    PRIMARY KEY (client_id, environment, month_start),
    CHECK (consumed_units <= limit_units)
);

COMMENT ON TABLE partner_api_key IS
    'Partner credentials only; SHA-256 digest, public identifier, and safe metadata. Never plaintext.';
COMMENT ON TABLE api_usage_daily IS
    'Aggregated analytics, not one row per request and not the quota enforcement authority.';
COMMENT ON TABLE api_quota_monthly IS
    'Authoritative client admission counters, separated by environment and UTC calendar month.';
