# Hardening checkpoint 1: CI, test infrastructure, and startup secrets

Scope: finding 4 from the supplied hardening prompt, completed in the requested
order. Verification rules, browser sessions, login limits, and PDF storage have
not been changed by this checkpoint. Partner API-key authentication is unchanged.

## What the audit actually found

| Claim | Evidence before this change | Result |
| --- | --- | --- |
| Backend CI omitted PostgreSQL. | The original `.github/workflows/backend.yml` only installed Java and ran `./mvnw -B verify`; it declared no services. | Confirmed. |
| Tests were using Testcontainers. | A workflow comment mentioned it, but `backend/pom.xml` had no Testcontainers dependency and the tests used ordinary configured JDBC connections. | Incorrect comment; use a PostgreSQL service container to match the tests. |
| Tests needed H2 to run in CI. | No H2 dependency, replacement datasource, or H2 test profile was present. Existing `@SpringBootTest` tests use PostgreSQL. | No H2 fallback was found or added. |
| Backend tests were silently disabled. | No JUnit disabled tests, assumption-based skips, or skip configuration was found. Unit tests intentionally use pure functions/Mockito; database integration tests use real PostgreSQL. | Not reproduced in the backend. |
| The extractor had skipped coverage. | `extraction/tests/test_extraction.py` uses `@has_register` for three private-register tests and conditionally skips an absent-OCR test when Paddle is installed. No extraction workflow existed. | Confirmed. CI now supplies a synthetic PDF and does not install Paddle. Existing assertions are unchanged. |
| Frontend CI lacked checks. | It ran typecheck, tests, build, but there was no lint script or configuration. | Added blocking lint. Practitioner/admin routes share one React app, so one job covers both. |
| CI had no boot secrets. | No test profile or disposable signing/document-encryption secrets were configured. | Added test-only fixtures and startup validation. These are not partner API test keys. |

The publishing login is the first-party account-confirmation flow implemented
in `publishing/PublishingLoginService.java`, with its own consent, PKCE code,
and server-side client-secret exchange. The separate publishing application is
in the `org` workspace; this checkpoint changes this verifier's CI only.

The original workflow can be inspected with
`git show HEAD:.github/workflows/backend.yml` before these changes are committed.

## What changed

### Backend

`.github/workflows/backend.yml` now provisions a fresh, digest-pinned PostgreSQL
16 image with `pg_isready` health checks. It starts a separate digest-pinned
MinIO container and waits for its real host health endpoint. This avoids relying
on shell/curl utilities inside the minimal MinIO image.

JDK 21 runs `clean verify`, with Maven caching and explicit false skip flags.
Flyway applies all V1-V15 migrations to an empty database. The canary checks
PostgreSQL major version 16, the complete ordered migration list, and zero
pending migrations. Update its expected count deliberately when adding a new
migration. A real storage canary writes encrypted synthetic bytes to MinIO,
reads and decrypts them, and removes only its own fixture object.

Surefire always activates `test` and resolves `APP_ENV_IMPORTS` to an absent
optional test resource. The base config keeps its previous two dotenv paths
for normal application startup. Merely setting an empty `spring.config.import`
did not suppress document-local imports; the canary caught this, and the actual
import mechanism was fixed rather than removing the assertion.

`application-test.yml` is under test resources and is not packaged into the
application JAR. It contains explicitly fake signing, image-encryption, storage,
and publishing-client fixtures. PostgreSQL/MinIO addresses may be supplied by
CI or the disposable local helper. Tests no longer inherit the developer's
real `.env`, application database, or encryption keys.

### Startup guard and the Spring constructs

`SecretSafetyConfiguration` is a Spring `@Configuration` class. Its static
`@Bean` returns a `BeanFactoryPostProcessor`, which validates the resolved
environment before normal database/storage/authentication beans are constructed.
This is similar to validating settings before constructing FastAPI database
clients in startup code. `proxyBeanMethods=false` avoids an unnecessary proxy
because this configuration has no inter-bean method calls.

Required signing and document keys must have valid lengths/formats. Known
test-only marker values and publishing test-secret digests are rejected outside
the test profile. Combining `test` with `prod` or `production` does not bypass
that restriction. Configured database/storage passwords are also checked for
minimum length and CI fixture markers. Optional publishing remains optional,
but a supplied digest must be well formed and not a known test digest outside
test. No credential values are included in validation errors.

The marker guard does not estimate human password entropy or detect every
possible weak secret. It specifically prevents the public fixtures in this
repository from becoming deployment credentials.

`ApplicationContextRunner` tests the startup configuration in isolation, without
opening a real database connection. Additional packaged-JAR checks exercised
six actual production startup failures: missing, short, and fixture signing
keys, plus missing, short, and fixture document keys. Every case exited nonzero
without logging either configured key. No real development secret was changed.

### Frontend and extractor

Frontend CI uses Node 24, `npm ci`, typecheck, ESLint with zero warnings, all
tests, JUnit report verification, and a production build. Lint exposed three
small issues: an implicit layout-read expression, an unstable empty-array hook
dependency, and an unused typed camera-mock parameter. The forced layout read
is preserved explicitly, the array is memoized, and the mock keeps its typed
call signature. No assertions were weakened.

Extraction has its own Python 3.11 workflow and pinned test requirements. A
ReportLab helper generates a three-page, 45-row synthetic ruled PDF. The existing
PDF assertions run against that fixture. The historically named
`TestAgainstARealRegister` class therefore proves synthetic table extraction in
CI; it does not claim coverage against an actual council's private document.

