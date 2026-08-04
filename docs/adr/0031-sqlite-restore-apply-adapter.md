# ADR 0031: Explicit SQLite restore apply adapter

- Status: Accepted for Spec 53 Phase 6 storage/application boundary
- Date: 2026-08-05

## Decision

Add a `SqliteRestoreApplyAdapter` that applies only a compatible, staged
SQLite restore after a versioned `RestoreApplyConfirmation` explicitly approves
the exact `RestorePlan`.

Before any switch it rechecks the staged candidate and current database using
the Phase 4 preflight. It creates a new immutable previous file without
overwriting an existing previous target, prepares a verified current candidate,
and performs a guarded current swap. If the swap fails, it restores the old
current path and removes newly created evidence. A successful operation returns
the existing bounded `RestoreResult` in memory; no result or path is persisted
by this adapter.

## Rationale

Restore is a destructive host operation and cannot be inferred from a readable
snapshot or a model response. Matching confirmation to a specific plan keeps
the user intent explicit, while previous preservation and rollback make a
failed filesystem operation recoverable without a second event authority.

## Rejected alternatives

- Applying every `compatible` preflight automatically: rejected because
  compatibility is not user approval.
- Replacing current in place: rejected because a failed copy could destroy the
  only usable database.
- Reusing an existing previous file: rejected because it would erase recovery
  evidence from an earlier operation.
- Recording restore state in `run_events`/`goal_events`: rejected because host
  recovery has its own contracts and must not contaminate run/Goal authority.

## Non-goals for Phase 6

No migration execution, workspace mapping, credential/file import, Web/daemon
route, installer/updater, safe-mode transition or event-store persistence is
implemented.

## Implementation evidence

The confirmation contract lives in `packages/contracts/src/host-recovery.ts`
with 2 focused tests. The storage adapter and 9 swap/rollback fixtures live in
`packages/storage/src/restore-apply.ts` and `restore-apply.test.ts`; the
contracts module passes 65 tests and the storage module passes 66 tests plus
typecheck/build. Existing run, Goal, Scheduler, Approval, Sandbox and
WorkspaceRegistry authorities remain unchanged.
