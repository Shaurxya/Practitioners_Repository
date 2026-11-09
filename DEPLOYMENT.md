# HerbImmortal deployment guide

This guide deploys the current verifier on one Linux VPS using Docker Compose
and Caddy for HTTPS. It also describes connecting the separately hosted
publishing website. Replace every example domain and placeholder before use.

**Start with staging and synthetic data.** CI hardening is implemented, but the
verification-consistency, browser-session, login-limit, and distributed-PDF
hardening findings remain open. This deployment procedure does not certify the
application as ready to accept real identity documents. Release conditions are
listed in section 13.

## 1. Deployment layout and prerequisites

| Component | Address or location |
| --- | --- |
| Verifier frontend and API | `https://verify.yourdomain.com`, with `/api/*` forwarded to Spring |
| Publishing website, deployed separately | `https://app.yourdomain.com` |
| Publishing callback | `https://app.yourdomain.com/api/auth/immortal/callback` |
| PostgreSQL 16 | Private Compose service, with a persistent volume |
| MinIO | Private service, persistent volume; host port 9000 bound to loopback only |
| Spring Boot | Non-root runtime container; host port 8080 bound to loopback only |
| PDF extractor | Optional internal container, no host port |
| Registry PDF files | Named volume mounted at `/srv/uploads` in both backend and extractor |

Use a Linux VPS with Docker Engine and the Compose plugin, an SSH account, a
domain you control, persistent disk, and an off-server backup destination.
JDK 21, Node 24, and Python 3 are needed on the build machine, which can be
your development machine or a separate build runner.

This is a single-server layout. The shared upload volume does not support
multiple hosts. OCR sizing depends on register size and must be load-tested;
the normal login/lookup deployment can run without the OCR container.

