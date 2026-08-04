# Spec 50: Observability lifecycle integration

- Status: accepted for 50-R3 (resource sampling lifecycle adapter)
- Date: 2026-08-04
- Related: [Spec 43](43-resource-usage-and-cost-audit.md), [Spec 44](44-provider-usage-management-and-upstream-reuse.md), [Spec 45](45-observability-api-and-web.md), [ADR 0012](../adr/0012-local-resource-and-cost-audit-ledger.md), [upstream harness research](../research/upstream-harness-implementations.md)

## Goal

Attach the existing token/cost/resource/audit contracts to the daemon's
application lifecycle so a user can understand CPU, memory, disk, token use,
latency and estimated cost for each run without making observability a hidden
execution dependency. The ledger remains local, bounded and auditable; the Web
consumes projections only.

## Current baseline and gap

- Spec 43 contracts, in-memory/SQLite usage ledger, UTC rollups, price rules,
  reconciliation and audit hash-chain adapters exist.
- Spec 44 provider descriptors/normalizers and Spec 45 authenticated Usage/Audit
  projections exist.
- `ResourceCollector` has idle/active/detailed profiles and fail-soft queues,
  but automatic sampling and complete RunManager lifecycle wiring are not yet
  accepted as the default runtime behavior.
- The daemon must not pretend that a missing provider price or unsupported OS
  metric is zero or healthy.

## Research gate (50-R0)

Re-read the pinned CC Switch/AxonHub/LiteLLM/Langfuse/OpenTelemetry evidence in
`docs/research/upstream-provider-usage.md` and the broader harness study.
Verify pricing/license revisions before importing any catalog data. No upstream
proxy, Tauri app, ClickHouse/Postgres service, OpenTelemetry Collector or
Python runtime may be added as a prerequisite.

## Authority and data model

The following authorities stay separate:

| Data | Authority | May be joined in a projection |
| --- | --- | --- |
| run lifecycle/tool results | `run_events` | run id, attempt, safe status and timestamps |
| Goal state | `goal_events` | goal id and bounded evidence refs |
| model/tool usage | `usage_ledger` | usage id, run/turn/attempt and counters |
| CPU/memory/disk/sandbox samples | resource ledger | timestamp, scope id and bounded values |
| security/action audit | audit ledger | actor, action, target id, outcome, reason code, chain metadata |

No ledger stores prompt/transcript, raw provider response, complete tool output,
command, cwd, environment value, absolute path, API key or certificate key.
The run event may reference a usage/audit id but does not become a second cost
or resource source.

## Lifecycle contract

### Run start

At application-level run creation, capture a safe provider/capability/resource
snapshot and a sampling profile (`idle`, `active`, `detailed`). Emit no secret
or absolute path. Sampling begins only after the run has a Scheduler lease and
stops on terminal state or cancellation.

### Model/tool attempts

Each provider response is normalized once. A stable `usageId` plus bounded
semantic fingerprint makes retries idempotent; same content is a no-op and a
different content is a conflict. Attempts remain separate for diagnosis. Token
semantics (`fresh`, `cache-inclusive`, `unknown`) and pricing revision are
explicit. Missing pricing keeps cost `unknown`.

Tool and sandbox execution records bounded duration, exit/error code and
resource references only. It does not sample by spawning shell/PowerShell or
scanning the workspace.

### Run terminal and projection

Terminal summary and audit append after the authoritative `run_events` write,
but an observability failure does not change the original run outcome. An
asynchronous compaction/write queue may retry a ledger append with idempotent
keys, never re-run a model/tool/shell operation. Web projections return
`ready|degraded|unknown` and nullable counters rather than fabricated zeros.

## Implementation phases

### 50-R1: application ports and lifecycle fixture

Write a fake RunManager lifecycle fixture that creates, retries, pauses,
cancels, recovers and terminates a run. Assert exactly one usage/audit/resource
append per logical attempt and no append for disabled sampling. Keep the port
outside AgentLoop and do not change `run_events` or `goal_events`.

Exit: replaying the same lifecycle is deterministic and does not execute a
provider/tool.

### 50-R2: provider usage and cost wiring

Inject the normalizer/reconciliation/pricing ports at the application boundary.
Record provider-reported usage, estimated/unknown accuracy and cost items with
pricing revision. Include TTFT/latency when available, otherwise `unknown`.
Retry, partial stream and provider failure tests must preserve all known
counters without double counting.

Exit: live-like mock provider runs produce a ledger record and Spec 45 summary;
unit tests remain network-free and no raw response is persisted.

### 50-R3: low-resource sampling

Start/stop `ResourceCollector` from the application lifecycle with bounded
queue/cadence and a configurable retention policy. Use Node APIs and injected
OS/sandbox probes only. Unsupported metrics, queue overflow and writer failure
produce dropped/degraded counters and never block a run.

Exit: Windows/macOS/Linux adapter fixtures cover CPU, RSS/memory, disk and
sandbox metrics; idle profile has a measurable low overhead budget documented
with a reproducible local benchmark.

### 50-R4: audit and Web projection completion

Append validated action audit events for settings, approval, sandbox and
provider changes. Expose bounded Usage/Audit pages, UTC rollups, pricing
revision and hash-chain verification through the existing authenticated API.
Add export/import only as an explicit user action with redaction and integrity
verification; never auto-upload telemetry.

