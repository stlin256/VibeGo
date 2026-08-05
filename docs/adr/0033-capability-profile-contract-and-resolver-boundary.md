# ADR 0033: Versioned capability profiles and pure resolution

- Status: Accepted for Spec 52-R1 contract slice
- Date: 2026-08-05
- Related: [Spec 52](../specs/52-capability-profiles-and-first-run-experience.md),
  [Spec 25](../specs/25-configuration-onboarding.md),
  [ADR 0016](0016-clean-room-harness-productionization.md),
  [ADR 0017](0017-policy-compiler-and-bounded-approval.md)

## Context

The existing run profile is a user-facing Web preference, while the daemon
owns approval, sandbox, scheduling, workspace and transport authority. Spec 52
needs one small, versioned intent contract that can be validated before any
runtime is selected. It must be safe to persist as non-secret metadata and
must not become a second policy or execution engine.

## Decision

1. Add a strict `capability-profile/v1` Zod contract in
   `@ready4vibe/contracts`. The stable profile ids are `preview`,
   `workspace-coding`, `advanced-local` and `custom`.
2. Keep transport separate from authority. `loopback`, `lan-tls`,
   `tailscale` and `ssh` identify a connection path only; the profile cannot
   grant public exposure or bypass pairing/TLS/Origin/CSRF checks.
3. Represent every capability as a narrow enum and keep the server
   `policyRevision` and `updatedAt` in the snapshot. Unknown fields,
   secret-shaped keys/values, environment maps, shell fragments, absolute
   paths and unbounded text are rejected.
4. A profile is a request/intent, not an authorization decision. The later
   `CapabilityProfileResolver` is a pure function over the validated profile,
   server capabilities, workspace status, policy revision and health evidence.
   It can narrow a request and return a stable reason code, never widen an
   authority or execute a model/tool/process/network call.
5. The R1 contract/resolver slice is below the application boundary. It does
   not change `RunManager`, `AgentLoop`, Scheduler, Approval, Sandbox,
   WorkspaceRegistry, `run_events`, `goal_events` or default run creation.
   Runtime wiring and Goal-governed admission require their own later gates.

## Consequences

- Web and future clients can share one bounded shape without receiving host
  paths, credentials or raw capability advertisements.
- Profile changes can be snapshotted for a future run while an active run
  remains unchanged.
- A pure resolver is deterministic and cheap to test, but it cannot claim
  that a provider or sandbox is healthy without injected evidence.
- The contract intentionally does not model arbitrary tool arguments,
  environment values, filesystem roots, API keys or private keys.

## Rejected alternatives

- Reusing `RunConfig` as a capability profile: rejected because it mixes user
  message/run limits with server capability intent and would encourage Web to
  decide authorization.
- Persisting a JSON policy blob or raw tool list: rejected because it widens
  the secret/path boundary and makes revisions non-deterministic.
- Letting a profile select `allow everything`: rejected; Approval, Sandbox and
  Scheduler remain independent fail-closed authorities.

## Implementation evidence (2026-08-05)

`packages/contracts/src/capability-profile.ts` implements the strict
`ready4vibe_capability_profile_v1` schema and parser. The contract tests cover
all four profile ids, unknown fields, secret/path/environment rejection,
timestamp and acknowledgement rules, and external-sandbox references. No
daemon or runtime package imports this contract yet; resolver and application
integration remain later slices.