Install Docker using its [official installation instructions](https://docs.docker.com/engine/install/).
Allow public TCP 80 and 443 and restrict SSH to your administrative sources.
Keep database, storage, extractor, and backend ports closed to the public. Review
Docker's published-port/firewall behavior and your provider's firewall as well.

Point the verifier domain's DNS A record to the VPS. Add an AAAA record only if
IPv6 actually works. Caddy needs working DNS, reachable ports, and persistent
certificate storage for [automatic HTTPS](https://caddyserver.com/docs/automatic-https).
This reference configuration assumes Caddy is directly internet-facing, with
no CDN or additional load balancer ahead of it.

## 2. Make sure the source being deployed includes the recent changes

The working tree currently includes uncommitted application, publishing-login,
schema V14/V15, and CI changes. Review and commit the intended source before
creating a deployment release. A remote clone will not contain files that have
never been committed and pushed.

```bash
git status --short
git diff --check
```

Use a reviewed release commit or tag for each deployment. Keep real `.env`
files, credentials, uploaded PDFs, identity images, and database backups out of
the repository. Audit environment examples for credential-like values and
rotate anything that was ever committed as a real secret.

## 3. Test and build on the build machine

From the repository root, with Docker running:

```bash
python3 tools/ci/verify_backend.py
```

This uses disposable PostgreSQL/MinIO and builds:

```text
backend/target/verification-service-0.0.1-SNAPSHOT.jar
```

Build the real frontend with same-origin API routing:

```bash
cd frontend
npm ci
npm run typecheck
npm run lint
npm test
VITE_API_BASE_URL= VITE_USE_MOCKS=false VITE_REAL_IMPORTS=true VITE_REAL_VERIFY=true npm run build
cd ..
```

The output is `frontend/dist/`. Production serves these files, not `npm run dev`.
The publishing frontend is a separate build, described in section 10.

## 4. Package a minimal backend runtime image

Create a build directory containing only the JAR and this Dockerfile. Do not
send your entire repository, `.env`, or upload directory as the build context.

```bash
mkdir -p .deploy-build
cp backend/target/verification-service-0.0.1-SNAPSHOT.jar .deploy-build/app.jar
```

Save the following as `.deploy-build/Dockerfile.runtime`:

```dockerfile
FROM eclipse-temurin:21-jre@sha256:0b99b3376fbb50dbf9c0af8535fdd5b8eb0d3fdfc8b1e4967f383b6919f6901a
WORKDIR /app
RUN mkdir -p /srv/uploads && chown 10001:10001 /app /srv/uploads
COPY --chown=10001:10001 app.jar /app/app.jar
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Choose a release tag and build for your server's architecture. An Apple Silicon
Mac typically needs `linux/amd64` for an x86 VPS; use `linux/arm64` for an Arm VPS.
The JAR is portable, but the runtime image must match the target server.

```bash
export RELEASE_TAG=release-2026-11-09
docker buildx build --platform linux/amd64 --load -f .deploy-build/Dockerfile.runtime -t "herbimmortal-verifier:$RELEASE_TAG" .deploy-build
docker save -o "herbimmortal-verifier-$RELEASE_TAG.tar" "herbimmortal-verifier:$RELEASE_TAG"
```

An authenticated private image registry can replace this archive transfer.
Store no deployment secrets in build arguments or image layers. Image digests
in this guide were resolved on 2026-11-09; review updates deliberately.

## 5. Prepare files on the VPS

This guide uses `/opt/herbimmortal` as the server directory. Create it with
ownership assigned to your deployment account. Then place these files there:

```text
/opt/herbimmortal/
  compose.deploy.yml
  .env.production
  deploy/Caddyfile
  frontend/dist/...
  extraction/...       # only needed for optional PDF extraction
```

Example transfer from the build machine; replace `deploy@YOUR_SERVER`:

```bash
ssh deploy@YOUR_SERVER 'mkdir -p /opt/herbimmortal/deploy /opt/herbimmortal/frontend/dist'
rsync -az frontend/dist/ deploy@YOUR_SERVER:/opt/herbimmortal/frontend/dist/
scp "herbimmortal-verifier-$RELEASE_TAG.tar" deploy@YOUR_SERVER:/opt/herbimmortal/
```

The first command assumes the deployment account already has permission to
write `/opt/herbimmortal`. On the VPS, load the image using the actual filename:

```bash
cd /opt/herbimmortal
docker load -i herbimmortal-verifier-release-2026-11-09.tar
```

For subsequent updates, stage frontend files in a release directory and switch
them during a controlled release rather than modifying live files mid-request.

## 6. Create the server-only configuration

Create `/opt/herbimmortal/.env.production` with restrictive permissions:

```bash
cd /opt/herbimmortal
umask 077
touch .env.production
chmod 600 .env.production
```

Fill in the following. These are configuration names and placeholders, not
working credentials:

```dotenv
RELEASE_TAG=release-2026-11-09
VERIFY_DOMAIN=verify.yourdomain.com

POSTGRES_DB=verification_prod
POSTGRES_USER=verification
POSTGRES_PASSWORD=REPLACE_WITH_A_NEW_RANDOM_DATABASE_PASSWORD
DB_URL=jdbc:postgresql://postgres:5432/verification_prod
DB_USERNAME=verification
DB_PASSWORD=REPLACE_WITH_THE_SAME_DATABASE_PASSWORD

SPRING_PROFILES_ACTIVE=prod
APP_ENV_IMPORTS=optional:classpath:no-deployment-dotenv.properties
SERVER_PORT=8080
SERVER_FORWARD_HEADERS_STRATEGY=framework
SPRING_JPA_SHOW_SQL=false
LOGGING_LEVEL_ORG_HIBERNATE_ORM_JDBC_BIND=OFF
LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_JDBC_CORE=WARN
AUTH_SECRET=REPLACE_WITH_A_NEW_SIGNING_KEY
DOCUMENT_MASTER_KEY=REPLACE_WITH_A_NEW_32_BYTE_BASE64_KEY

MINIO_ROOT_USER=herbimmortal-prod
MINIO_ROOT_PASSWORD=REPLACE_WITH_A_NEW_RANDOM_STORAGE_PASSWORD
MINIO_ENDPOINT=http://minio:9000
DOCUMENT_BUCKET=identity-documents-prod
DOCUMENT_REGION=us-east-1

UPLOAD_DIR=/srv/uploads
EXTRACTION_URL=http://extraction:8000

PUBLISHING_CLIENT_ID=publishing-org
PUBLISHING_REDIRECT_URI=https://app.yourdomain.com/api/auth/immortal/callback
PUBLISHING_ISSUER=https://verify.yourdomain.com
PUBLISHING_CLIENT_SECRET_SHA256=REPLACE_WITH_THE_PUBLISHER_SECRET_DIGEST
```

Generate independent values for a **new environment**:

```bash
# AUTH_SECRET:
openssl rand -base64 48
# DOCUMENT_MASTER_KEY, exactly 32 decoded bytes:
openssl rand -base64 32
# Generate separate database and storage passwords:
openssl rand -base64 36
openssl rand -base64 36
```

Generate the publishing login client secret and matching digest once on a
trusted administrative machine. Copy the first value only to the publisher's
backend configuration, and the digest to the verifier:

```bash
python3 - <<'PY'
import hashlib
import secrets
secret = secrets.token_urlsafe(48)
print('Publisher HERBIMMORTAL_LOGIN_CLIENT_SECRET=' + secret)
print('Verifier PUBLISHING_CLIENT_SECRET_SHA256=' + hashlib.sha256(secret.encode()).hexdigest())
PY
```

Keep generated values in your deployment secret store. Do not run generation
commands in recorded CI logs. An owner-only environment file is the reference
mechanism here; use your platform's secret injection for a managed deployment.
If deploying the verifier without the publishing integration initially, leave
`PUBLISHING_CLIENT_SECRET_SHA256` empty. Publishing confirmation remains
unavailable until a real client secret and its matching digest are configured.

Preserve the same signing key, document master key, database credentials, and
publishing client configuration on later releases. Changing the document master
key without a rewrapping procedure makes stored images unreadable. Store its
recovery copy separately from database backups. The application refuses public
CI fixture keys outside the test profile. Never activate `test`, `local`, or
`import` for this deployment.

## 7. Create the Compose configuration

Save as `/opt/herbimmortal/compose.deploy.yml`. This is separate from the local
development Compose files. It preserves data in named volumes and exposes only
the HTTPS gateway publicly.

```yaml
name: herbimmortal-deploy

services:
  postgres:
    image: postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?required}
      POSTGRES_USER: ${POSTGRES_USER:?required}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, 'pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB']
      interval: 5s
      timeout: 5s
      retries: 12

  minio:
    image: cgr.dev/chainguard/minio@sha256:a1ac4589a5f8136b616e667b48a0bea9719bb10bd45799ea946f24bbedfafde4
    restart: unless-stopped
    command: [server, /data]
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?required}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?required}
    ports:
      - 127.0.0.1:9000:9000
    volumes:
      - minio-data:/data

  uploads-init:
    image: herbimmortal-verifier:${RELEASE_TAG:?required}
    user: '0:0'
    entrypoint: [/bin/sh, -ec]
    command: ['chown 10001:10001 /srv/uploads && chmod 0700 /srv/uploads']
    volumes:
      - registry-uploads:/srv/uploads
    restart: 'no'

  backend:
    image: herbimmortal-verifier:${RELEASE_TAG:?required}
    restart: unless-stopped
    env_file: [.env.production]
    ports:
      - 127.0.0.1:8080:8080
    volumes:
      - registry-uploads:/srv/uploads
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    depends_on:
      postgres:
        condition: service_healthy
      uploads-init:
        condition: service_completed_successfully

  extraction:
    profiles: [pdf]
    build:
      context: ./extraction
    restart: unless-stopped
    volumes:
      - registry-uploads:/srv/uploads:ro
    depends_on:
      uploads-init:
        condition: service_completed_successfully

  caddy:
    image: caddy:2-alpine@sha256:78bd35025c7ba85961dd149ae670315129954e77abe2383ac47c89106b35ade9
    restart: unless-stopped
    environment:
      VERIFY_DOMAIN: ${VERIFY_DOMAIN:?required}
    ports:
      - 80:80
      - 443:443
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./frontend/dist:/srv/site:ro
      - caddy-data:/data
      - caddy-config:/config

