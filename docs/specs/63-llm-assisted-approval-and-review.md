# Spec 63: LLM-assisted approval and review

- Status: 63-1 implemented (contracts and default-disabled Noop reviewer;
  provider/runtime integration remains staged)
- Date: 2026-08-05
- Scope: bounded LLM review for tool-approval decisions, reviewer/provider
  selection, daemon settings, ApprovalBroker integration, Web UX, audit and
  verification evidence
- Related: [Spec 03: Model and context contracts](03-model-context-contract.md),
  [Spec 47: Model/Context/AgentLoop productionization](47-model-context-agent-loop-productionization.md),
  [Spec 48: Approval/Sandbox/Shell runtime closure](48-approval-sandbox-shell-runtime.md),
  [Spec 59: Permission profiles and low-interruption approval](59-permission-profiles-and-low-interruption-approval.md),
  [Spec 60: Verification and release evidence](60-complete-verification-and-release-evidence.md),
  [Spec 62: User-facing documentation quality](62-user-facing-documentation-quality.md),
  [ADR 0044: LLM-assisted approval boundary](../adr/0044-llm-assisted-approval-review-boundary.md)

## 1. Goal

VibeGo should be able to use an LLM as a bounded reviewer for repetitive,
low-risk approval requests so a trusted coding session feels lightweight. The
reviewer may classify a request as `allow`, `ask-user`, `deny`, or
`unavailable`, but it is never an authority that grants capabilities. The
existing deterministic policy, permission profile, Goal admission, Scheduler,
Sandbox, WorkspaceRegistry and ApprovalBroker remain authoritative.

The feature supports two reviewer-source choices:

1. `same-as-run`: use the provider/model snapshot already selected for the
   current run. This is the default reviewer source when the feature is enabled.
2. `dedicated`: use a separately configured provider/model profile selected by
   the user for approval review. Its credential reference and endpoint remain
   daemon-owned and are never sent to the browser.

The migration default is `enabled=false`. Enabling the feature is an explicit
user action because reviewer calls can incur cost, latency and network access.
The default-off migration preserves existing runs and approval behavior.

## 2. Non-goals

- The LLM must not become a policy engine, capability grantor, scheduler,
  sandbox resolver or workspace authority.
- The reviewer must not approve `full-host`, privilege escalation, secrets or
  credentials, network enablement, destructive Git/filesystem operations,
  unknown tools, or untrusted-content host execution.
- The feature must not add a second AgentLoop, scheduler, approval store,
  event authority or host bridge.
- It must not send a complete prompt, transcript, raw tool output, environment,
  credential, private key, absolute host path or arbitrary command to a model.
- It must not use model-generated confidence or chain-of-thought as a security
  decision, and it must not silently retry a denied or failed tool call.
- It does not replace human approval for high-risk or ambiguous operations.

## 3. Authority and decision order

Every review follows this order:

```text
ToolIntent
  -> deterministic ApprovalPolicy / permission snapshot
  -> Goal/Scheduler/Sandbox/Workspace readiness (where applicable)
  -> bounded LLM review for an eligible low-risk request
  -> exact-key policy intersection
  -> existing ApprovalBroker decision
  -> ToolExecutor / Sandbox runtime
```

The intersection is fail-closed:

| Deterministic result | LLM result | Effective result |
| --- | --- | --- |
| `deny` | any | `deny` |
| `ask-user` | `allow` | `ask-user` |
| `allow` but outside the LLM-enabled low-risk allowlist | `allow` | `ask-user` or `deny` |
| `allow` and exact low-risk fingerprint | `allow` | `allow` for that one exact key only |
| any review-eligible result | `ask-user`, `deny`, `unavailable`, timeout, malformed output | existing safe `ask-user`/`deny` path |

An LLM `allow` can never widen a workspace, network, shell, tool, Goal, quota,
permission or sandbox scope. It cannot convert an untrusted task into a trusted
task. A user `allow` still cannot bypass server policy or sandbox readiness.

## 4. Review modes and configuration

