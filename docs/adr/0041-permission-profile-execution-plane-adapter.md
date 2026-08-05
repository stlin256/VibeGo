# ADR 0041: Permission profile execution-plane adapter

- Status: Accepted for Spec 59-2
- Date: 2026-08-05
- Decision owners: ready4vibe daemon/policy/sandbox maintainers

## Context

Spec 59-1 introduced strict permission-profile and approval contracts. The
existing policy compiler, `ApprovalPolicy`, `SandboxResolver`, `ToolExecutor`,
`Scheduler` and `ApprovalBroker` remain the execution authorities. Wiring a
second approval or executor would create competing authority and break the
existing fail-closed behavior.

## Decision

Implement a small, pure adapter at the policy/sandbox boundaries and an opt-in
daemon runtime narrowing wrapper:

1. Resolve a profile only after validating workspace/trust/revision/sandbox
   compatibility. The result can narrow capabilities or return blocked; it
   cannot grant host, network, MCP/Skill or process access that the run config
   and server policy did not already request.
2. Delegate sandbox availability and full-host confirmation to the existing
   `SandboxResolver`. External-sandbox health failures and untrusted host
   requests fail closed, with no host fallback.
3. Filter an already-authorized `ToolRuntime` by permission families. The
   wrapper delegates execution, approval and lifecycle to the existing runtime
   and does not touch AgentLoop, Scheduler, event stores or run creation.
4. Keep the adapter opt-in until Spec 59-3 supplies durable settings,
   confirmation/revoke application services and an immutable run snapshot.

## Consequences

- Existing interactive runs remain unchanged when no permission binding is
  supplied.
- `workspace-coding`, `full-host` and `session-auto` have one tested narrowing
  path for the later daemon settings/snapshot slice.
- Full-host is represented and checked, but no host runner is introduced by
  this ADR. A runtime that cannot provide host capabilities remains unavailable.
- No new scheduler, approval store, event stream or side effect is introduced.

## Rejected alternatives

- A second approval cache or scheduler: creates competing authority and makes
  revocation/revision boundaries ambiguous.
- Mutating `RunConfig` globally: would make settings changes affect in-flight
  runs and would risk widening the historical interactive route.
- Treating full-host as an external-sandbox fallback: violates explicit
  confirmation and untrusted-content requirements.
