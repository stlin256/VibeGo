# ADR 0027: Backup, restore and recovery contract boundary

- Status: Accepted for Spec 53 Phase 2 contract slice
- Date: 2026-08-05

## Decision

Define strict, metadata-only contracts for `backup-manifest/v1`, restore plans,
restore results, recovery status and redacted diagnostic bundle descriptors in
`@ready4vibe/contracts`. The contracts describe what a future Host backup or
recovery service may do; they do not open SQLite, copy files, read credentials,
start safe mode, or switch a data pointer.

Backups identify logical data classes and content digests rather than local
paths. Restore plans require explicit user confirmation, keep the existing
current state recoverable, and never import credentials or workspace files.
Recovery status exposes only bounded reason codes and allowed operations; a
safe-mode projection is limited to health, settings, backup, restore,
diagnostic and read-only event viewing.

## Rationale

Keeping backup/recovery metadata separate from `run_events`, `goal_events` and
the existing host update state prevents a future installer or recovery wizard
from becoming a second execution authority. A pure contract slice is cheap to
replay offline and makes privacy failures visible before any filesystem or
SQLite adapter is introduced.

## Rejected alternatives

- Storing absolute database/workspace paths in a manifest: rejected because
  manifests can leave the host and become a path disclosure channel.
- Treating a backup as a complete workspace archive: rejected because workspace
  files and credentials have separate ownership and migration rules.
- Allowing restore to replace current state without confirmation: rejected
  because recovery must preserve a rollback point and require user intent.
- Reusing `run_events` for recovery status: rejected because lifecycle and
  retention are different from run execution events.

## Non-goals for Phase 2

No SQLite online backup, encryption implementation, archive writer, import
filesystem, migration engine, installer/updater, Web route or automatic safe
mode transition is implemented by this ADR.

## Implementation evidence

The Phase 2 contract is implemented in
`packages/contracts/src/host-recovery.ts` with focused privacy and state
invariant tests. It does not modify AgentLoop, RunManager, Scheduler, Approval,
Sandbox, WorkspaceRegistry, `run_events` or `goal_events`. The new fixture has
6 tests; the contracts module passes 63 tests, typecheck and build.
