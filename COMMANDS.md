# HerbImmortal — project overview and run commands

## What this project does

HerbImmortal verifies healthcare practitioners against council registration
records, including practitioners of Indian systems of medicine.

1. An administrator imports a council register, maps its columns, reviews the
   extracted rows, and promotes the records into the searchable registry.
2. A practitioner creates an account, looks up their registration, and submits
   a claim with a photo ID and a captured selfie.
3. The backend checks the registration, name match, active status, expiry,
   sanctions, duplicate matches, and identity evidence.
4. Reviewers examine cases that need a person and approve or reject them.
   Approved practitioners receive an **Immortal ID**.
5. Patients and employers can check that ID on the public verification page
   without creating an account.

The current identity provider is **manual**: it does not automatically compare
faces or detect liveness. Those checks require a reviewer. Registry data must
be imported; a new database does not contain real practitioner registers.

| Component | Technology | Default local address |
| --- | --- | --- |
| Website | React, TypeScript, Vite | http://localhost:5173 |
| API | Java 21, Spring Boot, Maven | http://localhost:8080 |
| Database | PostgreSQL 16, Flyway migrations | localhost:5433 |
| Document storage | MinIO; identity images encrypted by the backend | http://localhost:9000 |
| Storage console | MinIO console | http://localhost:9001 |
| PDF extraction | Python, FastAPI, pdfplumber, optional PaddleOCR | http://localhost:8000 |

The commands below use **macOS zsh/bash** and this checkout's location. Keep
each server terminal open. Use the repository-root `docker-compose.yml`;
`infra/docker-compose.yml` is a separate stack with different defaults.

## 1. Prerequisites

Install JDK 21, Node.js 24.15 or newer within the 24.x series, npm, and Docker
Desktop. The repository includes Maven's wrapper, so Maven need not be installed
separately. Python 3 is also used by the local CI verification helper and the
optional sample CSV step. Extraction tests use Python 3.11.

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
java -version
node --version
npm --version
docker compose version
docker info
```

If Docker is not running, start Docker Desktop and wait for its engine:

```bash
open -a Docker
```

If Java 21 is installed but not selected on macOS:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
export PATH="$JAVA_HOME/bin:$PATH"
```

## 2. One-time environment setup

Create `.env` only if it does not already exist. This preserves existing settings:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
cp -n .env.example .env
mkdir -p data/uploads
```

Open the root `.env` in your editor and confirm these settings for a local run:

```dotenv
POSTGRES_DB=verification
POSTGRES_USER=verification
POSTGRES_PASSWORD=change-me
POSTGRES_PORT=5433
DB_URL=jdbc:postgresql://localhost:5433/verification
DB_USERNAME=verification
DB_PASSWORD=change-me
SERVER_PORT=8080
SPRING_PROFILES_ACTIVE=local

VITE_API_BASE_URL=
VITE_USE_MOCKS=false
VITE_REAL_IMPORTS=true
VITE_REAL_VERIFY=true

MINIO_ROOT_USER=verification
MINIO_ROOT_PASSWORD=verification-minio
MINIO_ENDPOINT=http://localhost:9000
DOCUMENT_BUCKET=identity-documents
EXTRACTION_URL=http://localhost:8000

AUTH_BOOTSTRAP_ADMIN_EMAIL=admin@herbimmortal.local
AUTH_BOOTSTRAP_ADMIN_PASSWORD=replace-with-your-local-admin-password
```

Use matching database passwords in `POSTGRES_PASSWORD` and `DB_PASSWORD`.
If your existing database uses different credentials, keep those credentials.
The example above is for local development. Set your own administrator password
of at least 12 characters.

Generate the two required keys separately:

```bash
# Paste this output into AUTH_SECRET in .env:
openssl rand -base64 48

# Paste this output into DOCUMENT_MASTER_KEY in .env:
openssl rand -base64 32
```

Add or update these entries with the generated values:

```dotenv
AUTH_SECRET=paste-the-first-generated-value-here
DOCUMENT_MASTER_KEY=paste-the-second-generated-value-here
```

Keep existing nonempty keys when restarting. Changing the document master key
makes previously encrypted identity images unreadable. The backend refuses to
start without both keys. `DOCUMENT_MASTER_KEY` is needed even though it is
missing from the current `.env.example`.

Spring Boot, Vite, and Docker Compose read the root `.env` automatically;
you do not need to source it into your shell. Restart servers after changes.

## 3. Start the database and storage

From the repository root:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
docker compose up -d postgres minio
docker compose ps
```

Wait for PostgreSQL to be healthy. Check MinIO from your host:

```bash
curl -f http://localhost:9000/minio/health/live
```

A successful MinIO check can return an empty body with HTTP 200. If a service
fails to start, inspect its logs:

```bash
docker compose logs --tail=100 postgres minio
```

The current MinIO container healthcheck uses a shell and `curl`. If Docker
reports it unhealthy, compare that result with the host `curl` check and logs;
the image may not contain the healthcheck's tools.

## 4. Start the backend — terminal 1

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
export UPLOAD_DIR="$PWD/data/uploads"
cd backend
./mvnw spring-boot:run
```

The first run downloads Maven and dependencies. Flyway creates or updates the
database schema automatically. Wait for `Started VerificationServiceApplication`.

The absolute `UPLOAD_DIR` also enables the extraction command in step 6 to see
the same uploaded files.

## 5. Start the frontend — terminal 2

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/frontend
npm ci
npm run dev -- --strictPort
```

