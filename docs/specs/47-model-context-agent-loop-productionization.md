# Spec 47: Model, context and AgentLoop productionization

- Status: in progress (47-R3 daemon/application bridge)
- Date: 2026-08-04
- Related: [harness contracts](../harness-contracts.md), [Spec 03](03-model-context-contract.md), [Spec 07](07-model-context.md), [Spec 08](08-agent-model-integration.md), [upstream harness research](../research/upstream-harness-implementations.md)

## Goal

Turn the current tested fake-model path and OpenAI-compatible adapter into a
repeatable, opt-in end-to-end harness without changing the authority of
`RunManager`, `run_events`, Scheduler, Approval, Sandbox, WorkspaceRegistry or
Goal Control. The first supported live provider is an explicitly configured
OpenAI-compatible endpoint (including DeepSeek-compatible deployments), while
the contract leaves room for explicit OpenAI Responses, Anthropic and local
providers.

“Productionization” here means observable boundaries, cancellation, bounded
context and a reproducible smoke test. It does not mean enabling network or
host tools by default.

## Current baseline and gap

- `ModelProvider` and `ContextManager` contracts exist and are covered by fake
  providers and mock fetch tests.
- The daemon can be configured with a provider, but the repository has not yet
  completed a real LLM API smoke run.
- The AgentLoop supports multiple turns/tool calls in its contract, while the
  verified daemon path still needs a real provider binding and multi-turn
  application fixture.
- Usage normalization exists as an observability contract. R3 will make every
  model attempt identify its provider/request in bounded `run_events`; the
  durable usage ledger attachment remains the separate Spec 50 boundary.

## Research gate (47-R0)

Before implementation, the agent must read the pinned files listed in
`docs/research/upstream-harness-implementations.md` and record any changed
provider or stream semantics in that document. It must also re-check the
provider's current API documentation and license. The agent must not copy
Codex/Aider/Goose prompts, message schemas, client code or session files.

### 47-R0 review note (2026-08-04)

The pinned clean-room study was re-read before implementation. The available
evidence confirms three boundaries used by this slice: provider wire formats
must be explicit adapters, canonical conversation state must remain separate
from provider messages, and retry/cancellation must be observable without
replaying a tool action. No upstream source, prompt, schema or runtime is
copied. The local research checkouts remain ignored under `.research/`.

The first implementation slice is deliberately network-free: it adds versioned
provider/replay contracts, deterministic stream replay and bounded retry
planning, then hardens the OpenAI-compatible adapter behind injected fetch.
It does not change daemon settings, run creation, AgentLoop state transitions,
`run_events`, or the default fake-provider path.

## Contract requirements

### Provider descriptor and snapshot

`ProviderDescriptor` is versioned, bounded and secret-free:

- stable provider id, display name, protocol (`openai-chat`, `openai-responses`,
  `anthropic-messages`, `local-compatible`), endpoint policy and capability
  flags;
- `authRef` that points to the process/OS secret store, never the key itself;
- model id and pricing model are separate fields;
- no query-string secret, absolute path, arbitrary header map or environment
  variable is accepted;
- a run captures an immutable provider/capability snapshot at creation; a
  settings change affects only subsequent runs.

Endpoint handling must be explicit. An adapter may call a documented endpoint
path, but it must not silently append `/chat/completions` to every base URL.
The adapter owns request headers, stream framing and response decoding.

### Canonical request and response

The adapter converts its wire format to existing canonical contracts:

- ordered messages retain role, source/trust labels and bounded content;
- tool schemas and calls are validated before entering the loop;
- text deltas, tool-call deltas, usage and terminal status are replayable into
  one final assistant/tool event sequence;
- `AbortSignal` cancels fetch, stream consumption and retry backoff;
- every retry attempt has a bounded attempt id and safe reason code;
- malformed JSON, unexpected role, unknown tool call, oversized delta and
  provider 4xx/5xx produce typed errors without leaking raw responses.

### Context budget and compaction

`ContextManager` must enforce both token and byte budgets before a request is
sent. Each item carries source (`user`, `assistant`, `tool`, `retrieval`,
`skill`, `mcp`) and trust. Compaction is append-only and records bounded source
sequence references. The following are never silently discarded:

1. the latest user objective;
2. pending approval/denial and cancellation decisions;
3. tool failure reasons and validation results;
4. provider and workspace snapshot metadata (without secrets or paths).

Untrusted tool/MCP/Skill text cannot become a system instruction through
compaction. A budget miss is a typed `context_budget_exceeded` or an explicit
bounded reduction, not an infinite retry loop.