Exit: Web and future clients consume versioned projections, pagination is
bounded, and audit verification distinguishes valid, degraded and unknown.

## 50-R1 implementation update (2026-08-05)

The application boundary now has a pure `ObservabilityLifecycleRecorder` and
an injected writer port. It accepts only bounded lifecycle observations and
derives one idempotent model/tool/resource/audit batch per logical attempt.
Create, retry, pause, cancel, recover and terminal transitions are represented
in the fixture without calling a provider, tool, shell or filesystem. Replayed
logical attempts are no-ops when their canonical payload is unchanged and
fail-closed conflicts when it changes. Disabled sampling emits no resource
sample. Writer failures return a bounded `degraded` result and never change the
originating run outcome. Secret-shaped fields, environment values and absolute
paths are rejected before the writer is called.

This is an application-port slice only: the default `RunManager.start()` path,
`AgentLoop`, `run_events`, `goal_events`, `Scheduler`, `Approval`, `Sandbox` and
`WorkspaceRegistry` remain unchanged. Automatic lifecycle wiring is deferred to
50-R2/R3 after provider usage and resource sampling acceptance.

The implementation is `packages/observability/src/lifecycle.ts` with
`lifecycle.test.ts`; the focused observability gate is 38 passing tests. The
fixture is network-free and does not require a model credential or a live
process.

## 50-R2 implementation gate (2026-08-05)

The next adapter will accept only the versioned
`ProviderUsageObservation` contract, normalize it once, reconcile duplicate or
complementary sources, apply an immutable `PricingCatalog` revision, and append
bounded `ModelUsageRecord` values through the existing writer port. Missing
pricing remains `unknown` instead of zero; reported, estimated and partial
provider-failure token facts are preserved, including latency and TTFT when
present. The adapter will be idempotent by `usageId`, fail closed on changed
payloads, and return `degraded` on writer failure without changing a run result.

No raw provider response, credential, prompt, tool output or network client is
accepted by this boundary. It remains outside AgentLoop and the default
RunManager start path; live provider smoke and automatic lifecycle wiring are
deferred until the explicit release gate.

## 50-R2 implementation update (2026-08-05)

`packages/observability/src/provider-usage-lifecycle.ts` now implements the
adapter and its network-free fixture. It normalizes each observation through
the public contract, reconciles complementary `provider-usage`/`run-event`
facts, applies the selected `PricingCatalog` revision, and appends only bounded
model records. Unknown price dimensions remain explicit; token accuracy maps
to exact/estimated/unknown cost accuracy, while partial failed responses retain
known counters, latency and TTFT. A stable `usageId` payload is a no-op on
replay and a changed payload is a conflict, including concurrent delivery.
Writer failure is degraded and retryable. The package gate is 47 passing tests;
no provider, tool, shell, network or credential is used.

## 50-R3 implementation gate (2026-08-05)

The sampling adapter will own only collector lifecycle state. It starts a
bounded `ResourceCollector` after an explicit Scheduler lease, stops and flushes
on pause/cancel/terminal, and can start a fresh snapshot after recovery/retry.
Disabled sampling creates no collector and performs no writer call. Queue
overflow, unsupported Windows/macOS/Linux probes, and writer failures remain
bounded `degraded`/`unknown` signals; no shell, PowerShell, CLI or workspace
scan is permitted. Retention is a policy value only in this phase—automatic
deletion is not introduced.

The adapter is injected and network-free. It does not become a second
scheduler, does not execute a run, and does not alter AgentLoop, RunManager,
`run_events` or `goal_events`.

## Acceptance matrix

- interactive run outcome is unchanged when usage, sampling, pricing or audit
  writes fail;
- same `usageId`/payload is a no-op, different payload is a conflict;
- every retry attempt is visible but no retry re-executes old tools;
- cache/reasoning/audio/prediction dimensions and unknown fields are preserved;
- cost uses immutable decimal micros and pricing revision; missing price is
  unknown, not zero;
- resource queue overflow and unsupported probes are observable and bounded;
- audit hash-chain replay is deterministic and rejects tampering;
- no secret, prompt, raw output, command, environment or absolute path appears
  in ledger/API/Web/export;
- API range/cursor/response limits and degraded statuses are enforced;
- Goal quota never bypasses Scheduler, Approval, Sandbox or Workspace;
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check` and `git diff --check` pass.

## Non-goals and boundaries

- no second event source, scheduler, tracing platform or billing provider;
- no ClickHouse, Postgres, Redis, OTel Collector or external telemetry by
  default;
- no exact billing claim when provider usage or pricing is incomplete;
- no direct SQLite access from Web/mobile clients;
- no changes to AgentLoop core, `run_events`, `goal_events` or Goal admission;
- no automatic retention deletion without an export/integrity policy.

## Implementation-agent handoff prompt

> Read Specs 43–45, ADR 0012/0014 and the pinned usage research. Preserve dirty
> changes and write lifecycle fixtures before wiring code. Inject observability
> only at the daemon application/RunManager boundary; never create a second
> ledger or modify AgentLoop, run_events, goal_events, Scheduler, Approval or
> Sandbox authority. Keep prompts, raw responses, commands, env, paths and
> secrets out of records and projections. Run typecheck/tests/diff checks and
> update Spec, ADR, roadmap and implementation status before any commit.
