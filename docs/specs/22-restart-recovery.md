# Spec 22: Daemon restart recovery guard

Status: Accepted — MVP implementation in progress.

## Goal

Make daemon restart behavior explicit and fail-safe. A process restart can leave a
model call, tool process, sandbox, or approval wait in an unknown state. VibeGo
must never infer that an interrupted write succeeded and must never resume it
without a new user-confirmed run.

## Scope

- `EventStore` exposes a read-only `listRunIds()` query for recovery scans.
- `RunManager.recoverAfterRestart()` scans durable events before the daemon
  starts accepting requests.
- Every run whose latest status is non-terminal is marked `needs-recovery` once.
- Recovery writes a status transition and a `run.needs_recovery` audit event with
  only run id, previous status, reason, and a fresh correlation id.
- Terminal and already-recovered runs are unchanged; repeated recovery calls are
  idempotent.
- The in-memory approval broker is intentionally not restored. Pending approvals
  are discarded on restart, and their unknown operation is covered by the
  recovery marker.

## Non-goals

- No automatic model/tool/sandbox retry.
- No persistence of raw tool arguments, environment values, paths, tokens, or
  approval payloads.
- No retry or discard API in this spec; a later spec will define explicit user
  confirmation and creation of a new run.

## Contract

```ts
interface EventStore {
  listRunIds(): readonly string[];
}

interface RecoveryPayload {
  previousStatus: RunStatus;
  reason: 'daemon-restarted';
}
```

The scan is performed before `server.listen`. If recovery persistence fails,
daemon startup fails closed and the event store is closed; the HTTP surface is
not exposed with an ambiguous run state.

## Acceptance tests

- In-memory and SQLite stores enumerate distinct run ids.
- A non-terminal run is marked once and its snapshot is `needs-recovery`.
- Terminal and already-recovered runs are not appended again.
- Repeating recovery produces no duplicate marker.
- Recovery payload contains no raw arguments or secret-shaped fields.
- The daemon entry point awaits recovery before listening.
