# Architecture

Status: placeholder. Filled in as each phase lands.
The authoritative design decisions live in `/CLAUDE.md` until this file catches up.

## System context

<!-- TODO: replace with the real diagram once phase 5 defines the async boundary. -->

```mermaid
flowchart LR
    Practitioner[Practitioner portal] --> API
    Reviewer[Review console] --> API
    Public[Public lookup] --> API
    Platform[HerbImmortal platform] --> API

    API[Spring Boot API] --> DB[(PostgreSQL)]
    API --> S3[(Object storage)]
    Registry[External registry] -->|batch sync| API
```

## Request path

<!-- TODO: expand once the async executor is wired in phase 9. -->

```mermaid
sequenceDiagram
    participant C as Client
    participant Ctl as Controller
    participant Svc as Service layer
    participant DB as Postgres

    C->>Ctl: POST /api/v1/verifications
    Ctl->>Svc: IntakeService.submit
    Svc->>DB: insert case SUBMITTED
    Ctl-->>C: 202 Accepted + caseId
    Note over Svc: matching, rules, decision run off the request thread
```

## Layering rules

- Controllers do HTTP only. No business logic, no repository calls.
- Services own all verification logic, so the HTTP path, the scheduled job, and
  any bulk import share one implementation.
- Rules never touch the database. They receive a `VerificationContext` and
  return a `RuleResult`, which is what makes them unit testable without Spring.
- Only Flyway changes the schema. Hibernate `ddl-auto` is `none`, permanently.

## Data model

<!-- TODO: entity relationship diagram once the phase 2 to 4 migrations exist. -->
