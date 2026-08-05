# ADR 0034: Durable capability-profile settings and resolver projection

- Status: Accepted for the Spec 52 R2/R3a application-settings slice
- Date: 2026-08-05
- Related: [Spec 52](../specs/52-capability-profiles-and-first-run-experience.md),
  [ADR 0033](0033-capability-profile-contract-and-resolver-boundary.md),
  [ADR 0005](0005-durable-daemon-settings-boundary.md)

## Context

The strict capability-profile contract and pure resolver are useful only when
the daemon can safely retain a user's bounded intent and show why the server
accepted, narrowed or blocked it. Existing settings already provide a small
SQLite/in-memory snapshot boundary, while the daemon owns transport,
workspace, model, filesystem, sandbox and MCP health evidence. The browser
must not become an authorization engine or persist secrets.

## Decision

1. Persist a versioned `CapabilityProfileSettings` snapshot under the existing
   `daemon_settings` store. It contains only the validated profile, a bounded
   monotonic `profileRevision` and update metadata; it never contains API keys,
   private keys, environment values, absolute paths, raw tool arguments or
   runtime responses.
2. Expose an authenticated `GET/PATCH /api/v1/settings/capability-profile`
   route and an explicit `POST /api/v1/settings/capability-profile/reset`
   action. PATCH requires the complete validated profile and an optional
   `expectedRevision`; a mismatch returns a stable conflict and leaves the
   stored snapshot unchanged. Reset writes the safe `preview` intent and
   preserves all run/Goal history.
3. The daemon application service builds `CapabilityProfilePolicy` from
   existing authorities and passes it to the pure resolver. The response
   includes requested/effective profiles, `ready|degraded|blocked` status and
   a stable reason code. The response is a projection, not an approval grant.
4. A disabled profile or unavailable optional runtime produces a bounded
   `degraded`/`blocked` projection and zero new provider/process/network work.
   No route starts a runtime or mutates Scheduler, Approval, Sandbox,
   WorkspaceRegistry, AgentLoop, `run_events` or `goal_events`.
5. Run snapshot binding is intentionally deferred to the next independently
   tested slice. Until then, the existing unbound interactive run path is
   byte-for-byte behaviorally unchanged.

## Consequences

- First-run and Settings UI can be driven by one authenticated, restart-safe
  status projection without exposing daemon paths or credentials.
- Optimistic revision checks make stale browser tabs fail closed and avoid
  silently overwriting a newer profile.
- Health evidence remains injectable and testable; the settings manager does
  not discover the filesystem, spawn a process or call a model itself.
- A profile can be stored successfully while its effective projection is
  degraded, which is preferable to fabricating readiness or returning a Web
  500 for an optional capability.

## Rejected alternatives

- Browser-only localStorage authority: rejected because it can be stale and
  cannot enforce daemon-owned transport/runtime policy.
- Reusing `RunConfig` as the durable settings record: rejected because it
  mixes user message/limits with capability intent and would alter the default
  run contract before snapshot integration is tested.
- Starting or probing all runtimes on PATCH: rejected because settings writes
  must remain low-resource and side-effect free; explicit probes belong to the
  existing per-runtime settings services.

## Implementation evidence (2026-08-05)

`packages/contracts/src/capability-profile-settings.ts` adds strict settings,
patch and status DTOs and the resolver projection now shares the versioned
contract reason/status enums. `apps/daemon/src/capability-profile-settings.ts`
persists the default `preview` snapshot, recovers a stale policy to preview,
uses `profile-N` optimistic revisions and exposes only bounded status metadata.
`apps/daemon/src/server.ts` adds authenticated GET/PATCH/reset routes while
`apps/daemon/src/main.ts` derives policy evidence from the existing transport,
workspace, model, filesystem, sandbox and MCP managers. Contract, manager and
server fixtures cover strict privacy, restart, stale/concurrent updates,
resolver narrowing, reset history and the existing LAN authentication gate.
No default run or execution authority was changed.

The follow-up R2 Web card consumes this status DTO through the existing
conversation-first Settings Sheet. It is a presentation and intent-editing
surface only; the daemon remains the sole resolver and the card cannot widen
an effective profile.
