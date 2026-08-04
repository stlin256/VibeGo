# Spec 49: MCP/Skill transport and capability lifecycle

- Status: 49-R1, 49-R2 and 49-R3 optional settings/status slice implemented; 49-R4 package and opt-in daemon binding implemented, live transport activation pending
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

#### R1 contract slice (2026-08-04)

`@ready4vibe/skill-mcp` now owns two injected channel factories and a bounded
protocol session. `McpStdioChannelFactory` starts only through an injected
argv/spawn port, uses newline-delimited JSON-RPC framing, an explicit env
allowlist and deterministic child close. `McpStreamableHttpChannelFactory`
posts to the exact manifest URL through an injected fetch port, sends bounded
content/accept headers plus optional in-memory auth headers, and never appends
paths or query credentials. Both factories map 401/403/429/5xx, malformed or
oversized payloads, disconnect, timeout and AbortSignal cancellation to stable
`McpTransportError` codes without returning raw body/header/env data.

`McpProtocolSession` opens once, performs `initialize`, exposes the bounded
server capability result and request-id correlation, forwards progress
notifications through an injected callback, and closes on every failure or
cancellation. It is a transport/session boundary only: it does not activate a
ToolRegistry descriptor, grant approval, acquire a Scheduler lease or invoke a
Sandbox. No daemon startup or default run path creates a session.

### 49-R2: activation and registry

Implement capability validation, name conflict handling, risk metadata,
allowlist matching and immutable run snapshot. Add contract tests for unknown
server, incompatible schema, duplicate revision, stale health and capability
changes during a run.

Exit: no MCP/Skill descriptor reaches the AgentLoop without a snapshot and
policy decision.

#### 49-R2 contract slice

The first R2 slice is a pure `@ready4vibe/skill-mcp` bounded context. It
accepts an already decoded, untrusted capability advertisement and returns an
immutable, versioned `McpCapabilitySnapshot`; it does not call a channel,
start a server, register the existing ToolRegistry or execute a tool.

- Every descriptor carries `schemaVersion`, server id/revision, capability kind,
  stable name/revision, source, bounded summary/schema, manifest-owned risk,
  required sandbox/network mode and approval mode.
- A descriptor is admitted only when the manifest server and declared tool are
  allowlisted, the protocol version is compatible, health is
  `healthy-verified`, the JSON Schema is bounded/compatible, and the advertised
  revision matches the immutable manifest revision. Server-provided risk or
  approval metadata cannot weaken the manifest/policy decision.
- Duplicate `(server, kind, name, revision)` entries fail closed. A refresh
  that changes a name's revision is a conflict rather than an in-place update;
  callers create a new snapshot and explicitly bind future runs to it.
- Health observations use a monotonic `checkId`; stale observations cannot
  replace a newer failed or verified status. `captureRunSnapshot()` deep-freezes
  descriptors and retains the fingerprint so later registry refreshes cannot
  mutate an in-flight run.
- Capability errors expose stable codes only. Raw advertisements, schema
  bodies, headers, environment values, secrets and absolute paths are not
  retained in the registry or returned in errors.

R2 remains a capability projection boundary. Approval, Scheduler, Sandbox,
ToolExecutor, AgentLoop, `run_events` and `goal_events` remain the only
authorities for execution and durable run facts.

#### 49-R2 implementation record (2026-08-04)

`@ready4vibe/skill-mcp` now exports `McpCapabilityRegistry`, bounded
`McpCapabilityDescriptor`/`McpCapabilitySnapshot` contracts and
`mcpCapabilityReference()`. The registry accepts only an explicitly
allowlisted manifest plus a verified advertisement, validates protocol and
JSON Schema bounds, preserves manifest-owned risk/sandbox/network/approval
metadata, rejects duplicate or conflicting revisions, ignores stale health
observations and deep-freezes run snapshots with deterministic SHA-256
fingerprints. Resources and prompts are read-only descriptors only when their
references are explicitly allowlisted. The focused package suite has 27 tests;
no channel, process, network request, ToolRegistry, Approval, Scheduler or
Sandbox is invoked.

### 49-R3: optional daemon settings and Web status

Expose authenticated, non-secret settings and health/probe actions through the
existing Settings drawer. The UI shows endpoint label, transport, revision,
health and next action; it never displays an API key, local executable path or
raw protocol error. Activation remains explicit and off by default.

#### 49-R3 application contract (2026-08-04)

R3 owns a small `ready4vibe_mcp_settings_v1` durable snapshot in the existing
`daemon_settings` table. It stores only bounded, non-secret intent:

- `enabled`;
- `serverId`, `serverVersion`, `transport` (`stdio` or `streamable-http`);
- a human-readable `endpointLabel` (label only, never a URL, command, argv or
  local path);
- the immutable `manifestRevision`; and
- an explicit, bounded capability reference allowlist.

The corresponding `ready4vibe_mcp_settings_status_v0` projection contains the
sanitized settings, `disabled | starting | ready | degraded` status,
`failed | healthy-connectivity-only | healthy-verified` health (or `null`),
current/previous revision, capability count, last health time, a stable error
code, and one of `enable | probe | review-capabilities | none` as `nextAction`.
Unknown fields, secret-shaped values, environment names/values, absolute paths,
URLs, commands and raw protocol responses are rejected before persistence or
Web serialization.

