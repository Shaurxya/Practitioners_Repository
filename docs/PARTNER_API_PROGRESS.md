# Partner API implementation progress

## Completed: sub-step 2, schema and entities

The design was approved on 2026-11-08. This implementation adds the persistence
foundation. It does not yet expose developer registration, partner endpoints,
key creation/rotation, rate limiting, metering workers, or portal screens.

Migration `V14__partner_api_schema.sql` adds:

- DEVELOPER to the existing users-role constraint, without changing signup.
- `api_client` for one organization per owner, terms acceptance, client state,
  live-access decisions, and nullable environment-specific quota overrides.
- `api_client_scope` for approved client capabilities.
- `partner_api_key` and `partner_api_key_scope`, separate from personal keys.
  Keys have a public ID, SHA-256 digest, environment, expiry, revocation actor,
  and rotation ancestry. No plaintext credential column exists.
- `api_usage_daily` for aggregated endpoint/status counters.
- `api_quota_monthly` for separate TEST/LIVE monthly admission counters.

Constraints reject invalid scope/state values, hashes of the wrong length,
negative counters, quota overspend, incomplete approval/revocation metadata,
and rotations across clients or environments. The original `api_keys` table
and applied V1-V13 migrations are unchanged.

The corresponding Java classes and repositories live in
`backend/src/main/java/com/herbimmortal/verification/partner/`. Frontend role
typing also recognizes DEVELOPER; existing route guards remain unchanged.

## Entity patterns and transaction behavior

These classes keep the existing `@Entity`, UUID ID, explicit column mapping,
and protected no-argument constructor patterns. `@Entity` marks a class as a
database model, much like a SQLAlchemy model; a repository supplies standard
queries and persistence operations.

The additions compared with older project entities are:

- `@Enumerated(STRING)` stores named lifecycle states. Immutable allowed-transition
  maps reject state jumps and reactivation of expired/revoked keys.
- A scope converter persists `verify:basic` and `verify:detail`, rather than
  Java enum ordinals or enum names.
- `@ElementCollection` maps scope sets into join tables. Public responses will
  use explicit DTOs rather than serializing these entities.
- `@Version` provides optimistic concurrency for clients and keys: conflicting
  writes fail instead of silently replacing each other's state.
- `@EmbeddedId` models the composite usage/quota keys.
- Key hashes use PostgreSQL `bytea`, defensive array copies, and Jackson exclusion.

Lifecycle mutation methods are package-private. `PartnerLifecycleService`
validates ownership/session type and sends state updates and audit inserts
through one transaction. An administrator is required to decide live access,
suspend/reactivate an existing client, or finalize expiry. Owner requests and
revocations remain restricted to that owner's organization. Ownership is part
of key and client queries, and unknown/foreign resources use the same error.

Audit metadata contains the public key prefix where relevant and a validated
approval/rejection reason. Fields reject recognizable pasted credentials;
request bodies and authorization headers are never serialized into audit data.
Key creation/rotation audit events will be added with the next sub-step.

## Verification performed

Validation ran against a disposable PostgreSQL 16 container, with generated
test signing/encryption keys and environment overrides. The existing local
database and object storage were not modified by those checks.

- All 152 backend tests passed, including 16 partner schema/lifecycle tests.
- All 193 frontend tests passed.
- The frontend production build passed; Vite reported a bundle-size advisory.
- Fresh migration through V14 and Hibernate schema validation passed.
- A separate V13 schema was populated with an existing personal key, upgraded
  to V14, and checked to confirm its digest was preserved.
- Persistence checks cover scoped ownership, live approval, revocation metadata,
  rollback of state/audit together, composite usage/quota mappings, TEST/LIVE
  quota separation, hash constraints, and forbidden cross-client rotations.
- Unit checks cover expiry at its exact timestamp, terminal key states,
  suspension, live-access resubmission, and credential rejection in metadata.

These checks do not claim end-to-end partner API or identity-upload coverage;
those new partner endpoints and workflows have not been implemented yet.

## How to verify locally

With the project's PostgreSQL service running and the root `.env` configured:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/backend
./mvnw -Dtest=PartnerSchemaTest,PartnerLifecycleTest test
```

Flyway applies V14 to the configured database before Hibernate validates the
mappings. The tests use rollback for their fixtures; the upgrade test creates
and removes its own uniquely named schema. The configured database user needs
permission to create that test schema.

For the full regression suite:

```bash
./mvnw test
```

Frontend checks:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/frontend
npm test
npm run build
```

Starting the backend normally will also apply V14 automatically. This stage
adds schema support, not a developer signup form or a usable partner key yet.

## Next: sub-step 3

Implement secure key generation, one-time plaintext responses, rotation with
overlap, optional expiry policy, and creation/rotation/revocation audit events.
Continue using the separate partner model rather than replacing personal keys.

The supplied PDF requests confirmation after each sub-step. Implementation
pauses here after the schema/entities checks. Directory search remains a
separate, later approval gate.

The separately requested [publishing login integration](PUBLISHING_LOGIN.md)
was added later under Flyway V15. It does not implement partner key generation,
rotation, developer onboarding, or partner API endpoints.