OCR unit tests replace the Paddle engine with a fake and exercise caching and
missing-package behavior. Normal CI installs neither Paddle nor model weights.
The existing PDF test skips remain useful for optional local private registers;
the CI report gate rejects them if the generated input is missing.

### Permission and report controls

All three workflows declare `permissions: contents: read`, use `pull_request`
rather than privileged `pull_request_target`, and do not reference deployment
secrets. Checkout credential persistence is disabled. All GitHub actions are
pinned to complete SHAs, and Dependabot checks action updates weekly.

Fork code is untrusted and can execute arbitrary commands in a test job. The
job therefore receives only disposable service credentials, not production
secrets or a write-capable repository token. A mutable action tag can also
change the code executed in CI; full commit pins make that change reviewable.
See [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use)
and [PostgreSQL service-container guidance](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers).

`tools/ci/check_test_reports.py` fails on missing/empty reports, any failure,
error, or skip, and missing required database/storage canaries. Four regression
tests cover the gate. Maven can exit zero for an explicitly disabled test; the
separate report gate is what makes that case fail the complete workflow.

## Verification results

A disposable local Git repository was created from the current candidate
source, then cloned without build outputs, dependencies, `.env`, private PDFs,
or document artifacts. The original working tree was not committed or pushed.
All prior intended source changes, including V14/V15, were included in that
candidate; these files must also be part of a coherent published change.

| Clean-clone job | Result | Local elapsed time |
| --- | --- | --- |
| Backend build/JAR, real PostgreSQL 16, real MinIO | 185 tests, zero failures/errors/skips | 25.3 seconds, including service startup/cleanup |
| Frontend install, typecheck, lint, tests, build | 198 tests, zero skips | 28.1 seconds |
| Extractor install/check, generated PDF, mocked OCR | 21 tests, zero skips | 2.2 seconds |
| Report-gate regression suite | 4 tests passed | Included in extractor check |

Dependencies and container images were cached locally. These are measured local
times, not GitHub-hosted pipeline timings. Jobs run independently and each has a
ten-minute timeout. Maven/npm/pip caches and excluding model downloads keep
normal runs small; cold setup and runner availability still need measurement
on the first hosted run.

Failure proofs were made only in the disposable clone, then source mutations
were restored:

- Raising the migration expectation from 15 to 16 made Maven exit 1: one failed
  assertion, zero skipped tests.
- Explicitly disabling the database canary made Maven exit 0 with two skips;
  the report gate then exited 1, proving skipped database coverage cannot look
  green for the full workflow.
- Stopping the disposable PostgreSQL container made Maven exit 1 with two
  database-context errors and zero skips.
- The packaged production app rejected all six missing/short/fixture cases.
- Actionlint 1.7.12 accepted all three workflows. Diff whitespace checks passed.

GitHub Actions itself has not been run for this unpublished candidate. GitHub
CLI authentication is unavailable in this session. No hosted green status or
hosted total runtime is claimed, and no push to main was performed.

## Repeat the checks

Backend, with Docker running, Python 3, and JDK 21:

```bash
python3 tools/ci/verify_backend.py
```

This creates uniquely named services on random loopback ports, runs `clean
verify`, checks the reports, and stops its own containers. It does not use the
running development database. For bare Maven invocations, supply dedicated test
service addresses; defaults are PostgreSQL port 15433 and MinIO port 19000.

Frontend:

```bash
cd frontend
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Extractor, using a Python 3.11 virtual environment:

```bash
python -m pip install -r extraction/requirements-test.txt
python tools/ci/make_test_register.py /tmp/herbimmortal-synthetic-register.pdf
TEST_REGISTER_PDF=/tmp/herbimmortal-synthetic-register.pdf python -m pytest extraction/tests --junitxml=ci-reports/extraction.xml
python tools/ci/check_test_reports.py ci-reports --required extraction.tests.test_extraction.TestAgainstARealRegister
```

## Heavy OCR option, not built

A real Paddle/OCR test adds large engine/model downloads, substantial CPU/RAM
requirements, platform-specific wheels, and cold setup measured in minutes
rather than the subsecond synthetic extraction test. Exact time and resource
cost have not been benchmarked here. A separately approved manual or scheduled
job could cache pinned model weights by engine/model checksum and run synthetic
scans. It is intentionally absent from the normal pull-request pipeline.

## Found Along The Way

These were recorded without unrelated fixes:

- npm audit reports 13 advisories: 12 moderate and one high-severity package,
  `undici`. An advisory count alone does not establish runtime exploitability.
  Dependency remediation was not bundled into this CI change.
- Public verification can still select a historical approval while publishing
  login checks the latest case/current registry. This is the most serious
  outstanding finding and is next in the requested order.
- The normal local MinIO container has an unhealthy shell/curl healthcheck
  despite a working storage service. The new CI service avoids that check;
  the development Compose configuration was not rewritten.
- Document retention configuration exists, but no scheduled retention sweep
  was found in the inspected document service. This needs a separate review.
- `.env.example` still omits the required document master key. COMMANDS.md
  already explains it; the unrelated environment-template cleanup remains open.
- The frontend build retains its existing bundle-size advisory.

No multi-instance fixes or audit were performed in this CI checkpoint. The
prompt places the full report-only multi-instance audit after PDF storage.
Production origins, proxy setup, and planned instance count remain inputs for
later session/rate-limit/storage work, not assumptions needed to provision CI.

The next checkpoint is the verification-consistency inventory only, with no
behavior changes until the characterization matrix and product decisions are
approved. The supplied prompt requires a stop and confirmation here.
