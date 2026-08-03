# API contract, v1

The live contract is generated from the controllers by springdoc:

- OpenAPI JSON: http://localhost:8080/v3/api-docs
- Swagger UI: http://localhost:8080/swagger-ui.html

This file records the decisions the generated document cannot express.

## Conventions

| Topic | Rule |
|---|---|
| Base path | `/api/v1`, version in the path, never in a header |
| Casing | `camelCase` in JSON both directions |
| Timestamps | ISO-8601 UTC strings, never epoch numbers |
| IDs | UUID v4 in path segments, except the Immortal ID which is `HI-XXXXX-XXXXX` |
| Lists | Spring `Page<T>`: `content`, `totalElements`, `totalPages`, `number`, `size` |
| Paging params | `?page=0&size=20&sort=submittedAt,desc` |
| Errors | Always `ErrorResponse`: `code`, `message`, `fieldErrors`, `timestamp` |

## Status codes

| Code | Used for |
|---|---|
| 200 | successful read |
| 201 | account created |
| 202 | case accepted, decision pending. Never 200, the work is not done |
| 400 | DTO validation failed, `fieldErrors` is populated |
| 401 | missing or expired token |
| 403 | authenticated but wrong role |
| 404 | not found, and also "exists but you do not own it" |
| 409 | illegal status transition, or a duplicate open case |
| 429 | rate limit, public endpoint only |
| 501 | scaffold stub, not yet implemented |

## Endpoints

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/register` | public | |
| POST | `/api/v1/auth/login` | public | |
| POST | `/api/v1/auth/refresh` | public | refresh token in `X-Refresh-Token` |
| GET | `/api/v1/me` | any | `immortalId` may be null |
| POST | `/api/v1/verifications` | PRACTITIONER | 202, honours `Idempotency-Key` |
| GET | `/api/v1/verifications/{id}` | PRACTITIONER | owner only, else 404 |
| GET | `/api/v1/verifications` | PRACTITIONER | own cases only |
| POST | `/api/v1/documents/presign` | PRACTITIONER | |
| POST | `/api/v1/documents/confirm` | PRACTITIONER | |
| GET | `/api/v1/admin/review` | REVIEWER, ADMIN | paginated, filterable |
| GET | `/api/v1/admin/review/{id}` | REVIEWER, ADMIN | |
| POST | `/api/v1/admin/review/{id}/decide` | REVIEWER, ADMIN | reason mandatory |
| GET | `/api/v1/public/verify` | public | cached, rate limited |

## Open items

- Auth for the internal platform lookup is undecided. See `D4` in `/CLAUDE.md`.
- Rate limit thresholds on `/public/verify` are not set yet.