The versioned non-secret settings contract is `llm-approval/v1`:

| Field | Values / rule |
| --- | --- |
| `enabled` | Boolean, default `false`. |
| `reviewerSource` | `same-as-run` (default when enabled) or `dedicated`. |
| `dedicatedProfileId` | Optional non-secret model-profile ID; required only for `dedicated`. |
| `posture` | `off`, `advisory-low-risk`, or `bounded-auto-low-risk`; default `off` during migration. |
| `maxLatencyMs` | Bounded integer, default 1500, hard range 250–5000. |
| `maxRequestBytes` | Bounded request budget; no unbounded prompt forwarding. |
| `maxResponseBytes` | Bounded response budget; strict schema parsing is mandatory. |
| `cacheTtlMs` | Short bounded TTL for the exact approval key; default 0 for no cache. |
| `policyRevision` | Server-owned revision captured in every new run snapshot. |

`same-as-run` uses the immutable provider/model snapshot captured when the run
starts. Changing model settings cannot change the reviewer for an in-flight
run. `dedicated` uses the existing model-provider profile and secret-reference
boundary; it does not introduce a second credential store. A dedicated reviewer
must be explicitly probed and may be marked `degraded` without blocking ordinary
interactive runs.

The Web settings surface must explain that enabling review permits bounded
network/model calls and may incur provider cost. It must not present an
`Approve everything` switch.

## 5. Versioned contracts

The contracts package will define strict, versioned schemas for:

- `ApprovalReviewerSnapshot`: source, provider/model identity, descriptor and
  policy revisions, limits, status and captured-at time; no key or endpoint
  secret;
- `ApprovalReviewRequest`: run/turn/correlation IDs, exact approval key,
  bounded tool descriptor, risk class, task trust, permission/sandbox/network
  snapshot summaries and policy revision;
- `ApprovalReviewDecision`: `allow | ask-user | deny | unavailable`, stable
  reason code, bounded explanation, reviewer revision, latency, expiration and
  exact approval-key fingerprint;
- `LlmApprovalSettingsProjection`: enabled/source/posture, reviewer health,
  revision, last bounded latency/error code and next safe step;
- `ApprovalReviewEvent`: a bounded audit projection with idempotency key and
  no raw request/response payload.

Unknown fields, secret-shaped strings, absolute paths, unbounded text, raw
headers, environment values and arbitrary URLs must be rejected. `eventId` or
review idempotency collisions with different payloads are conflicts, not
overwrites.

## 6. Reviewer input and output boundary

The reviewer receives only a normalized, bounded safety summary:

- tool ID and immutable version;
- operation class and risk class;
- normalized argument fingerprint and bounded argument labels;
- workspace ID (not its root path);
- permission, sandbox, network and task-trust status;
- Goal/governed mode and bounded gate status, when applicable;
- policy/profile/reviewer revisions and request deadline.

The reviewer does not receive raw user prompt, full conversation history,
source files, tool output, shell command text, environment variables,
credentials, cookies, private keys or absolute paths. Any user/model content
that influenced the tool request is treated as untrusted input and cannot alter
the reviewer's system policy.

The model response must parse as a strict bounded object. Free-form text,
missing fields, unsupported decisions, excessive confidence values, prompt
injection attempts or a mismatched fingerprint produce `unavailable` and enter
the existing safe approval path. Chain-of-thought is neither requested nor
stored.

## 7. Runtime integration boundary

The first implementation must call the reviewer from the daemon application
service/ApprovalBroker boundary. It must not modify the AgentLoop core state
machine or `RunManager` default start behavior. The existing tool lifecycle and
event ordering remain authoritative.

Required runtime properties:

- reviewer calls are cancellable, time-bounded and output-bounded;
- one in-flight review per exact approval key; concurrent identical requests
  share only a bounded pending result and never share grants across sessions;
- the cache key includes tool/version, normalized argument fingerprint,
  workspace ID, permission/sandbox/network snapshot, policy revision and
  reviewer snapshot revision;