### AgentLoop invariants

- no iteration is allowed without a model event, tool result, approval result,
  cancellation or bounded failure;
- tool calls are routed through the existing ToolRegistry/Approval/Sandbox
  boundary; AgentLoop never shells out or writes files itself;
- each turn and attempt is idempotent by run/turn/request id;
- recovery creates a new attempt and never replays an old tool call or old
  approval;
- terminal state is written to `run_events` before SSE broadcast;
- a provider/usage/observability failure cannot overwrite the original model,
  tool, approval or sandbox result.

## Implementation phases

### 47-R1: contract and replay fixtures

Write tests first for provider descriptors, protocol-specific endpoint policy,
canonical stream replay, bounded errors, cancellation and context compaction.
Add deterministic fixtures for OpenAI Chat Completions, OpenAI Responses and
Anthropic-shaped streams without adding provider SDKs. Keep all network calls
behind injected `fetch`/transport ports.

Exit: package typecheck and focused unit tests pass; no daemon path changes.

### 47-R2: explicit provider adapters

Implement the smallest adapter set required by the contracts. The OpenAI-
compatible adapter must support configurable base URL, model, timeout,
streaming and tool-call decoding. Provider-specific headers and endpoint paths
are explicit. Add a bounded retry policy for transient transport/429/5xx
responses with `Retry-After` clamped to the server limit.

Exit: mock-server tests cover success, partial stream, timeout, cancellation,
malformed response, 401/403, 429, 5xx and unknown usage. Secrets and raw
responses are absent from error/events.

### 47-R3: real AgentLoop application bridge

Connect the real adapter through the existing application service and frozen
run snapshot. Do not rewrite the AgentLoop state machine or add a second
scheduler. Every model attempt emits bounded usage metadata to the existing
observability port, while `run_events` remains the run authority.

Exit: fake and mock-provider multi-turn/tool-call tests pass, interactive runs
remain unbound by Goal quota, and cancellation/recovery never repeats a tool.

#### R3 slice boundary (2026-08-04)

The bridge is application-owned and deliberately small:

- `ModelSettingsManager` resolves a requested model provider into a
  secret-free `ModelProviderSnapshot` and an in-memory provider binding;
- `RunManager` captures that binding once before starting `AgentLoop`, and
  rejects a configured-provider mismatch without creating a run;
- `AgentLoop` records the optional snapshot in the bounded `run.created`
  payload and adds provider/request identifiers to `model.requested`;
- the existing scheduler, workspace lease, approval broker, sandbox runtime,
  `run_events` store and Goal Control remain authoritative;
- a fake-fetch OpenAI-compatible fixture proves two turns and a tool call
  through the daemon application service, while provider switching affects only
  later runs.

No usage ledger writer, Goal admission, live network smoke, or new scheduler is
introduced by this slice. A provider binding failure is a safe 4xx at the
authenticated run boundary; an upstream model failure remains the original
run/model error and is not replaced by observability metadata.

### 47-R4: opt-in live smoke and diagnostics

Add a separately named command (for example `pnpm smoke:model`) that runs only
when the caller explicitly supplies a provider URL, model and secret-store
reference. It must refuse to read a key from tracked files, print only
redacted provider/model/status/latency/usage summaries, and return a non-zero
code for malformed configuration. CI and `pnpm verify` never call it.

The DeepSeek/OpenAI-compatible configuration is a fixture/example only. No
credential, including the user-provided key, may be written to a file, lockfile,
event, screenshot, log, browser storage or commit.

Exit: one documented live smoke can complete a minimal text request when
credentials are supplied out-of-band; failure is classified as provider,
network, auth, schema or quota without blocking normal Web startup.

This command remains opt-in and outside `pnpm verify` for routine development,
but it is a mandatory evidence item for the Spec 52 release gate. A release
candidate cannot claim a complete core Harness without a successful redacted
live smoke report.

## 47-R4 implementation gate (2026-08-05)

The live smoke command is fixed as `pnpm smoke:model`. It requires an explicit
complete HTTPS endpoint, model name and environment-variable secret reference:

```text
pnpm smoke:model -- --endpoint <https://provider.example/v1/chat/completions> \
  --model <model-id> --secret-env <ENV_VAR> [--timeout-ms <100..30000>]
```

