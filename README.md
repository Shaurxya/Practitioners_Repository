# verification-service

The practitioner verification backend for HerbImmortal.

**What exists right now:** a Spring Boot app that boots, connects to a real
PostgreSQL running in Docker, and lets Flyway own the schema. That is all.
No entities, no endpoints of our own, no auth. The point of this stage is to
prove the app genuinely reaches the database before anything is built on top.

## Prerequisites

| Tool | Version | Check with |
|---|---|---|
| JDK | 21 or newer | `java -version` |
| Docker Desktop | any recent, **running** | `docker version` |
| Maven | not needed | use the bundled `mvnw.cmd` |

If `java -version` prints 17 or lower, install a JDK 21. [Eclipse Temurin 21](https://adoptium.net/temurin/releases/?version=21)
is the usual choice on Windows and its installer sets `JAVA_HOME` for you.

Commands below are **PowerShell**, run from the repository root unless stated.

---

## 1. Start Postgres

```powershell
docker compose up -d
```

Then confirm it is not just started but actually accepting connections:

```powershell
docker compose ps
```

**Correct output.** The `STATUS` column says `(healthy)`, not `(health: starting)`
and not just `Up`:

```
NAME                    IMAGE                STATUS                   PORTS
verification-postgres   postgres:16-alpine   Up 12 seconds (healthy)  0.0.0.0:5433->5432/tcp
```

`(health: starting)` for the first 10 to 15 seconds is normal, that is the
`start_period` in the healthcheck. Wait and run it again. If it never becomes
healthy, see the troubleshooting section.

## 2. Build

```powershell
cd backend
.\mvnw.cmd clean package
```

The very first run downloads Maven itself and then every dependency, so expect
two to five minutes and a lot of scrolling. Later runs take seconds.

**Correct output** ends with:

```
[INFO] Tests run: 1, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Note that `package` runs the test, and the test starts the whole app, so
**step 1 must have succeeded first**. A build failure here with a connection
error means Postgres is not up, not that your code is broken.

## 3. Run

```powershell
.\mvnw.cmd spring-boot:run
```

**Correct output** ends with these lines, in this order. The Flyway line and
the Hikari line are the ones worth reading:

```
HikariPool-1 - Start completed.
Flyway Community Edition ... by Redgate
Database: jdbc:postgresql://localhost:5433/verification (PostgreSQL 16.14)
Successfully validated 1 migration
Tomcat started on port 8080 (http) with context path '/'
Started VerificationServiceApplication in 1.698 seconds
```

Leave this terminal running. Open a second one for the checks below.

## 4. Health, with the database component

```powershell
curl.exe http://localhost:8080/actuator/health
```

Use `curl.exe`, with the extension. Plain `curl` in PowerShell is an alias for
`Invoke-WebRequest`, which takes different arguments and will confuse you.

**Correct output.** Both the top level `status` and the nested `db` component
must say `UP`:

```json
{
  "status": "UP",
  "components": {
    "db": {
      "status": "UP",
      "details": { "database": "PostgreSQL", "validationQuery": "isValid()" }
    },
    "diskSpace": { "status": "UP", "details": { ... } },
    "ping": { "status": "UP" },
    "ssl": { "status": "UP", "details": { ... } }
  }
}
```

**This is the check that matters.** If you only see `{"status":"UP"}` with no
`components`, the `local` profile did not load, so `show-details: always` was
never applied. Look at the startup log for a line reading
`The following 1 profile is active: "local"`.

An app cannot report `"db": {"status": "UP"}` without having opened a real
connection, so this rules out the "booted fine but never reached the database"
failure mode.

## 5. Prove Flyway ran

```powershell
docker exec verification-postgres psql -U verification -d verification -c "select installed_rank, version, description, script, success from flyway_schema_history;"
```

**Correct output**, one row, `success` is `t`:

```
 installed_rank | version | description |    script    | success
----------------+---------+-------------+--------------+---------
              1 | 1       | init        | V1__init.sql | t
```

An empty table, or a `success` of `f`, means the migration did not apply.

## 6. Prove pgcrypto is installed

```powershell
docker exec verification-postgres psql -U verification -d verification -c "select extname, extversion from pg_extension where extname = 'pgcrypto';"
```

**Correct output:**

```
 extname  | extversion
----------+------------
 pgcrypto | 1.3
```

And the reason it is there at all:

```powershell
docker exec verification-postgres psql -U verification -d verification -c "select gen_random_uuid();"
```

Which returns a UUID. Later tables can default their primary keys to this
instead of generating IDs in application code.

---

## What each file is for

| File | Purpose |
|---|---|
| `docker-compose.yml` | Runs PostgreSQL 16 on host port 5433 with a named volume and a `pg_isready` healthcheck |
| `.gitignore` | Keeps `target/`, IDE folders, and real `.env` files out of git |
| `backend/pom.xml` | Maven build: dependencies, Java 21, the Spring Boot plugin |
| `backend/mvnw`, `backend/mvnw.cmd`, `backend/.mvn/` | Maven wrapper, so nobody needs Maven installed. `.cmd` is the Windows one |
| `backend/src/main/java/.../VerificationServiceApplication.java` | The `main` method and `@SpringBootApplication`, the whole app |
| `backend/src/main/resources/application.yml` | Base config: datasource, JPA, Flyway, Actuator. Loaded in every environment |
| `backend/src/main/resources/application-local.yml` | Local only: SQL logging and full health details |
| `backend/src/main/resources/db/migration/V1__init.sql` | First migration, creates the `pgcrypto` extension |
| `backend/src/test/java/.../VerificationServiceApplicationTests.java` | The default context load test. Needs Postgres running |

## Two settings worth understanding

### Why `ddl-auto: validate`, and why `update` is a trap

`spring.jpa.hibernate.ddl-auto` controls whether Hibernate changes your schema
at startup.

- `validate` compares each `@Entity` against the real tables and refuses to
  boot if they disagree. It never issues DDL.
- `update` looks at the difference and quietly runs whatever ALTER statements
  it thinks will close the gap.

`update` is seductive because it means you never write a migration. It is a
trap for four reasons:

1. **It only ever adds.** Rename a field and it adds a new column and leaves
   the old one behind, full of your data, forever. Delete a field and the
   column stays. Your schema slowly fills with debris nobody dares drop.
2. **It cannot express a data migration.** Splitting `full_name` into
   `first_name` and `last_name` needs an UPDATE statement to move the data.
   Hibernate adds two empty columns and moves nothing.
3. **The schema becomes unreproducible.** It is the result of every version of
   the code that ever ran against that database, in order. Staging and
   production diverge and there is no artifact describing either one.
4. **It runs unreviewed DDL against production at startup.** An `ALTER TABLE`
   on a large table can lock it for minutes. Nobody reviewed it, because it was
   never written down.

Flyway solves all four: every change is a reviewed file in git, applied in
order, identically everywhere. `validate` is what makes the two cooperate.
Flyway owns the schema, Hibernate checks it matches the code and complains
early if someone forgot a migration.

The FastAPI equivalent is exactly the same discipline: Alembic owns the schema
and you never call `Base.metadata.create_all()` outside of tests.

### Why `open-in-view: false`

It defaults to `true`, and Spring Boot logs a warning about it on every boot
that most people learn to ignore.

With it **on**, Spring opens a database session at the start of an HTTP request
and holds it until the response has been fully written. Any lazily loaded
relationship you touch while serialising to JSON quietly works, because the
session is still open.

That sounds convenient and it is the problem. It means:

- A database connection is held for the entire request, including time spent on
  JSON serialisation and slow clients. Under load the connection pool empties.
- Lazy loading fires **during serialisation**, in the web layer, where you
  cannot see it. Ten entities in a list become eleven queries, then a hundred
  and one, and it never shows up in the service code you are reading.

With it **off**, the session closes when the service method returns. Touching a
lazy relationship after that throws `LazyInitializationException` immediately,
in development, pointing at the exact line. You then load what you need
explicitly with a join fetch or a projection.

Short version: `true` hides N+1 query bugs until production. `false` turns them
into a loud error on your machine. There is no direct FastAPI analogue because
SQLAlchemy makes you manage session scope by hand, which is the same lesson
learned earlier.

---

## Three things most likely to go wrong on Windows

### 1. Docker Desktop is not running

**What you see:**

```
error during connect: ... open //./pipe/dockerDesktopLinuxEngine:
The system cannot find the file specified.
```

Or `docker: command not found` if it was never installed. The giveaway is the
word `pipe` in the message, which is the Windows named pipe Docker Desktop
listens on.

**Fix:** launch Docker Desktop, wait for the whale icon in the system tray to
stop animating, then retry. On a fresh install it may also ask you to enable
WSL2 and reboot.

### 2. Port 5433 is already taken

**What you see, from `docker compose up`:**

```
Error response from daemon: Ports are not available: exposing port
TCP 0.0.0.0:5433 -> 0.0.0.0:0: listen tcp 0.0.0.0:5433: bind:
An attempt was made to access a socket in a way forbidden by its access permissions.
```

That "forbidden by its access permissions" wording is Windows specific and
misleading. It usually does not mean permissions, it means something already
holds the port, often Hyper-V having reserved a range.

**Find the culprit:**

```powershell
netstat -ano | findstr :5433
```

The last column is the process ID. Look it up in Task Manager's Details tab.

**Fix:** stop that process, or change the port. To change it, edit the host
side in `docker-compose.yml` (`"5434:5432"`) and the port in
`application.yml`'s `datasource.url` to match. Both, or the app will look in
the wrong place.

### 3. JAVA_HOME missing, or pointing at the wrong JDK

**What you see, from `.\mvnw.cmd`:**

```
Error: JAVA_HOME not found in your environment.
Please set the JAVA_HOME variable in your environment to match the
location of your Java installation.
```

Or, if it points at a JDK 17:

```
[ERROR] Fatal error compiling: error: invalid target release: 21
```

The second one is the confusing one. The build is not wrong, your `JAVA_HOME`
is simply older than the `<java.version>21</java.version>` in `pom.xml`.

**Check what you have:**

```powershell
echo $env:JAVA_HOME
java -version
```

**Fix:** set it to a JDK 21 install, for the current session:

```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.5.11-hotspot"
```

To make it permanent, use System Properties, Environment Variables, and then
**open a new terminal**, because an existing one keeps the old value. If VS
Code was open when you changed it, restart VS Code too, it inherits the
environment from whenever it launched.

A fourth one, worth knowing: if git ever converts `mvnw` (the Unix script) to
CRLF line endings, WSL and Docker builds fail with
`/usr/bin/env: 'sh\r': No such file or directory`. You are running `mvnw.cmd`
on Windows so it will not bite you locally, but a `.gitattributes` marking
`mvnw` as `eol=lf` is worth adding before anyone builds this on Linux.

---

## Stopping and resetting

**Stop the app:** `Ctrl+C` in the terminal running `spring-boot:run`.

**Stop Postgres, keep the data:**

```powershell
docker compose down
```

**Full reset, delete everything including the data.** This is what you want
when a migration is half applied, or you edited `V1__init.sql` and Flyway now
refuses to start:

```powershell
docker compose down -v
docker compose up -d
```

The `-v` removes the named volume. The next `up` starts an empty database,
Postgres re-runs its initialisation with the credentials from
`docker-compose.yml`, and the next app start replays every migration from
scratch.

**Verify the reset actually happened:**

```powershell
docker volume ls | findstr verification
```

Should print nothing after `down -v`.

If you ever want to poke at the database directly:

```powershell
docker exec -it verification-postgres psql -U verification -d verification
```

`\dt` lists tables, `\dx` lists extensions, `\q` quits.
