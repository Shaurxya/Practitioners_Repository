# 1. Record architecture decisions

Date: 2026-07-30

## Status

Accepted

## Context

This system makes decisions that are expensive to reverse later: the Immortal ID
format is permanent once issued, the audit log shape constrains what we can
prove, and the status machine constrains what the review console can do.

Six months from now the reasoning behind those choices will be gone unless it is
written down somewhere durable. Commit messages are too granular, and the code
records what was decided but not what was rejected.

## Decision

Record every architecturally significant decision as a numbered Markdown file in
`docs/adr/`, following Michael Nygard's format: Context, Decision, Consequences.

A decision is architecturally significant when reversing it would require a data
migration, an API version bump, or coordinated changes across the backend and
frontend at once.

ADRs are immutable once accepted. A decision that changes gets a new ADR that
supersedes the old one, and the old one is marked Superseded with a link. The
history is the point.

## Consequences

- New contributors can read `docs/adr/` in order and understand why the system
  looks the way it does.
- There is a small cost per decision, which is why the bar is "significant" and
  not "any choice at all".
- The open decisions currently tracked as `D1` to `D5` in `/CLAUDE.md` become
  ADRs 0002 onwards as they are resolved.
