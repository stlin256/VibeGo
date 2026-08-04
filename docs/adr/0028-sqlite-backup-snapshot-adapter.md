# ADR 0028: SQLite backup snapshot adapter

- Status: Accepted for Spec 53 Phase 3 storage slice
- Date: 2026-08-05

## Decision

Add a small `@ready4vibe/storage` adapter that creates an explicit SQLite
snapshot with `VACUUM INTO`, validates the source and resulting database with
`PRAGMA integrity_check`, reads the bounded `user_version`, computes a SHA-256
digest and emits the existing `backup-manifest/v1` contract.

The adapter writes only to a caller-provided staging directory, refuses to
overwrite an existing destination, uses a temporary file followed by an atomic
no-replace link commit, and removes the temporary file on failure. The returned absolute
snapshot path is an internal storage result; the manifest contains only logical
data-class metadata and never exposes a path, credential, workspace file or
raw database payload.

## Rationale

SQLite's online-consistent `VACUUM INTO` path is available in the bundled Node
runtime and avoids adding a native backup dependency. Keeping the operation in
`packages/storage` makes it independently testable and prevents a future Web
route or installer from becoming a second backup authority. A bounded output
size and streaming digest keep memory usage low for large local databases.

## Rejected alternatives

- Copying the `.sqlite` file directly: rejected because WAL state may not be
  represented consistently.
- Loading the entire database into a JavaScript buffer: rejected because it
  increases peak RSS and offers no integrity guarantee.
- Overwriting a prior snapshot: rejected because backup evidence must remain
  immutable and recoverable.
- Returning the snapshot path through a Web/contract response: rejected because
  local paths are host-internal data and a disclosure risk.

## Non-goals for Phase 3

No encrypted archive format, workspace-file backup, credential export, restore
switch, migration, installer/updater, daemon route, scheduler, run event or
Goal event integration is implemented.

## Implementation evidence

The adapter is implemented in `packages/storage/src/backup.ts` with deterministic
fixtures for successful snapshots, integrity/schema failures, size bounds,
destination immutability and cleanup. Existing EventStore, settings, Goal and
observability authorities remain unchanged. The snapshot fixture has 4 tests;
the complete storage module has 35 passing tests plus typecheck and build.