The daemon exposes authenticated `GET/PATCH /api/v1/settings/mcp` and
`POST /api/v1/settings/mcp/probe`. PATCH persists the snapshot and returns the
current status; probe is injected through an application port so tests can use
a fake capability verifier. When disabled, neither PATCH nor status creation
starts a child process or performs a network request, and `probe` is a no-op.
When enabled without a configured verifier, the status is bounded `degraded`;
ordinary conversation/run creation continues unchanged. A probe result is
accepted only for the same server/manifest revision and cannot activate a
ToolRegistry, alter `run_events`/`goal_events`, or change AgentLoop,
RunManager, Scheduler, Approval, Sandbox or WorkspaceRegistry behavior.

The Web settings drawer uses the same API and renders a compact MCP status
card. A degraded MCP status is informational and never blocks the composer.

Exit: restart restores non-secret manifest state, disabled integrations make no
process/network calls, and degraded health never blocks the conversation
composer.

### 49-R4: run-scoped execution bridge

R4 is a run-scoped adapter, not a new execution subsystem. Only a tool in an
immutable `McpCapabilitySnapshot` may be exposed to the model. The application
captures the snapshot when a run is created; capability refresh, settings
changes and transport replacement affect later runs only.

The bridge has three explicit ports:

1. `McpRunToolBinding` maps one executable MCP descriptor to the existing
   `ToolRegistry`/`ToolExecutor` descriptor. It copies only the stable id,
   revision, risk, summary, input schema, sandbox mode, network mode and
   approval mode. Resources and prompts are never executable tools.
2. `McpToolCallPort` performs one bounded `tools/call` through the already
   verified `McpProtocolSession`/transport. It receives the run `AbortSignal`,
   has a byte and timeout budget, and returns a redacted result or a stable
   `MCP_*` error code. It never receives the daemon's ambient environment.
3. `McpExecutionLedger` provides per-run idempotency. A key is
   `runId/turnId/callId/descriptorRevision/fingerprint(input)`. A matching
   completed request is a no-op replay that returns the bounded cached result;
   a matching in-flight request is shared; a different payload or descriptor
   revision fails closed. Recovery always creates a new run and cannot resume
   an unknown in-flight request.

The adapter is registered as a handler in the existing `ToolHandlerRegistry`
and is invoked only by `ToolExecutorRuntime`. Therefore approval evaluation,
approval continuation, sandbox resolution, workspace validation, Scheduler
leases and cancellation remain owned by the current boundaries. The bridge
does not call `ToolExecutor` recursively, create a second Approval/Scheduler/
Sandbox, or modify the AgentLoop state machine.

Bounded `tool.requested`, `tool.started`, `tool.output` and `tool.completed`
events retain only ids, revisions, risk, attempt, byte counts, stable error
codes and a redacted/truncated output. No MCP URL, command, argv, auth header,
environment value, absolute path, raw JSON-RPC body or complete transcript is
written to `run_events`, audit, logs or Web DTOs.

The default daemon composition remains unchanged while R4 is opt-in. A
missing, degraded or disabled MCP binding is omitted from the run snapshot;
ordinary runs continue with the built-in runtimes. A failed or cancelled MCP
call propagates a bounded tool failure and never silently retries. The only
retry after approval is the existing explicit continuation path, and the
idempotency ledger prevents duplicate remote execution.

#### 49-R4 acceptance tests

- only `healthy-verified`, allowlisted executable descriptors are bound;
- resource/prompt descriptors and stale snapshot revisions are rejected;
- ToolExecutor approval, Sandbox, WorkspaceRegistry and Scheduler are used;
- run cancellation aborts the MCP request and closes the session;
- response bytes and output context are bounded and source-labelled;
- same call key is a no-op/shared in-flight request; changed input/revision is
  a conflict;
- daemon restart marks the old run `needs-recovery`, and retry creates a new
  run without replaying the old MCP call;
- disabled/degraded/default MCP settings perform no transport side effect;
- no AgentLoop core-loop, RunManager default-start, `run_events` schema,
  `goal_events`, Approval or Sandbox authority changes are required.

#### 49-R4 pure bridge implementation slice (2026-08-04)

`@ready4vibe/skill-mcp` now provides `McpExecutionLedger` and
`McpProtocolToolCallPort`. `@ready4vibe/tool-adapters` provides
`McpToolExecutorRuntime`, which projects executable descriptors into the
existing `ToolRegistry` and sends calls through `ToolExecutorRuntime`.
Metadata needed for idempotency is passed through the existing handler context
as bounded run/turn/call identifiers; no AgentLoop state machine change is
needed. The package slice has 33 skill-mcp tests and 19 tool-adapter tests.
`apps/daemon` now adds `McpRunBindingManager`; it captures a verified snapshot
per run and composes an undefined runtime by default. The daemon main path
remains MCP-off until an application service explicitly activates a call port.
The daemon binding slice has 3 focused tests; live transport activation/smoke
remains pending.

#### 49-R4 application activation boundary

`McpLiveActivationService` is the only application entry point for turning a
verified transport result into a run binding. Its injected provider receives
the non-secret settings snapshot and an `AbortSignal`, and may hold runtime
credentials outside the settings/event/Web contracts. It must return a
`manifestRevision`, a `healthy-verified` capability snapshot and an
`McpToolCallPort`; the service checks server id, manifest revision, capability
allowlist and executable-only descriptors before calling
`McpRunBindingManager.activate`.

Provider timeout, malformed candidate, stale revision, disallowed capability
or transport failure deactivates the binding and records only a stable,
bounded degraded status. It never falls back to a direct provider, starts a
process, makes a network request, or blocks an ordinary run. A successful
activation records only bounded revision/count/health metadata through the
existing MCP settings status projection. Refresh replaces the binding for
future runs; already captured runtimes remain unchanged.

Exit: an activated MCP tool completes through the same approval/sandbox path
as a built-in tool, while failure, recovery and retry cannot replay an old
request.

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