- cache entries expire with the shorter of the configured TTL and run/session
  lifetime; a policy, scope, trust or fingerprint change invalidates the entry;
- settings changes affect new runs only; a run stores an immutable reviewer
  snapshot or `disabled` state;
- reviewer failure never changes the original model/tool/approval error and
  never falls back from an unavailable sandbox to host execution;
- Goal quota, Gate, Scheduler, Approval, Sandbox and Workspace authorities are
  still consulted in their existing order.

## 8. Web UX

The conversation-first Settings sheet adds an Approval Review section:

- an explicit enable switch, default off;
- `Use current run model` as the default source when enabled;
- a separate reviewer-model selector for `dedicated` mode;
- health, revision, bounded latency, last safe error and a clear degraded/blocked
  next step;
- a plain-language description of what can be auto-approved and what always
  requires the user;
- per-run timeline metadata showing `reviewed`, `asked`, `denied` or
  `review-unavailable`, without exposing prompts, paths, commands or secrets;
- a visible “Review and allow once” / “Allow for this session” distinction
  using the existing ApprovalCard semantics.

Mobile, foldable and tablet layouts retain the primary approval action, reason,
expiry and revoke controls. The UI never treats an LLM decision as a green
security badge and never stores reviewer credentials in browser storage.

## 9. Failure, privacy and cost behavior

| Condition | Required behavior |
| --- | --- |
| Reviewer disabled | Do not create a provider, network request, child process or prompt mutation. Use existing deterministic approval. |
| Same-as-run snapshot unavailable | Mark reviewer unavailable; preserve the original run/provider behavior and use safe approval fallback. |
| Dedicated provider missing/unhealthy | Settings show `degraded`/`blocked`; review-dependent operations ask or deny; no host fallback. |
| Timeout, cancellation, 4xx/5xx, malformed JSON or schema mismatch | Bounded stable error code; no implicit retry of the tool call; existing ask/deny path. |
| Reviewer says `allow` for a policy-denied or changed fingerprint | Deny or ask according to deterministic policy; never widen scope. |
| Provider cost/latency budget exhausted | Stop review calls and surface a bounded degraded state; never loop or spend unboundedly. |
| Daemon restart/session revoke/policy revision change | Invalidate snapshots, cache and grants; no old decision is replayed. |

All audit and diagnostics fields are bounded and redacted. API keys, tokens,
private keys, full prompts, raw model responses and absolute paths are excluded
from settings, events, logs, Web state and evidence bundles.

## 10. Implementation phases

### 63-0: prerequisite and authority audit

Completed as a bounded authority audit in
[`spec63-0-prerequisite-audit-2026-08-05.md`](../reports/spec63-0-prerequisite-audit-2026-08-05.md).
Spec 48/59 approval boundaries, immutable model snapshots, event privacy and
the default interactive path were rechecked. The audit confirms that the
reviewer has no capability authority and that `run_events`, `goal_events`,
AgentLoop, RunManager, Scheduler, Approval, Sandbox and Workspace remain the
sole authorities in scope. No provider, route, event table or runtime behavior
was changed by 63-0.

### 63-1: contracts and Noop reviewer

Implemented in `packages/contracts/src/llm-approval.ts` and
`packages/agent/src/approval-review.ts`. The strict `llm-approval/v1`
contracts cover snapshots, bounded reviewer requests/decisions, settings
projection and audit projections. They reject unknown fields, secret-shaped
fields/values, environment/headers/raw content, arbitrary URLs, absolute paths
and unbounded text. Canonical JSON/SHA-256 fingerprints and an in-memory
event/idempotency ledger fail closed on payload conflicts. The migration
default is `enabled=false`, `status=disabled`, `posture=off`; the
`NoopApprovalReviewer` performs no provider, HTTP, subprocess or prompt call
and returns bounded `unavailable` decisions. Focused evidence is recorded in
[`spec63-1-contracts-noop-2026-08-05.md`](../reports/spec63-1-contracts-noop-2026-08-05.md).
No ApprovalBroker, AgentLoop, RunManager, Scheduler, Sandbox, Workspace or
event-authority behavior changes are included in this phase.

