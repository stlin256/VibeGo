# ADR 0040: Versioned permission profiles and low-interruption approval contracts

- Status: accepted for Spec 59-1
- Date: 2026-08-05
- Related: [Spec 59](../specs/59-permission-profiles-and-low-interruption-approval.md),
  [Spec 48](../specs/48-approval-sandbox-shell-runtime.md),
  [Spec 52](../specs/52-capability-profiles-and-first-run-experience.md),
  [ADR 0033](0033-capability-profile-contract-and-resolver-boundary.md),
  [ADR 0035](0035-capability-profile-run-snapshot.md)

## Context

Spec 52 already describes coarse capability profiles and immutable run
snapshots. Spec 59 needs a separate permission/approval vocabulary for the
user-facing distinction between workspace-scoped low-interruption coding and
explicit trusted-session `full-host`. Combining the two contracts would make a
UI toggle look like an execution grant and would make legacy settings migration
ambiguous.

## Decision

1. Add a strict `permission-profile/v1` contract package boundary with intent,
   resolution and settings DTOs. It describes requested scope only; the
   existing server policy, Scheduler, ApprovalBroker, SandboxResolver,
   WorkspaceRegistry and Goal admission remain the authorities that can deny
   or narrow it.
2. Model `workspace-coding`, `full-host` and `custom` profiles separately from
   the existing capability profile. `workspace-coding` is the safe factory
   default. `full-host` requires trusted task context and an explicit
   confirmation; it never enables network, LAN, Tailscale, SSH, MCP or Skill by
   implication.
3. Model approval posture as bounded metadata. `bounded-auto` matches only an
   exact approval key; `session-auto` requires a host-capable trusted scope and
   is bounded by TTL, maximum uses, policy revision and revocation. Neither
   posture bypasses managed deny rules or Goal/Scheduler/Sandbox authorities.
4. Keep session grants, confirmations and revoke/status DTOs secret-free. They
   contain opaque IDs, bounded scope, revisions, timestamps, usage/expiry state,
   bounded reason codes and audit references only. Tokens, credentials, paths,
   commands, environment values, transcripts and raw tool arguments are out of
   contract.
5. Provide a safe-default factory for legacy settings migration. Invalid or
   secret-shaped legacy values are not silently parsed as permissions; later
   application code must fail closed and record the migration to the safe
   workspace-coding profile.

## Consequences

- Contract tests can prove full-host confirmation/trust invariants before any
  policy or runtime wiring exists.
- Later daemon settings and run snapshot slices can consume stable DTOs without
  changing AgentLoop or adding a second approval/scheduler implementation.
- The contract deliberately cannot prove that a host runner is safe or
  available; those decisions remain later 59-2/59-5 evidence.

## Rejected alternatives

- Do not extend `CapabilityProfileSchema` with host grants and session tokens;
  capability snapshots and permission grants have different lifecycles.
- Do not use a boolean `autoApprove` or `fullHost` flag; it cannot express
  exact-key matching, trust, expiry, revocation or policy revisions.
- Do not accept arbitrary legacy JSON and silently downgrade it. A safe default
  is explicit and bounded, while malformed input remains a fail-closed error.
