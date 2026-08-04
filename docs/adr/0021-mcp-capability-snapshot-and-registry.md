# ADR 0021: Immutable MCP capability snapshots

- Status: accepted and implemented for Spec 49-R2
- Date: 2026-08-04
- Related: [Spec 49](../specs/49-mcp-skill-transport-and-capability-lifecycle.md),
  [ADR 0020](0020-mcp-transport-session-boundary.md),
  [harness contracts](../harness-contracts.md)

## Context

R1 provides a bounded protocol session, but an MCP server's advertised tools
are untrusted input. A live refresh must not replace a tool revision, change an
approval key or mutate a run that has already started. The existing
`ToolRegistry`, `ApprovalPolicy`, `Scheduler`, `Sandbox` and event stores are
already authoritative and must not be duplicated by MCP.

## Decision

1. Add a pure TypeScript capability projection in `@ready4vibe/skill-mcp`.
   It accepts decoded advertisements and a manifest/allowlist snapshot, then
   emits only bounded `McpCapabilityDescriptor` values and an immutable
   `McpCapabilitySnapshot`.
2. Risk, required sandbox/network mode and approval mode come from the
   manifest/application policy. Server-provided descriptions and schemas are
   untrusted and bounded; they cannot grant a stronger capability or weaken a
   denial. Unknown servers, undeclared tools, incompatible protocol/schema,
   duplicate revisions and stale health fail closed.
3. The in-memory registry stores at most the current verified snapshot per
   server and uses a monotonic health `checkId`. Revisions are replaced only by
   an explicit new snapshot. `captureRunSnapshot()` deep-freezes a copy and
   returns its deterministic fingerprint, so refreshes cannot affect an
   in-flight run.
4. R2 does not open `McpChannel`, call `McpProtocolSession`, register the
   existing `ToolRegistry`, acquire a Scheduler lease, invoke Approval/Sandbox,
   alter `run_events`/`goal_events`, or change AgentLoop/RunManager behavior.
   Integration is deferred to R3/R4 application slices.

## Consequences

- Capability failures are bounded, deterministic and safe to render as a
  degraded status card.
- The same snapshot contract can later be consumed by ToolExecutor without
  allowing dynamic server refresh to bypass approval or sandbox checks.
- Resources and prompts may be represented as read-only descriptors, but no
  descriptor becomes executable until a later explicit integration decision.

## R2 implementation record

The pure registry and its fake-advertisement fixtures are implemented in
`@ready4vibe/skill-mcp`. The 27-test focused suite covers server/tool
allowlists, protocol/schema/secret/path bounds, manifest-owned risk and
network/approval defaults, duplicate and revision conflicts, monotonic health
checks, resource/prompt read-only projection and run snapshot immutability.
The implementation has no channel/process/network side effect.

## Rejected alternatives

- Treating the server's `tools/list` response as a second ToolRegistry.
- Mutating descriptors in place when a server changes a revision.
- Trusting server-supplied risk/approval fields or storing raw capability JSON.
- Performing a network probe or starting a stdio process from the pure registry.
