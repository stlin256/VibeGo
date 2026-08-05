# ADR 0035: Capability profile run snapshots at the daemon application boundary

- Status: Accepted for Spec 52-R3 implementation
- Date: 2026-08-05
- Related: [Spec 52](../specs/52-capability-profiles-and-first-run-experience.md),
  [ADR 0033](0033-capability-profile-contract-and-resolver-boundary.md),
  [ADR 0034](0034-capability-profile-settings-and-resolution-projection.md),
  [ADR 0017](0017-policy-compiler-and-bounded-approval.md)

## Context

Spec 52 already persists a validated capability intent and exposes the daemon
resolver projection. That projection is not useful for execution safety until
a run records which decision it started with. Conversely, changing the
profile must not mutate an in-flight run or create a second authorization
engine. The existing `AgentLoop`, `RunManager`, Scheduler, Approval, Sandbox,
WorkspaceRegistry and `run_events` authorities are already the execution
boundary and must remain authoritative.

## Decision

1. Add a strict `ready4vibe_capability_profile_run_snapshot_v1` contract. It
   stores bounded requested/effective profile metadata, status/reason,
   `profileRevision`, `policyRevision` and `capturedAt`. The effective profile
   is nullable only for a blocked decision. All profile ids remain opaque; no
   absolute path, secret, environment value, tool input or provider response is
   admitted.
2. Inject an optional capability-profile snapshot provider into `RunManager`.
   When present, `start` allocates the run id, captures one snapshot, rejects a
   blocked decision before model/tool/sandbox/provider work, and passes the
   immutable snapshot to `AgentLoop` for `run.created` metadata. When absent,
   the old unbound interactive behavior is unchanged.
3. The snapshot is not an approval grant and cannot widen a resolver result.
   Existing runtime adapters still enforce their own config, policy, sandbox,
   scheduler and approval checks. A degraded result can only describe the
   resolver's narrowed effective profile; it cannot select host fallback.
4. A retry/recovery path calls normal `start` and captures a fresh snapshot.
   No old capability decision, provider binding or in-flight tool request is
   replayed.
5. The snapshot is read back from `run.created` as bounded metadata in the
   existing `RunSnapshot` projection. No change is made to `run_events` schema,
   Goal events, AgentLoop transitions or default Scheduler behavior.

## Rejected alternatives

- Putting the profile into `RunConfig`: rejected because it would expose a
  server authorization decision to the browser and alter the stable public run
  contract.
- Letting the browser resolve or cache effective permissions: rejected because
  stale tabs cannot enforce daemon policy and may widen a request.
- Re-evaluating the profile on every turn: rejected because an in-flight run
  must remain deterministic and isolated from settings changes.
- Treating `degraded` as permission to use the host: rejected because sandbox
  failure must remain fail-closed.

## Test boundary

The R3 slice must cover strict/privacy validation, ready/degraded/blocked
capture, blocked zero-side-effect behavior, settings-change isolation,
metadata projection, compatibility without an injected provider and fresh
recovery snapshots. It must not add Goal admission, a second scheduler or a
new approval/sandbox authority.

## Implementation evidence (2026-08-05)

`CapabilityProfileRunSnapshotSchema` is implemented in
`packages/contracts/src/capability-profile-run.ts`. The daemon settings
manager captures a bounded snapshot and marks a profile/workspace mismatch as
blocked. `RunManager` captures it before provider binding, rejects blocked or
config-incompatible requests, and forwards it as `run.created` metadata; the
existing `RunSnapshot` projection replays it without changing event storage.
The main daemon applies a narrow descriptor filter to filesystem, shell and
MCP runtimes. Focused tests cover strict privacy, ready/degraded/blocked
states, zero side effects, settings isolation, recovery freshness and the
compatibility path without a profile provider. Goal admission and all existing
execution authorities remain unchanged.