The `--secret-env` value is only a bounded reference name; the key is read from
that process environment at invocation time and is never accepted as a command
argument. The command sends one fixed, non-sensitive text request through the
existing explicit-endpoint OpenAI-compatible adapter, replays the bounded
stream, and prints one `model-smoke/v1` JSON report containing only provider,
model, status, latency, finish reason, token counts (or `null` when unknown),
and a stable error code. It must not print the endpoint, secret reference,
secret value, raw response, prompt, headers or stack trace.

Configuration, auth, quota, schema, timeout and network failures map to stable
non-zero exit codes. The command builds only the model adapter package, never
starts the daemon, never writes `run_events`/logs/files, and remains outside
`pnpm verify`; tests use injected providers and never contact the network.

## Tests first / acceptance matrix

- descriptor rejects secret-shaped fields, absolute paths, unknown protocol and
  oversized values;
- provider snapshot remains unchanged after settings/provider switch;
- each protocol's stream replays deterministically to the same final message;
- cancellation aborts fetch, stream and backoff and leaves one terminal run;
- duplicate request id is a no-op, different payload with the same id is a
  conflict;
- unknown/missing token fields remain `unknown`, never fabricated zero;
- context byte/token budget and compaction preserve the required invariants;
- model error, tool error, approval denial and observability failure retain
  their original error identity;
- a recovered run cannot replay old tool arguments or approvals;
- live smoke never writes credentials to repository, event, log or Web;
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check` and `git diff --check` pass.

## Non-goals and boundaries

- no Python/LiteLLM runtime, Rust/Codex runtime, provider proxy or second
  scheduler;
- no automatic model selection, hidden endpoint rewriting or prompt-injected
  Goal state;
- no default network/model call, shell, Git, MCP or Skill activation;
- no change to `run_events` schema, Goal Control admission, ApprovalPolicy,
  SandboxAdapter or WorkspaceRegistry authority;
- no promise that a provider's reported usage is billing-exact when the
  provider returns incomplete fields.

## 47-R1/R2 implementation update (2026-08-04)

R1/R2 is being delivered as a pure contract/adapter slice. The tests cover
provider descriptor privacy and endpoint policy, canonical replay of text/tool
call/usage/terminal events, duplicate request conflict semantics, abort-aware
retry delays, and bounded OpenAI-compatible SSE decoding. The adapter accepts
an explicit complete endpoint; legacy base URL construction remains only as a
compatibility path and is covered by a deprecation-safe test. No live key or
provider response is persisted, and `pnpm verify` never performs a network
request.

The current implementation consists of `packages/contracts/src/model-runtime.ts`
for versioned provider snapshot/request/event/retry DTOs,
`packages/model-openai/src/runtime.ts` for deterministic replay, request
idempotency and pre-stream retry, and `packages/model-openai/src/protocol.ts`
for clean-room OpenAI Responses and Anthropic-shaped fixture translation.
`ContextManager` now supports independent byte/token/item budgets, protected
objective/policy/failure/snapshot items and append-only compaction references;
the existing AgentLoop passes `maxModelInputTokens` into that budget without
changing its state transitions. The full repository gate currently passes with
402 tests. R3 now adds the daemon binding/snapshot bridge; only R4 live smoke
and later Spec 50 ledger lifecycle attachment remain deferred.

## 47-R3 implementation update (2026-08-04)

The daemon bridge is implemented as an application-service adapter:

- `InMemoryModelSettingsManager.bindRun()` returns an in-memory provider and a
  validated `ModelProviderSnapshot` with no API key, headers or absolute path;
- `RunManager` captures that binding before creating a run and passes the
  snapshot to the existing `AgentLoop`; configured provider mismatches fail at
  the authenticated run boundary before `run.created`;
- `AgentLoop` records the snapshot in `run.created` and bounded provider,
  request and descriptor-revision metadata in `model.requested` while keeping
  `run_events` authoritative;
- daemon tests exercise a fake-fetch OpenAI-compatible two-turn tool call,
  provider-switch isolation and the safe mismatch response. The fixture never
  contacts a network and no observability-ledger writer was added.

## Implementation-agent handoff prompt

> Read this Spec, `docs/harness-contracts.md` and the pinned upstream research
> before editing. Inspect `git status` and preserve unrelated dirty worktree
> changes. Write fixtures/tests first. Implement only explicit TypeScript
> provider/context/application adapters; do not vendor upstream code, add a
> Python/Rust runtime, alter the AgentLoop state machine or enable live network
> by default. Keep secrets, raw responses, prompts, tool output and absolute
> paths out of events/logs/browser. Run `pnpm typecheck`, focused tests,
> `pnpm diff:check` and `git diff --check`; update this Spec, the ADR and
> `docs/implementation-status.md` before any commit.