volumes:
  postgres-data:
  minio-data:
  registry-uploads:
  caddy-data:
  caddy-config:
```

MinIO is checked from the host before backend startup in section 9 because its
minimal image does not provide the shell/curl healthcheck used in local Compose.
The current backend creates its document bucket at startup; storage must be
ready first. The image-encryption key and stored images are separate concerns.

## 8. Create HTTPS and SPA routing

Save this as `/opt/herbimmortal/deploy/Caddyfile`:

```caddyfile
{$VERIFY_DOMAIN} {
    encode gzip
    request_body {
        max_size 220MB
    }
    header {
        X-Content-Type-Options nosniff
        Referrer-Policy no-referrer
        X-Frame-Options DENY
    }
    handle /api/* {
        reverse_proxy backend:8080
    }
    handle /actuator/* {
        respond "Not found" 404
    }
    handle /assets/* {
        root * /srv/site
        header Cache-Control "public, max-age=31536000, immutable"
        file_server
    }
    handle {
        root * /srv/site
        header Cache-Control no-store
        try_files {path} /index.html
        file_server
    }
}
```

`handle` preserves `/api/`; `handle_path` would strip it and break Spring routes.
The fallback serves React for `/publishing/confirm`, `/login`, and other client
routes. See [Caddy's SPA routing patterns](https://caddyserver.com/docs/caddyfile/patterns).
No access-log directive is enabled here. Before adding proxy/APM logging, exclude
authorization headers, cookies, code/state query strings, and identity content
from both normal and error logs. CSP and session hardening remain separate work.

## 9. Start storage, then the backend, then the gateway

On the VPS:

```bash
cd /opt/herbimmortal
docker compose --env-file .env.production -f compose.deploy.yml config --quiet
docker compose --env-file .env.production -f compose.deploy.yml up -d postgres minio uploads-init
docker compose --env-file .env.production -f compose.deploy.yml ps -a
```

Wait for PostgreSQL to be healthy, `uploads-init` to exit 0, and this readiness
check to return HTTP 200:

```bash
curl --fail http://127.0.0.1:9000/minio/health/ready
```

Then start Spring. Flyway applies the packaged migrations automatically:

```bash
docker compose --env-file .env.production -f compose.deploy.yml up -d backend
docker compose --env-file .env.production -f compose.deploy.yml logs --tail=100 backend
```

After startup, check from the VPS. The health response must be JSON with `UP`:

```bash
curl --fail http://127.0.0.1:8080/actuator/health
```

There is no bootstrap administrator under `prod`. For a fresh database, use the
operator procedure in section 11 before opening administrative access.

Validate and start Caddy after DNS is configured and the API is healthy:

```bash
docker compose --env-file .env.production -f compose.deploy.yml run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file .env.production -f compose.deploy.yml up -d caddy
docker compose --env-file .env.production -f compose.deploy.yml logs --tail=100 caddy
```

## 10. Connect the separately deployed publishing website

Its backend needs its existing MongoDB connection, JWT/session secrets,
configured publishing features, and these production settings:

```dotenv
NODE_ENV=production
PORT=5001
CLIENT_URL=https://app.yourdomain.com
FRONTEND_URL=https://app.yourdomain.com
SITE_URL=https://app.yourdomain.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=

HERBIMMORTAL_IDENTITY_URL=https://verify.yourdomain.com
HERBIMMORTAL_FRONTEND_URL=https://verify.yourdomain.com
HERBIMMORTAL_LOGIN_CLIENT_ID=publishing-org
HERBIMMORTAL_LOGIN_CALLBACK_URL=https://app.yourdomain.com/api/auth/immortal/callback
HERBIMMORTAL_LOGIN_CLIENT_SECRET=THE_SEPARATE_SECRET_GENERATED_IN_SECTION_6
```

Keep the publisher's `JWT_SECRET` and `SESSION_SECRET` independent from the
verifier's `AUTH_SECRET`. An existing personal API key cannot replace the login
client secret. Existing third-party features such as Google login or media
uploads also need their own deployment configuration.

Serve the publishing frontend and `/api/*` backend routes on its own domain,
with `/api/auth/immortal/callback` forwarded to Node rather than the SPA.
Build its frontend using its actual API variable:

```bash
# Run from the separate org/Frontend repository:
npm ci
VITE_API_URL=https://app.yourdomain.com/api VITE_SITE_URL=https://app.yourdomain.com VITE_ENV=production npm run build
```

The publishing app's `VITE_API_URL` includes `/api`, unlike the verifier's
`VITE_API_BASE_URL`, which is empty for the same-origin proxy in this guide.

Run the publishing backend with a process supervisor or its platform runtime
using `npm start`. Bind its API behind that application's HTTPS proxy, and
restart it after changing environment settings. This guide does not provision
the separate publishing app's MongoDB, media providers, or hosting platform.
Its broader deployment and CORS/proxy settings need their own review.

The issuer, client ID, callback URI, and client-secret digest must match
exactly between the applications. Begin each login at the publishing website;
do not reuse an old confirmation URL after its state expires.

## 11. Create the first production administrator deliberately

If restoring an existing production database, use its existing administrator.
For a new database, register your operator account through the private backend
before Caddy is started. This script prompts without putting a password in a
shell argument and prints only the resulting account ID:

```bash
python3 - <<'PY'
import getpass
import json
import urllib.request
email = input('Administrator email: ').strip()
password = getpass.getpass('Choose a strong new password: ')
name = input('Administrator name: ').strip()
request = urllib.request.Request(
    'http://127.0.0.1:8080/api/v1/auth/register',
    data=json.dumps({'email': email, 'password': password, 'fullName': name}).encode(),
    headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, timeout=15) as response:
    print('Account ID:', json.load(response)['user']['id'])
PY
```

Promote only that exact account with the operator's database access. Replace
the UUID below with the returned ID, not an email match or demo account:

```bash
docker compose --env-file .env.production -f compose.deploy.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -v admin_id=REPLACE_WITH_RETURNED_UUID -U verification -d verification_prod <<'SQL'
BEGIN;
WITH promoted AS (
    UPDATE users SET role = 'ADMIN', updated_at = now()
    WHERE id = :'admin_id'::uuid AND role = 'PRACTITIONER' AND status = 'ACTIVE'
    RETURNING id
)
INSERT INTO audit_events(event_type, subject_type, subject_id, actor_type,
                         actor_id, from_status, to_status, reason)
SELECT 'ADMIN_BOOTSTRAP', 'user', id, 'SYSTEM', 'deployment-operator',
       'PRACTITIONER', 'ADMIN', 'Initial administrator provisioned by deployment operator.'
FROM promoted;
COMMIT;
SQL
```

The insert must report one row. Stop and investigate a zero-row result. Sign
in again afterwards so a fresh session carries the new role. Do not enable
development bootstrap settings or the `local` profile on the public deployment.

## 12. Optional PDF extraction on this same server

Copy the repository's `extraction/` directory into `/opt/herbimmortal/extraction/`.
This optional build installs PaddleOCR and may download large model files.
Only run it when you intend to enable PDF imports and have tested the server's
CPU architecture, available RAM, disk, and OCR availability.

```bash
cd /opt/herbimmortal
docker compose --env-file .env.production -f compose.deploy.yml --profile pdf build extraction
docker compose --env-file .env.production -f compose.deploy.yml --profile pdf up -d extraction
docker compose --env-file .env.production -f compose.deploy.yml logs --tail=100 extraction
```

Check from inside the extraction container, where Python is available:

```bash
docker compose --env-file .env.production -f compose.deploy.yml --profile pdf exec -T extraction \
  python -c 'import json, urllib.request; print(json.load(urllib.request.urlopen("http://127.0.0.1:8000/health")))'
```

Scanned registers require `ocr: AVAILABLE`. The Dockerfile's build-time model
warm-up tolerates failure, so successful image building alone is insufficient.
No OCR image build or model download was performed while preparing this guide.

Both processes see `/srv/uploads`, and the extractor mounts it read-only. That
fixes the local path mismatch for this one-host arrangement. It does not solve
cross-host storage, duplicate parsing jobs, or recovery after a parser crash.
Leave the extractor internal. The development CSV import profile stays off.

## 13. Smoke tests and public-release conditions

Replace domains in these checks:

```bash
curl --fail --head https://verify.yourdomain.com/
curl --fail --head https://verify.yourdomain.com/publishing/confirm
curl --fail https://verify.yourdomain.com/api/v1/countries
curl --fail 'https://verify.yourdomain.com/api/v1/public/verify?immortalId=HI-26INA-ZZZZZ'
```

The unknown ID should return `NOT_VERIFIED` unless it was genuinely issued;
the confirmation URL without a request should render sign-in or an invalid
request screen, not a hosting 404. Public `/actuator/health` should be blocked;
use the host-loopback health check for operators.

Before accepting real practitioner data, complete and verify these open items:

- Canonical verification standing shared by public lookup and publishing login.
- The approved session-storage/refresh-cookie hardening, recovery flows, and
  administrator/reviewer access protections.
- Login, code exchange, and lookup rate limits with correct trusted-proxy handling.
- Dependency advisory review, secret scanning, and no synthetic approvals or
  known demo credentials in the production database.
- Real-browser HTTPS callback, wrong-owner denial, code/state expiry, replay,
  logout, revocation, and provider-outage tests across both hosted applications.
- Database and document-storage backups, separate encryption-key recovery,
  a tested restore, logging/alerts, and retention operations.
- Bucket-scoped storage credentials for the application in place of MinIO root
  credentials, with bucket provisioning and access tested before cutover.
- Resource limits and malicious/oversized PDF tests before enabling imports.
- A hosted CI run of the reviewed release. Local clean-clone tests passed;
  the unpublished changes do not yet have a verified GitHub-hosted result.

See [CI results](docs/CI_HARDENING.md) and
[publishing login details](docs/PUBLISHING_LOGIN.md). Do not copy the local demo
database or run `tools/seed_demo_ids.sql` against this deployment.

## 14. Updates, backups, and rollback

Before updates, take an owner-only logical database backup on the VPS:

```bash
cd /opt/herbimmortal
umask 077
mkdir -p backups
docker compose --env-file .env.production -f compose.deploy.yml exec -T postgres \
  pg_dump -U verification -d verification_prod -Fc > "backups/verification-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Copy encrypted backups off the VPS and back up document objects and registry
uploads. Keep the document master key in a separate protected recovery store.
A database backup by itself cannot recover missing objects or a lost master
key. Test restoration into an isolated environment before relying on backups.

For an update, load the new runtime image, stage the new frontend build, change
`RELEASE_TAG` in `.env.production`, and recreate the backend:

```bash
docker compose --env-file .env.production -f compose.deploy.yml up -d backend
docker compose --env-file .env.production -f compose.deploy.yml logs --tail=100 backend
curl --fail http://127.0.0.1:8080/actuator/health
```

Use `up -d` to apply changed images/configuration; `restart` alone does not load
new Compose configuration. Follow the [Compose production guidance](https://docs.docker.com/compose/how-tos/production/).
Switch frontend assets and re-run the hosted login checks as part of the same
controlled release.

Keep the previous image and frontend release. Roll back the application only
after checking compatibility with the applied schema. Never edit applied Flyway
migrations or assume that reverting an image reverses database changes. A full
database restore can discard newer writes and needs a maintenance procedure.

To stop services while preserving named data volumes:

```bash
docker compose --env-file .env.production -f compose.deploy.yml --profile pdf down
```

Do not add `-v` to that command on an environment whose data you need to keep.

## Validation of this guide

This guide was written against the current source. The embedded Compose and
Caddy configuration passed validation with temporary placeholder settings. The
minimal backend image built successfully and its non-root Java 21 runtime was
checked. Shell blocks passed syntax checks, and the runtime JAR excludes the
test-profile configuration. These checks are not a real
VPS deployment, certificate issuance, OCR build, production restore, or hosted
browser test. No server was provisioned and no public deployment was performed.
