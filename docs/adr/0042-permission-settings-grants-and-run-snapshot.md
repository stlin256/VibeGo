# ADR 0042: Durable permission intent, in-memory grants and run snapshots

- Status: Accepted for Spec 59-3
- Date: 2026-08-05
- Related: [Spec 59](../specs/59-permission-profiles-and-low-interruption-approval.md),
  [ADR 0040](0040-permission-profile-and-approval-contracts.md),
  [ADR 0041](0041-permission-profile-execution-plane-adapter.md),
  [ADR 0003](0003-lan-access-and-codex-like-approval.md)

## Context

Spec 59-1/59-2 already define and narrow permission profiles, but they do not
yet provide a daemon-owned settings boundary or a lifecycle for explicit
full-host confirmation. Persisting bearer credentials or grants would make a
SQLite settings snapshot an authority that outlives the authenticated session,
while resolving permissions inside the AgentLoop would allow settings changes
to affect an in-flight run.

## Decision

1. Store only the validated, non-secret profile intent under the existing
   `daemon_settings` adapter (`permission-profile/v1`). Optimistic revision
   checks and safe-default recovery apply exactly as they do for other durable
   settings. A stale policy revision is recovered to a safe workspace profile.
2. Keep confirmation and session grants in a daemon-memory bounded store. Each
   grant is bound to the AuthGate session, the single local user, profile/policy
   revisions, expiry, use count and revoke state. Restart drops the store.
3. Expose authenticated settings, confirmation, revoke and status routes. The
   route obtains the AuthGate session id; request bodies cannot choose a
   different session or user. Responses contain only contract-approved opaque
   identifiers and bounded status metadata.
4. Capture a versioned `PermissionProfileRunSnapshot` in the daemon
   application service before `run.created`. `RunManager` validates and passes
   the immutable snapshot to the existing AgentLoop event metadata and runtime
   narrowing adapter. A later settings/grant/policy change affects only later
   runs.
5. Governed admission accepts the same optional snapshot at its final
   `RunManager.start` call, after Goal preflight and reservation. The snapshot
   cannot bypass Goal, quota, Scheduler, Approval, Sandbox or Workspace.

## Consequences

- Full-host confirmation is explicit, trusted-session-only, revocable and
  short-lived; no restart-persistent host grant exists.
- The historical unbound RunManager API remains compatible, while the daemon
  HTTP boundary can enforce authenticated session binding for new runs.
- `run_events` remains the event authority; only bounded snapshot metadata is
  added to `run.created`, with no new event table or scheduler.
- A full-host intent remains blocked when no host runner is available. There
  is no external-sandbox or host fallback.

## Rejected alternatives

- Persisting access tokens or grants in `daemon_settings`: violates the secret
  and session-lifecycle boundary.
- Resolving the profile lazily for each tool call: lets settings/revocation
  mutate an in-flight run and makes replay non-deterministic.
- Making `createdBySessionId` from an untrusted request an authorization proof:
  it is normalized/bound to the AuthGate session at the HTTP application
  boundary.

## Implementation evidence

The accepted boundary is implemented in the daemon settings manager, server
application routes and RunManager snapshot seam. Focused tests cover the
versioned contracts, policy/compiler, grant TTL/usage/revoke/restart behavior,
AuthGate session binding, full-host capability-unavailable fail-closed behavior,
snapshot immutability and the explicit governed-route boundary. Web Settings
UI controls remain intentionally out of scope until Spec 59-4.
