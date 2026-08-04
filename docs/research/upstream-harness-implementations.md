# Upstream harness implementation research

Status: accepted research baseline (2026-08-04)

This document records the clean-room study used to plan the next ready4vibe
harness milestones. It is a design study, not a dependency proposal. The
runtime remains native TypeScript/Node/SQLite and the web client remains a
thin consumer of versioned daemon contracts.

## Research method and evidence boundary

The repositories were inspected at shallow, non-vendored checkouts. The
working copies are outside the product tree in
`C:\Users\yjzlx\AppData\Local\Temp\ready4vibe-upstream-study` and in the
ignored `.research/` directory. They are disposable research material and must
never be added to a VibeGo release or commit. The study read the upstream
README, license/notice files, manifests, and only files directly related to
the capability under review. A future implementation agent must repeat the
license and path check if a pinned revision changes.

The following pins are the evidence anchors used for this planning pass:

| Project | Repository / branch | Pinned revision | License boundary | Primary study topics |
| --- | --- | --- | --- | --- |
| Codex | [openai/codex](https://github.com/openai/codex) / `main` | `77ce1d10aa93fc377de581506edf802d0cbcbeca` | Apache-2.0 | permission profiles, approval, sandbox policy, tool orchestration, resumable turns |
| OpenHands | [OpenHands/OpenHands](https://github.com/All-Hands-AI/OpenHands) / `main` | `0ffcb659d1d43671b165c8a0eb98ed4df5a83551` | MIT | Agent Canvas, local/remote backends, sandbox warnings, MCP health |
| Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) / `main` | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | Apache-2.0 | repo map, conversation loop, Git/test integration, model abstraction |
| Goose | [aaif-goose/goose](https://github.com/block/goose) / `main` | `7f62ce53e70c49e634ed9ba16a1ef8e02a2d239c` | Apache-2.0 | canonical conversations, provider formats, token usage, retries, MCP extensions |
| MCP TypeScript SDK | [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) / `main` | `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` | licensing transition; re-check per file before reuse | stdio/Streamable HTTP, auth, sessions, cancellation, capability advertisement |
| LiteLLM | [BerriAI/litellm](https://github.com/BerriAI/litellm) / `litellm_internal_staging` | `956d5177d1d915adc8084c142d9d2babad1ff7af` | MIT outside `enterprise/` | provider normalization, price/catalog semantics, cache and retry behavior |
| Langfuse | [langfuse/langfuse](https://github.com/langfuse/langfuse) / `main` | `9ea1d895a71ac6954caf496235cefe4dfe23b39e` | MIT Expat outside `ee/` and third-party boundaries | trace/generation/span projections, usage/cost, pricing tiers |
| Continue | [continuedev/continue](https://github.com/continuedev/continue) / `main` | `5522c6f44ca0ac3528b37244818fbfa39b5af470` | Apache-2.0 | core/context/tools boundaries, configuration reload, MCP and no-telemetry tests |
| OpenTelemetry specification | [open-telemetry/opentelemetry-specification](https://github.com/open-telemetry/opentelemetry-specification) / `main` | `2b7a5617c0043ea0ac897a1452022eb04c72e89f` | Apache-2.0 | resource identity, bounded attributes, aggregation and dropped-signal semantics |

The Codex, OpenHands, Aider, Goose, MCP SDK, LiteLLM, Langfuse and Continue
checkouts used for this table were cloned only for observation. No upstream
source, prompt, schema, UI asset, session format, proxy, scheduler or runtime
was copied into ready4vibe. The MCP SDK's transition from MIT to Apache-2.0
means that a code reuse request is blocked until the exact file's provenance is
recorded. Langfuse `ee/`, OpenHands optional services, LiteLLM `enterprise/`,
and AxonHub/CC Switch research from [the provider study](upstream-provider-usage.md)
remain separate license and runtime boundaries.

## Findings by harness layer

### Model and protocol adapters

Goose and LiteLLM make the same useful separation: provider wire formats are
adapters around a canonical conversation and usage model. OpenAI Chat
Completions, OpenAI Responses and Anthropic messages cannot safely be handled
by a helper that silently appends `/chat/completions`; endpoint path, headers,
stream framing and capability flags belong to an explicit adapter. LiteLLM's
model-price catalog also shows why `requestModel` and `pricingModel` must remain
separate and why a missing price is `unknown`, not zero.

**ready4vibe decision:** `ModelProvider` receives a frozen per-run provider
snapshot. A descriptor contains protocol, endpoint policy, capabilities and a
secret-store reference only. A normalizer emits the existing
`ModelUsageRecord`; raw provider responses, authorization headers and API keys
are never events or browser data. Retries are bounded and observable per
attempt, and a live provider smoke test is opt-in rather than part of unit CI.

### Context and agent loop

Aider's repo map and history handling demonstrate that a coding agent needs
bounded repository context, diff/test feedback and a conversation loop, not
only a chat completion. Codex models a turn as a resumable stream with explicit
thread/run identifiers and structured events. Goose keeps the canonical
conversation separate from provider-specific message formats.

**ready4vibe decision:** ContextManager owns source labels, trust, byte/token
budgets and compaction. `AgentLoop` consumes a frozen context/tool snapshot and
emits append-only events; it does not read Goal state, execute shell directly,
or infer approval from model text. Recovery starts a new attempt and never
replays an old tool call.

### Approval, sandbox and shell

Codex is the clearest reference for the semantics rather than the code. Its
permission profiles separate read-only, workspace-write and unrestricted modes;
project trust, filesystem roots, network access and approval behavior are
compiled into an execution policy. Tool metadata and policy matching determine
whether an action is allowed, denied or requires a user decision. Unknown or
incompatible policy inputs fail closed. OpenHands reinforces that a no-sandbox
mode is a host-privilege decision that must be visible to the user.

**ready4vibe decision:** ApprovalPolicy, SandboxAdapter and Scheduler remain
independent gates. A model response is never authorization. The default is
untrusted task handling with bounded automatic approval only for a declared
low-risk class; writes, network, shell and privilege changes remain `ask` or
`deny` unless a user-created session grant and the selected sandbox permit
them. Host-restricted is displayed as path restriction, never as strong
isolation.

### MCP and Skill lifecycle

The MCP TypeScript SDK keeps transport (stdio or Streamable HTTP), auth,
session state, cancellation and progress separate from server tool
advertisement. OpenHands' health classification adds a useful operational
detail: `failed`, `healthy + verified` and `healthy + connectivity-only` are
different states. Continue's configuration and no-telemetry tests are a good
checklist for reload and failure behavior.

**ready4vibe decision:** Skill manifests are bounded, signed/hashed metadata
and untrusted instruction fragments. MCP tools enter a temporary registry only
after schema, capability, risk, name-conflict and allowlist checks. Health
probes are non-mutating and redacted; a stale concurrent probe cannot overwrite
a newer result. Transport failure degrades an optional integration and cannot
block ordinary Web or interactive runs.

### Observability, token and cost accounting

CC Switch and AxonHub (documented in [the provider/usage study](upstream-provider-usage.md))
show why cache-inclusive versus fresh input tokens, cache write/read, reasoning
and retry attempts must be explicit. Langfuse separates trace/generation/span
projections from the business transcript and keeps pricing tier selection
bounded. OpenTelemetry highlights the memory/cardinality cost of unbounded
attributes and the need to report dropped signals.

**ready4vibe decision:** `run_events`, `goal_events`, usage ledger, resource
samples and audit ledger are separate authorities. A projection may join safe
IDs and counters, but it never stores prompts, transcripts, raw tool output,
commands, environment variables, absolute paths or secrets. Sampling and
rollup are fail-soft; `unknown`/`degraded` is more honest than fabricated
zeros.

### Host, remote and multi-device UX

OpenHands demonstrates a single control surface over local and remote
backends, while Codex and Aider show that a stream of structured events is the
stable UI contract. The implication for VibeGo is host-first: the daemon owns
execution and static Web hosting, and a remote browser only opens the URL.

**ready4vibe decision:** desktop, portrait desktop, phone, foldable and tablet
are responsive Web variants of one conversation-first shell. Android, iOS and
HarmonyOS clients are later adapters over versioned REST/SSE and pairing; they
do not read SQLite or reproduce AgentLoop, Approval, Scheduler or Sandbox.

## Capability comparison

| Layer | Codex | OpenHands | Aider | Goose | MCP SDK | ready4vibe mapping |
| --- | --- | --- | --- | --- | --- | --- |
| Run/session | resumable thread/turn events | backend/session service | interactive coder history | session/recipe split | session transport | `RunManager` + `run_events` + SSE |
| Model formats | explicit protocol schemas | backend-dependent | LiteLLM-backed adapter | canonical provider formats | n/a | explicit `ModelProvider` adapters |
| Context | turn input and tool state | conversation service | repo map + history | canonical messages | resources/prompts as external source | `ContextManager` with trust/budget |
| Approval | permission profiles + policy | sandbox/backend warning | user confirmation for commands | permission contract | auth/capability only | `ApprovalPolicy` before executor |
| Sandbox | filesystem/network policy | Docker/VM/local choices | host Git/shell workflow | extension/runtime boundary | process/HTTP transport | `SandboxAdapter` + scheduler lease |
| MCP/extension | tool registry | MCP health/servers | model/tool config | extension manager | transport/session/capability | Skill loader + MCP client + ToolRegistry |
| Usage/cost | event metadata | bounded usage/cost DTO | model/token reporting | independent token usage | progress/cancel | observability ledger/projection |
| UI/deployment | CLI/app-server clients | local/remote/cloud canvas | terminal/IDE/web | desktop/CLI apps | client/server protocol | daemon-hosted React Web, future native clients |

## Clean-room reuse policy

1. The default decision is to reimplement semantics from public behavior and
   tests. A design idea, data shape or protocol concept is not a code license.
2. Before copying even a small utility, record repository URL, exact commit,
   file path, SPDX/license, NOTICE obligations, dependency impact and a
   replacement/removal plan in an ADR. Do not copy from AxonHub `llm/`,
   Langfuse `ee/`, LiteLLM `enterprise/`, or MCP files whose transition status
   is not clear.
3. Never vendor a complete upstream runtime, proxy, scheduler, UI, CLI session
   store, Python/Rust/Tauri service, or host bridge. The VibeGo process model
   stays Node/TypeScript with SQLite and optional isolated sidecars.
4. Research checkouts remain ignored. Generated price catalogs, upstream
   prompts, branding, screenshots and full transcripts are not research
   artifacts for this repository.

## Mapping to the next implementation specs

| Spec | Scope | Exit proof |
| --- | --- | --- |
| [47](../specs/47-model-context-agent-loop-productionization.md) | real provider, context budget, streaming loop and opt-in live smoke | deterministic replay, cancellation/retry tests, no-secret live smoke |
| [48](../specs/48-approval-sandbox-shell-runtime.md) | compiled approval, auto-approval boundaries, shell and sandbox smoke | untrusted-task, Windows process, policy and recovery tests |
| [49](../specs/49-mcp-skill-transport-and-capability-lifecycle.md) | real MCP transports and Skill activation | stdio/HTTP health, capability snapshot, cancellation and privacy tests |
| [50](../specs/50-observability-lifecycle-integration.md) | run lifecycle usage/resource/audit integration | ledger replay, resource degradation, cost reconciliation and API tests |
| [51](../specs/51-host-first-release-and-client-boundary.md) | packaged daemon + static Web + remote browser and future native-client contract | one-command host launch, LAN/public TLS gate and REST/SSE compatibility |

Each spec contains a research gate, tests-first phases, explicit non-goals,
and a handoff prompt for the implementing agent. A phase may not change the
default interactive run path until its contract and regression tests pass.
