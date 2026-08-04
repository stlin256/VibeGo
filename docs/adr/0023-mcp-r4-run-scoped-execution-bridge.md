# ADR 0023: MCP R4 run-scoped execution bridge

- Status: accepted for implementation
- Date: 2026-08-04
- Related: [Spec 49](../specs/49-mcp-skill-transport-and-capability-lifecycle.md),
  [ADR 0021](0021-mcp-capability-snapshot-and-registry.md),
  [ADR 0022](0022-mcp-r3-settings-and-status-boundary.md),
  [harness contracts](../harness-contracts.md)

## Context

Transport/session and capability projection are available, and R3 exposes a
non-secret settings/status slice. R4 must make an explicitly activated MCP
tool usable without introducing another tool registry, approval mechanism,
scheduler, sandbox or durable event fact source. Remote calls also need a
clear replay boundary because an interrupted run can later be marked
`needs-recovery`.

## Decision

1. Capture an immutable `McpCapabilitySnapshot` at run creation. Only
   `kind=tool`, `executable=true`, allowlisted and `healthy-verified`
   descriptors are eligible. Resources and prompts remain read-only
   projections.
2. Bind eligible descriptors to the existing `ToolRegistry` and invoke them
   through `ToolExecutorRuntime`/`ToolExecutor`. The existing ApprovalPolicy,
   approval broker, Scheduler lease, SandboxResolver and WorkspaceRegistry are
   authoritative.
3. Inject an `McpToolCallPort` backed by the verified protocol session. The
   port receives the run AbortSignal and bounded request/response budgets and
   maps all remote failures to stable, secret-free error codes.
4. Keep a bounded in-memory `McpExecutionLedger` for the lifetime of a run.
   The key includes run, turn, call, descriptor revision and canonical input
   fingerprint. Matching completed/in-flight calls are shared/no-op; a
   mismatched payload or revision is rejected. Recovery never resumes an
   unknown in-flight call; `RunManager.retryRecovered` creates a new run.
5. Reuse existing bounded `run_events` records. MCP metadata is limited to
   ids, revision, risk, attempt, byte counts, safe error codes and truncated
   output. URL, command, argv, headers, environment values, absolute paths,
   raw protocol bodies and secrets are excluded.
6. Keep the daemon's default composition unchanged. R4 wiring is opt-in via an
   injected run-scoped binding; disabled or degraded settings omit the MCP
   runtime and never block ordinary conversation runs.
7. Gate activation through a daemon `McpLiveActivationService` provider port.
   The provider may own runtime credentials and transport sessions, but the
   service accepts only a matching server/manifest revision, an allowlisted
   healthy-verified snapshot and a call port. Candidate failure deactivates
   the binding and records bounded degraded status; it never starts a default
   process or performs a fallback network call.

## Consequences

- Built-in and MCP tools share approval, sandbox, scheduling and cancellation
  behavior, so policy changes have one enforcement point.
- A run snapshot is stable even if capability health or settings refreshes
  while it is executing.
- In-memory idempotency prevents duplicate calls during approval continuation
  and within-run retries; crash recovery is fail-closed and cannot replay an
  old remote request automatically.
- A later durable provider can replace the ledger only after an explicit
  contract review; no MCP event table is introduced in R4.
- Transport implementations can be added behind one provider port without
  changing Web settings, RunManager, AgentLoop or the execution boundary.

## Rejected alternatives

- Calling `McpTransportClient` directly from AgentLoop or a route.
- Registering MCP tools beside `ToolRegistry` or bypassing `ToolExecutor`.
- Treating resources/prompts as arbitrary executable tools.
- Retrying a failed remote call by default or restoring a pre-crash in-flight
  request from an untrusted transcript.
- Persisting raw MCP request/response bodies, endpoint credentials or paths.
