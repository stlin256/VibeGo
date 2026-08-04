# Spec 49: MCP/Skill transport and capability lifecycle

- Status: planned (49-R0 research gate)
- Date: 2026-08-04
- Related: [harness contracts](../harness-contracts.md), [Spec 19](19-mcp-transport-boundary.md), [Spec 20](20-tool-executor-runtime.md), [Spec 42](42-shadcn-style-web-design-system.md), [upstream harness research](../research/upstream-harness-implementations.md)

## Goal

Move from manifest/one-shot MCP contracts to real, optional MCP and Skill
connections while keeping all external capabilities behind the ready4vibe
ToolRegistry, ApprovalPolicy, Scheduler and Sandbox boundaries. A broken or
slow integration must degrade to a status card; it must not turn the daemon,
ordinary conversation or interactive run into a 500 or an implicit privilege
grant.

## Current baseline and gap

- Skill manifest validation, MCP JSON-RPC channel contracts and bounded
  retrieval adapters exist.
- The daemon does not automatically start an MCP subprocess or connect to a
  remote server on startup.
- Capability health, activation snapshots, cancellation and real stdio/
  Streamable HTTP smoke tests remain to be completed.

## Research gate (49-R0)

Read the pinned MCP TypeScript SDK transport/auth/session files and the
OpenHands/Continue health and configuration tests listed in the research
report. The SDK's licensing transition requires file-level provenance before
any code reuse. The implementation must use public protocol/API boundaries or
clean-room TypeScript, not private module paths or copied server code.

## Contract and lifecycle

### Manifest and identity

Every Skill/MCP server is configured through a versioned, bounded manifest:

- stable server/skill id and revision;
- transport kind (`stdio` or `streamable-http`), explicit executable/URL
  policy, auth reference and capability request;
- tool/resource/prompt allowlists and maximum schema/response sizes;
- sandbox, network, Scheduler and approval requirements;
- health state and last error code, never raw credentials or absolute host paths.

Identity is explicit (`teamId`, `agentId`, `userId`, optional session id for
memory integrations); it must never be inferred from a prompt or tool output.

### Transport boundary

The MCP client owns framing, request ids, protocol version, auth handshake,
progress, cancellation, timeout and disconnect mapping. It does not authorize a
tool or execute it. Stdio uses an exact argv/env allowlist and a dedicated child
process boundary. Streamable HTTP uses an explicit URL/path contract, bounded
headers, origin/auth checks and an abortable request. Neither transport
inherits all daemon environment variables or secrets.

### Capability snapshot

The server advertises tools/resources/prompts into a temporary registry. Before
activation, the application validates:

1. schema version and bounded description/schema/response size;
2. name collision and immutable tool revision;
3. capability-to-risk classification and required sandbox/network;
4. user-configured allowlist and approval mode;
5. server health and protocol compatibility.

An active run captures this registry snapshot. A later server refresh cannot
replace an in-flight tool or silently alter its approval key. The tool call
still goes through the existing ToolExecutor; MCP is a provider, not a second
execution authority.

### Health and degraded states

Expose three user-visible states:

- `failed`: transport/auth/protocol/timeout error;
- `healthy-connectivity-only`: the endpoint responds, but capability
  verification was not completed;
- `healthy-verified`: the advertised capability set passed schema and policy
  checks.

Health probes are non-mutating, bounded and cancellable. Probe results carry a
monotonic check id so an older concurrent result cannot overwrite a newer one.
401/403 are classified as credential/configuration failures without echoing
the response. A probe is not permission to execute a tool.

### Skill loading

Skill instructions are bounded, source-labelled, untrusted context fragments.
Manifest hash, revision, origin and allowlisted tools are captured in the run
snapshot. Markdown cannot change system policy, request secrets, or register
arbitrary code. A Skill that needs code must declare an MCP/Tool provider and
pass the same activation checks.

## Implementation phases

### 49-R1: transport fixtures

Write fake stdio and Streamable HTTP servers first. Cover initialize,
capability advertisement, request/response ids, progress, cancellation,
timeout, malformed JSON, oversized payload, disconnect, 401/403, 429/5xx and
server shutdown. Keep transport tests network/process isolated through injected
ports; no daemon auto-start.

Exit: a transport result maps to a single bounded `ToolError`/health DTO and
never includes raw headers, env or response bodies.

### 49-R2: activation and registry

Implement capability validation, name conflict handling, risk metadata,
allowlist matching and immutable run snapshot. Add contract tests for unknown
server, incompatible schema, duplicate revision, stale health and capability
changes during a run.

Exit: no MCP/Skill descriptor reaches the AgentLoop without a snapshot and
policy decision.

### 49-R3: optional daemon settings and Web status

Expose authenticated, non-secret settings and health/probe actions through the
existing Settings drawer. The UI shows endpoint label, transport, revision,
health and next action; it never displays an API key, local executable path or
raw protocol error. Activation remains explicit and off by default.

Exit: restart restores non-secret manifest state, disabled integrations make no
process/network calls, and degraded health never blocks the conversation
composer.

### 49-R4: run-scoped execution bridge

Connect only activated, approved MCP tools to the existing ToolExecutor and
Sandbox. Apply cancellation and resource limits through the run's AbortSignal
and Scheduler lease. Record safe request/result metadata in `run_events` and
audit; bounded tool output remains source-labelled context.

Exit: an MCP tool can complete through the same approval/sandbox path as a
built-in tool, and failure/recovery cannot replay an old request.

## Acceptance matrix

- stdio and Streamable HTTP both support cancellation and bounded timeouts;
- endpoint/path, auth and capability contracts are explicit, with no implicit
  `/chat/completions` or arbitrary URL rewriting;
- malformed/unknown/oversized schemas fail closed;
- capability refresh does not mutate a running snapshot;
- server health cannot bypass approval or sandbox;
- no MCP/Skill process or network request occurs when mode is off;
- optional integration failures are `degraded` and do not block ordinary runs;
- tool output is redacted, bounded and marked untrusted before ContextManager;
- tests plus `pnpm typecheck`, `pnpm test`, `pnpm diff:check` and
  `git diff --check` pass.

## Non-goals and boundaries

- no arbitrary remote code execution, server-side plugin marketplace, or
  automatic installation/update of MCP servers;
- no second ToolRegistry, Scheduler, Approval or Sandbox;
- no promotion of Wiki/CodeGraph retrieval into an arbitrary tool until a
  separate descriptor/approval/resource review is accepted;
- no copying MCP SDK source, private module path or upstream UI;
- no complete LoopX/TencentDB/other sidecar runtime in this phase.

## Implementation-agent handoff prompt

> Read this Spec and the pinned MCP/health research. Preserve the current
> worktree and write fake stdio/HTTP transport tests first. Use public protocol
> boundaries, explicit endpoint/auth/capability contracts and native
> TypeScript adapters. Do not inherit daemon secrets, auto-start servers,
> register tools outside ToolRegistry, or bypass approval/sandbox/scheduler.
> Keep raw protocol data, credentials and absolute paths out of all events and
> Web DTOs. Update Spec/ADR/status before a commit and run the verification
> gate plus the focused transport/activation tests.