### 63-2: same-as-run reviewer adapter

Add a provider-port adapter that consumes only a frozen `ModelProviderSnapshot`,
uses bounded request/response limits and maps timeout, 4xx/5xx, malformed output
and cancellation to stable unavailable results.

### 63-3: dedicated reviewer settings

Persist only non-secret reviewer intent in `daemon_settings`; add authenticated
GET/PATCH/status/probe routes using the existing model-provider secret boundary.
Do not return credentials, endpoint secrets or absolute paths.

### 63-4: ApprovalBroker application integration

Integrate the reviewer as a second-stage bounded check for eligible low-risk
requests. Preserve exact-key/session/TTL semantics, deterministic policy
precedence, existing event authorities and interactive run behavior.

### 63-5: Web settings and approval explanation

Add the Settings-sheet controls, status/degraded states and bounded timeline
projection. Test keyboard, screen-reader, mobile and foldable variants.

### 63-6: security, failure and concurrency evidence

Cover prompt injection, secret/path/raw-output redaction, fingerprint mismatch,
stale revision, duplicate review, concurrent identical requests, revoke,
restart, provider failure, timeout, cancellation and no-sandbox fail-closed
behavior.

### 63-7: explicitly authorized live reviewer smoke

Run a bounded, cost-limited smoke with either the current provider or a
dedicated reviewer. Reports may contain only provider/model identifiers,
decision/reason codes, latency and aggregate usage. Live evidence is separate
from unit fixtures and is not part of default `pnpm verify`.

## 11. Acceptance matrix

At minimum, tests must prove:

- disabled mode makes no model/HTTP/subprocess/prompt call;
- same-as-run and dedicated snapshots are immutable for in-flight runs;
- deterministic `deny`/`ask-user` always outrank an LLM `allow`;
- an LLM `allow` is accepted only for the exact bounded approval key;
- full-host, network, secrets, destructive operations and untrusted content are
  never auto-approved by the reviewer;
- timeout, 4xx/5xx, malformed JSON, schema mismatch and prompt injection fail
  closed without replaying the tool call;
- two concurrent requests cannot create two grants or share a foreign session;
- cache invalidates on policy/sandbox/workspace/trust/reviewer revision changes;
- user revoke, daemon restart and run terminal state invalidate review state;
- reviewer failure does not replace the original model/tool/approval error;
- Goal quota cannot bypass the existing Scheduler, Approval, Sandbox or
  WorkspaceRegistry;
- Web/API/events/logs/evidence contain no key, secret, raw prompt, raw output,
  command, environment value or absolute path;
- focused package gates, `pnpm test:workflow`, `pnpm verify`, diff checks and
  the opt-in live smoke remain distinct evidence classes.

## 12. Definition of Done

Spec 63 may be marked `Implemented` only when all of the following are true:

1. Contracts, Noop behavior, same-as-run and dedicated adapters have focused
   tests and typecheck evidence.
2. ApprovalBroker integration preserves deterministic authority, exact-key
   grants, session/TTL/revoke behavior and the default interactive route.
3. Web settings and per-run explanation are authenticated, accessible,
   responsive and secret-free.
4. Failure, concurrency, restart, privacy and cost limits have reproducible
   evidence.
5. An explicitly authorized live reviewer smoke is recorded separately from
   fixture evidence, with bounded redacted output.
6. Documentation, roadmap, implementation status and an ADR match the actual
   implementation; no README claim is promoted by the spec alone.

## 13. Explicit invariants

- `LLM allow` is advisory and never a capability grant.
- The most restrictive effective result wins.
- Reviewer source/model is frozen per run and changes affect new runs only.
- Reviewer unavailability is bounded degraded/ask/deny, never host fallback.
- Existing `run_events`/`goal_events`, AgentLoop, RunManager, Scheduler,
  Approval, Sandbox and WorkspaceRegistry remain the sole authorities in scope.
