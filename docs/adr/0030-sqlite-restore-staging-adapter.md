# ADR 0030: SQLite restore staging adapter

- Status: Accepted for Spec 53 Phase 5 storage slice
- Date: 2026-08-05

## Decision

Add a storage-only `SqliteRestoreStagingAdapter` that composes the Phase 4
read-only preflight, copies the verified SQLite snapshot into a fresh
caller-controlled staging directory, rechecks the staged file, and commits the
candidate with no-replace semantics.

The adapter returns an internal staging path plus the validated `RestorePlan`;
the path is not a contract field and must not be exposed through Web, events,
logs or diagnostics. The existing current database is opened read-only and is
never copied over, deleted or renamed.

## Rationale

Staging separates an explicit user review plan from a later restore application
service. A failed or interrupted copy can be removed without affecting the
current database, while a second integrity/digest/schema probe prevents a
source change during the copy from becoming a trusted candidate.

## Rejected alternatives

- Copying directly to `current`: rejected because a partial or unreviewed
  candidate could replace the only usable database.
- Reusing a prior candidate: rejected because candidate evidence must be
  immutable and tied to one preflight operation.
- Running migration inside storage: rejected because migration needs an
  application-service approval, version policy and rollback authority.
- Returning only a boolean: rejected because later orchestration needs the
  validated plan and bounded staging metadata without exposing host paths.

## Non-goals for Phase 5

No data-pointer switch, migration, workspace mapping, credential/file import,
`RestoreResult`, safe-mode transition, Web/daemon route, installer/updater or
event-store integration is implemented.

## Implementation evidence

The adapter and 12 failure/invariance fixtures live in
`packages/storage/src/restore-staging.ts` and `restore-staging.test.ts`. The
complete storage module passes 57 tests plus typecheck/build. Existing run,
Goal, Scheduler, Approval, Sandbox and WorkspaceRegistry authorities remain
unchanged.
