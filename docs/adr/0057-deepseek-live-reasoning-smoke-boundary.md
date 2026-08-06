# ADR 0057: Explicit live DeepSeek reasoning smoke

- Status: Accepted for the bounded Spec 61-11 smoke slice
- Date: 2026-08-06
- Related: [Spec 61](../specs/61-deepseek-first-class-provider-integration.md),
  [ADR 0047](0047-deepseek-capability-probe-and-run-snapshot.md),
  [ADR 0056](0056-deepseek-live-search-smoke-boundary.md),
  [Spec 60](../specs/60-complete-verification-and-release-evidence.md)

## Context

The direct DeepSeek smoke already proves bounded text streaming, but it does
not prove that an endpoint actually supports provider-declared reasoning. A
model name or a requested `thinking` mode is not evidence of that capability.
Sending a high/max request before probing could spend quota and would make an
unsupported provider look healthy. Provider reasoning content is also private
model data and must not enter VibeGo events, Web responses, logs or evidence.

## Decision

Extend the existing `smoke:deepseek` runner with an explicit `reasoning`
scenario rather than adding another runner or changing AgentLoop:

1. The scenario is live-only and requires `--thinking high` or `--thinking
   max`; `off` and `auto` are rejected before credential lookup or network
   work.
2. After reading the credential from the named process environment variable,
   the runner probes the exact configured endpoint using `probeDeepSeek`.
   Execution proceeds only for a matching, ready
   `deepseek-provider-capability/v1` snapshot whose `reasoning` field is
   `true`. Missing, degraded, malformed or non-reasoning capability metadata
   returns `blocked` with `DEEPSEEK_THINKING_UNSUPPORTED` and never streams.
3. The existing `DeepSeekProvider` receives the immutable capability snapshot
   and requested high/max mode. It remains responsible for translating SSE
   reasoning events to no canonical output; the smoke report contains only
   mode, probe status/latency, bounded stream metrics, usage and stable error
   codes. No reasoning text, raw event payload, prompt, endpoint, header or
   credential is retained or printed.
4. The runner remains outside the daemon, Scheduler, ApprovalBroker, Sandbox,
   WorkspaceRegistry, `run_events` and `goal_events`. It does not create a
   second scheduler or event ledger, and it cannot claim harness or release
   readiness. Existing `text`, `cancel` and `timeout` scenarios retain their
   current behavior.

## Consequences

Reasoning compatibility becomes an opt-in, repeatable and fail-closed gate.
Unsupported endpoints are reported honestly without silently downgrading to a
different thinking mode. The default offline workflow and ordinary runs stay
unchanged; a user must explicitly authorize a real endpoint and spend the
provider quota needed for one bounded reasoning request. A healthy result is
evidence for the adapter boundary only, not proof that the full AgentLoop or
reviewer path exposes private reasoning.
