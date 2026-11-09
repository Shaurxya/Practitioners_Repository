# Publishing website account confirmation

The publishing website at `http://localhost:5173` uses its backend at
`http://localhost:5001`. This verifier supplies account confirmation through
`http://localhost:5174/publishing/confirm` and its API on port 8080.

## Why the page was missing

The publishing repository contained an identity-enabled copy and integration
patch, but the running original verifier did not contain the confirmation route
or publishing endpoints. The integration patch has now been applied to this
repository and checked against real PostgreSQL and the running publishing app.

This is a narrowly scoped first-party login integration. It does not complete
the partner API product or add a general OAuth/OIDC provider.

## Start a new sign-in

1. Open the publishing website's `/login` page on port 5173.
2. Select Immortal ID and enter your own linked ID.
3. The publisher generates a fresh request and redirects to this verifier.
4. Sign in on the verifier with the account that owns the ID.
5. Review the account-sharing disclosure and confirm.
6. The publisher exchanges the one-time code server-side and establishes its
   own session.

Do not bookmark or reuse the full confirmation URL. Its publisher state expires
after five minutes, and the provider's authorization code expires after two
minutes and can be consumed only once. Restart at the publishing login page.

The local synthetic `HI-26INA-DEMO1` fixture has been linked to the separately
created `demo.ayurveda@herbimmortal.test` account. Its generated local password
was supplied in the conversation, not committed here. The fixture remains
synthetic: its approval is not evidence of real council or identity checks.
Other existing accounts and passwords were not changed. A public ID lookup
alone is insufficient to log in as its owner.

## Running the original verifier

Backend:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/backend
SERVER_PORT=8080 UPLOAD_DIR=/Users/shauryasharma/Desktop/Practitioners_Repository/data/uploads ./mvnw spring-boot:run
```

Frontend:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/frontend
SERVER_PORT=8080 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Run one verifier backend and frontend. Do not also start the publishing
repository's bundled provider copy on the same ports. The publishing
application's usual backend/frontend commands remain unchanged.

## Configuration

The root `.env` now registers the publishing application's existing client:

```dotenv
PUBLISHING_CLIENT_ID=publishing-org
PUBLISHING_REDIRECT_URI=http://localhost:5001/api/auth/immortal/callback
PUBLISHING_ISSUER=http://localhost:8080
PUBLISHING_CLIENT_SECRET_SHA256=<SHA-256 digest of the publisher login client secret>
```

The corresponding publishing backend settings are
`HERBIMMORTAL_LOGIN_CLIENT_ID`, `HERBIMMORTAL_LOGIN_CALLBACK_URL`,
`HERBIMMORTAL_LOGIN_CLIENT_SECRET`, `HERBIMMORTAL_IDENTITY_URL`, and
`HERBIMMORTAL_FRONTEND_URL`. Only the secret's digest is stored on this verifier;
the publisher retains the original secret. No JWT signing secret or provider
session token is shared between the applications. Do not use `VITE_` names for
these server credentials. Register exact HTTPS callbacks for deployed clients.

## Enforcement and persistence

- `/api/v1/publishing/authorize` requires a SESSION principal, explicit
  confirmation, exact registered callback/client, and an S256 PKCE challenge.
- The requested ID must belong to that account. API keys cannot act as people.
- The latest case must be unambiguously APPROVED, its matched registry record
  uniquely current and ACTIVE, its known registration validity unexpired, and
  the owner ACTIVE. Historical approvals do not override a newer negative case.
- `/exchange` authenticates the publishing client and atomically consumes the
  code bound to client and PKCE challenge. `/status` rechecks the current
  identity and prior account-sharing consent for that client.
- Flyway V15 creates `publishing_login_code` and `publishing_login_consent`.
  Codes are stored as SHA-256 digests. Existing users, cases, and personal keys
  are not rewritten by the migration.
- Hibernate parameter logging and Spring JDBC debug logging are disabled in
  the local profile so credentials and identity values do not enter SQL logs.
- The confirmation page rejects incomplete, duplicated, and non-S256 requests
  and sets a no-referrer policy while showing the account-sharing disclosure.

## Verification on 2026-11-09

- All 177 backend tests passed against disposable PostgreSQL, including
  publishing ownership, current status, invalid client/redirect, code expiry,
  wrong PKCE, consent, and replay tests.
- All 198 verifier frontend tests passed; the production build passed.
- V14 and V15 applied successfully to the running local verifier database.
- A live HTTP round trip used the real publisher, provider frontend proxy,
  provider API, PostgreSQL, and publisher callback/completion endpoints.
  It issued the publisher's own HEALTH_PRACTITIONER session for the synthetic
  account, and a repeated completion was rejected.
- Browser automation was unavailable. Interactive visual rendering and clicking
  were not independently checked; component tests and the live HTTP flow were.

Relevant tests can be rerun with the normal configured test database:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/backend
./mvnw -Dtest=PublishingLoginServiceTest,PublishingLoginDatabaseTest test
```