Run `npm ci` for initial setup or after dependency changes. On subsequent runs,
`npm run dev -- --strictPort` is sufficient.

Open http://localhost:5173. Useful pages:

| Page | URL |
| --- | --- |
| Sign in | http://localhost:5173/login |
| Create practitioner account | http://localhost:5173/signup |
| Claim registration | http://localhost:5173/submit |
| My cases | http://localhost:5173/cases |
| Admin review | http://localhost:5173/admin |
| Import council register | http://localhost:5173/admin/imports/new |
| Public ID check | http://localhost:5173/verify |

Sign in as the administrator configured in step 2 to import registers or review
claims. The bootstrap creates the administrator only when none exists; editing
its password in `.env` does not reset an existing account's password. Ordinary
signup creates practitioner accounts.

## 6. Enable PDF extraction — terminal 3, needed for PDF imports

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
docker compose build extraction
docker compose run --rm --service-ports \
  --volume "$PWD/data/uploads:$PWD/data/uploads:ro" \
  extraction
```

This builds the Python 3.11 extraction image and runs it on port 8000. The first
build installs OCR dependencies and may download model weights.

The extra volume is intentional: Spring passes its upload path directly to the
extractor. The default Compose mount only exposes `/srv/uploads`, which differs
from the host path. Together with `UPLOAD_DIR` in step 4, this command makes the
same absolute path available in both processes. Use this command instead of
starting a second extraction container with `docker compose up extraction`.

Verify it from another terminal:

```bash
curl -f http://localhost:8000/health
```

Look for `"status":"UP"`. Scanned PDFs also need `"ocr":"AVAILABLE"`;
`"ocr":"UNAVAILABLE"` means only text-layer extraction is available. If image
building fails while installing Paddle packages, the OCR image has not started;
inspect the build output for a platform or dependency compatibility error.

## 7. Check the running API

```bash
curl -f http://localhost:8080/actuator/health
curl -f http://localhost:8080/api/v1/councils
curl -f http://localhost:8080/api/v1/countries
curl -f http://localhost:8080/api/v1/medical-systems
```

The health response should report `UP`, including its database component.
For an end-to-end exercise, import and promote a register as administrator,
create a practitioner account, submit a matching claim with identity images,
review it as administrator, and check the issued ID on `/verify`.

## Optional: generate sample registry data

For development without a council PDF, stop the backend with Ctrl+C, then run:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
python3 tools/generate_synthetic_registry.py data/registry_synthetic.csv --rows 5000
export UPLOAD_DIR="$PWD/data/uploads"
cd backend
./mvnw spring-boot:run -Dspring-boot.run.profiles=local,import
```

The `import` profile reads the CSV at startup and leaves the API running. It is
synthetic test data with deliberately messy names, dates, and duplicates. Use
the normal backend command on later starts to avoid rerunning ingestion.

## Optional: frontend-only demo

To explore the interface without starting Java or Docker:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/frontend
npm ci
VITE_USE_MOCKS=true VITE_REAL_IMPORTS=false VITE_REAL_VERIFY=false npm run dev -- --strictPort
```

Sign in with the built-in **mock-only** account
`admin@herbimmortal.test` / `devpassword`. This mode uses browser fixtures;
it does not validate real practitioners or save records to PostgreSQL.

## Build and test commands

Backend build and tests use disposable PostgreSQL and MinIO containers. Start
Docker Desktop, then run this helper; it creates isolated services, builds the
JAR, runs the full suite, and removes its own services afterwards:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
python3 tools/ci/verify_backend.py
```

Tests now activate the `test` profile and do not read the real root `.env`.
Bare `./mvnw test` requires dedicated test PostgreSQL/MinIO services or explicit
test `DB_URL` and `MINIO_ENDPOINT` settings. See [CI hardening](docs/CI_HARDENING.md).

Frontend:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository/frontend
npm run build
npm run lint
npm test
```

The frontend build is written to `frontend/dist/` and the backend JAR to
`backend/target/`. The Vite development proxy is what forwards `/api` locally;
serving the built frontend separately needs API routing configured as well.

## Stop the project

Press **Ctrl+C** in each running frontend, backend, and extraction terminal.
Then stop the database and storage while retaining their data:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
docker compose down
```

## Common startup issues

- **Docker socket/daemon error:** open Docker Desktop and wait for its engine.
- **Database authentication fails:** the `DB_*` settings must match the existing
  database. Changing `.env` does not change credentials inside an existing volume.
- **Missing signing or document key:** set `AUTH_SECRET` and
  `DOCUMENT_MASTER_KEY` as described in step 2.
- **Port already in use:** check ports 5173, 8080, 5433, 8000, 9000, and 9001.
  Run only one of the two Compose stacks. If moving Spring's port, export
  `SERVER_PORT` in the frontend terminal too so Vite's proxy uses that port.
- **PDF reports file not found:** use the absolute upload directory and matching
  volume mount from steps 4 and 6.
- **Mock records appear during a real run:** set `VITE_USE_MOCKS=false`, restart
  Vite, and reload the page. If needed, unregister the old MSW worker under the
  browser's developer tools → Application → Service Workers.

## Verification of this guide

These commands were checked against the current source, package scripts, and
Compose configuration. `docker compose config --quiet` passed. The Docker
daemon was not running when this guide was prepared, so full service startup
and the OCR image build have not been verified in this session.
