-- First-party account confirmation. Independent of the future partner API.
CREATE TABLE publishing_login_code (
    code_hash bytea PRIMARY KEY CHECK (octet_length(code_hash) = 32),
    client_id text NOT NULL,
    practitioner_id uuid NOT NULL REFERENCES practitioners(id),
    pkce_challenge varchar(43) NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX publishing_login_code_expiry ON publishing_login_code(expires_at);
CREATE TABLE publishing_login_consent (
    client_id text NOT NULL,
    practitioner_id uuid NOT NULL REFERENCES practitioners(id),
    owner_user_id uuid NOT NULL REFERENCES users(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, practitioner_id)
);
