# ADR 0029: Read-only SQLite restore preflight

- Status: Accepted for Spec 53 Phase 4 storage slice
- Date: 2026-08-05

## Decision

Add a read-only `SqliteRestorePreflightAdapter` in `@ready4vibe/storage`. It
parses `backup-manifest/v1`, verifies the snapshot size and streaming digest,
runs SQLite integrity/schema probes, compares the source schema with the target
schema, and returns the existing `RestorePlan` contract.

The result always requires explicit confirmation and preserves the current
database. A newer target schema may produce `requires-migration`; a target
older than the snapshot produces `blocked` because downgrade migration is not
supported. No plan contains a local path, credential, workspace file or raw
database payload.

## Rationale

Separating preflight from restore keeps migration and data-pointer switching
behind a later, explicitly authorized service. The user can review bounded
compatibility warnings before any write occurs, and an interrupted or malformed
import cannot replace `current` merely by being readable.

## Rejected alternatives

- Restoring while validating: rejected because a failed integrity/schema check
  must not alter current data.
- Trusting the manifest digest without reading the file: rejected because the
  manifest can be stale or tampered with.
- Treating a higher target schema as a downgrade-compatible import: rejected
  because migrations are versioned and must be run in a later staging flow.
- Returning snapshot/current paths in the plan: rejected because paths are
  host-internal data and a Web disclosure risk.

## Non-goals for Phase 4

No archive extraction, workspace mapping, credential import, SQLite copy,
migration execution, atomic data-pointer switch, restore result write, Web
route, installer/updater or event-store integration is implemented.

## Implementation evidence

The adapter is implemented in `packages/storage/src/restore-preflight.ts` with
fixtures for compatible, migration-required, blocked, digest/schema/integrity
failure and current-preservation paths. Existing storage authorities remain
unchanged.
