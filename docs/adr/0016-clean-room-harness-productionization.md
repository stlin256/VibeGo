# ADR 0016: Clean-room harness productionization boundary

- Status: accepted for staged implementation
- Date: 2026-08-04
- Related: [harness research](../research/upstream-harness-implementations.md), [Spec 47](../specs/47-model-context-agent-loop-productionization.md), [Spec 48](../specs/48-approval-sandbox-shell-runtime.md), [Spec 49](../specs/49-mcp-skill-transport-and-capability-lifecycle.md), [Spec 50](../specs/50-observability-lifecycle-integration.md), [Spec 51](../specs/51-host-first-release-and-client-boundary.md)

## Context

ready4vibe has a substantial TypeScript/SQLite scaffold: contracts,
RunManager, AgentLoop, ContextManager, provider adapter, approval/sandbox
boundaries, MCP/Skill descriptors, Goal Control, observability ledgers and a
conversation-first Web. Several integrations are deliberately test-first or
opt-in. The upstream ecosystem provides mature ideas, but importing a complete
Codex/OpenHands/Aider/Goose/LiteLLM/Langfuse/MCP runtime would increase memory,
license, security and upgrade risk and would create competing authorities.

The user needs a host that can run the backend and Web, be reached by a LAN
browser, and later support Tailscale/SSH and native mobile clients. The harness
must remain low-resource, auditable and extensible for a single user.

## Decision

1. **Use clean-room semantic reimplementation.** Upstream repositories are
   research inputs only. A feature may be reimplemented from public behavior
   and tests; source reuse requires a later ADR with exact file, commit,
   license, NOTICE, dependency and removal plan. The MCP SDK licensing
   transition and AxonHub/Langfuse/LiteLLM subdirectory boundaries are treated
   as blocked until revalidated.
2. **Keep one execution authority.** The daemon application layer coordinates
   `RunManager`, Scheduler, Approval, Sandbox, WorkspaceRegistry, AgentLoop and
   the existing `run_events`. Goal Control remains an optional application
   control plane with separate `goal_events`. Observability ledgers are
   projections/records, not a second scheduler or run source.
3. **Freeze snapshots at run boundaries.** Provider/capability, context/tool
   registry, workspace/sandbox and memory settings are captured for a run.
   Settings, MCP refresh, provider switching and sidecar updates affect only
   new runs.
4. **Compile safety before execution.** Model output is untrusted. Approval,
   sandbox, Scheduler lease, workspace path and network policy are independent
   gates; bounded automatic approval is a visible, expiring session grant for
   an exact low-risk key, never a blanket shell permission.
5. **Separate protocol from policy.** Provider wire formats, MCP transports,
   sidecar/memory adapters and future remote transports own framing/health and
   cancellation. Tool risk, approval, sandbox, resources and privacy remain
   ready4vibe policy.
6. **Make degradation explicit.** Optional provider-memory/MCP/observability/
   certificate integrations return `degraded`/`unknown` with stable safe error
   codes. They cannot block an ordinary interactive run or overwrite its
   original error.
7. **Ship host-first.** The daemon serves hashed React assets, REST and SSE on
   one authenticated origin. Remote users need only a URL and pairing. Native
   Android/iOS/HarmonyOS clients are later API consumers and never read SQLite,
   secrets, workspace roots or raw events.

## Consequences

### Positive

- memory and operational footprint remain close to one Node process plus
  SQLite; no Python proxy, Rust runtime, ClickHouse, Redis or cloud service is
  required;
- upstream improvements can be evaluated independently and removed without
  changing the core contracts;
- run, goal, usage and audit replay are deterministic and privacy-bounded;
- the same approval/sandbox semantics apply to built-in, MCP and future client
  requests;
- the host URL is usable from desktop, phone, foldable and tablet browsers,
  while future native clients have a stable boundary.

### Costs and risks

- clean-room adapters require more TypeScript tests and ongoing protocol
  compatibility work;
- live-provider, container and launcher smoke tests need opt-in local tools;
- pricing and resource metrics may be `unknown` when providers/OS APIs do not
  report them;
- each substantive phase requires synchronized Spec/ADR/status updates before
  a Git commit.

## Rejected alternatives

- **Vendor complete Codex/OpenHands/Goose/LiteLLM:** violates the low-resource,
  single-authority and license/upgrade boundaries.
- **Put all data in one transcript/event stream:** makes privacy, replay and
  Goal/usage/audit retention impossible to reason about.
- **Let the model or prompt decide approval:** confuses untrusted output with
  authorization and cannot enforce filesystem/network policy.
- **Start every MCP/sidecar/provider on daemon boot:** increases attack
  surface, startup cost and makes optional integrations hard dependencies.
- **Make mobile clients direct SQLite/sidecar peers:** duplicates business
  logic and leaks filesystem/secrets outside the host boundary.

## Rollout and rollback

The stages are independent Git slices:

1. Spec 47 model/context/loop and opt-in live smoke;
2. Spec 48 approval/sandbox/shell closure;
3. Spec 49 MCP/Skill transport and capability lifecycle;
4. Spec 50 observability lifecycle integration;
5. Spec 51 host packaging, LAN/public TLS adapter and client SDK boundary.

Each stage is tests-first and feature-gated. A failed candidate build, health
probe, smoke test or migration leaves the current implementation active. No
run, Goal event, usage ledger or certificate rollback replays old tool calls or
changes historical records.

## Validation

Every stage must run `pnpm typecheck`, `pnpm test`, `pnpm diff:check` and
`git diff --check`. Live model/container/launcher checks are separate explicit
commands and never part of the default verification gate. Documentation and
implementation status must be updated before the corresponding Git commit.
