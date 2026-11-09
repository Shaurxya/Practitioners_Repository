# Local demo Immortal IDs

These are synthetic fixtures seeded into the local PostgreSQL database.
They are not real practitioners and do not prove registration or identity.
No login account or password is created by this seed.

For cross-website publishing login, `HI-26INA-DEMO1` has subsequently been
linked to a separately created local demo owner account. See
[publishing login](PUBLISHING_LOGIN.md) for the sign-in procedure. The remaining
fixtures are public lookup examples, not supplied login accounts.

Open http://127.0.0.1:5174/verify and enter:

| Immortal ID | Demo scenario | Expected public result |
| --- | --- | --- |
| `HI-26INA-DEMO1` | Ayurveda, approved demo | VERIFIED |
| `HI-26INU-DEMO2` | Unani, approved demo | VERIFIED |
| `HI-26INS-DEMO3` | Siddha, approved demo | VERIFIED |
| `HI-26INA-DEMO4` | Expired demo | NOT_VERIFIED |
| `HI-26INA-DEMO5` | Revoked demo | NOT_VERIFIED |

The public API deliberately does not reveal whether a nonverified ID is expired,
revoked, unknown, or otherwise unverified.

Example request:

```bash
curl 'http://localhost:8080/api/v1/public/verify?immortalId=HI-26INA-DEMO1'
```

Recreate the fixtures after resetting the local database:

```bash
cd /Users/shauryasharma/Desktop/Practitioners_Repository
docker exec -i verification-postgres psql -v ON_ERROR_STOP=1 -U verification -d verification < tools/seed_demo_ids.sql
```

Run this only against local development infrastructure. It seeds deliberately
approved synthetic cases so lookup screens can be demonstrated without asserting
that a real review occurred. Case reasons, snapshots, rule results, and audit
events explicitly identify them as synthetic. It creates no identity images,
passing biometric results, or real council credentials.

Re-running does not duplicate the fixtures or reset existing demo decisions.
It refuses conflicting practitioner records rather than overwriting them.
The supplied IDs use the existing current-format validator; the `DEMO` suffix
is a naming convention, not an implemented sandbox security boundary.

These fixtures require the real local API (`VITE_USE_MOCKS=false`). They are not
automatically available in the separate frontend-only mock dataset or on a
deployed environment. All five expected results were checked through both
the backend and the frontend's API proxy on 2026-11-09.

The frontend was started on port 5174 because another project occupies 5173.
To start it again, run from `frontend/`:

```bash
SERVER_PORT=8080 npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```
