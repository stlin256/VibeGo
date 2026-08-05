# Spec 63-0 prerequisite and authority audit

Date: 2026-08-05
Scope: approval/reviewer boundary before any provider or ApprovalBroker
integration.

## Confirmed authority matrix

| Boundary | Current authority | 63-1 action |
| --- | --- | --- |
| Model/provider selection | daemon model settings and immutable run snapshot | Contracts only; no provider call |
| Agent execution state | `AgentLoop` and `RunManager` | Unchanged |
| Scheduling/quota | `Scheduler` and Goal Control where explicitly invoked | Unchanged |
| Tool approval | deterministic policy and existing `ApprovalBroker` | No reviewer grant or bypass |
| Sandbox/workspace | Sandbox resolver/runtime and `WorkspaceRegistry` | Unchanged; no host fallback |
| Event facts | `run_events` and `goal_events` | No event table or event type change |
| Web/settings | authenticated daemon APIs | No route or browser state change |

## Required invariants carried into 63-1

- Migration default is disabled; ordinary interactive runs do not construct a
  provider, issue a network request, start a subprocess or mutate prompts.
- Reviewer output is advisory and cannot grant capability. The deterministic
  policy remains the first and final authority.
- Reviewer contracts contain only bounded metadata and exact fingerprints; they
  cannot represent raw prompts, transcripts, tool output, commands,
  environment values, credentials or absolute host paths.
- Event/idempotency payload conflicts fail closed and are never overwritten.

## Evidence

The contract and Noop implementation is recorded in
[`spec63-1-contracts-noop-2026-08-05.md`](spec63-1-contracts-noop-2026-08-05.md).
Focused contracts (109/109) and agent (26/26) tests pass, along with package
typechecks and `git diff --check`. Same-as-run provider calls, dedicated
settings, ApprovalBroker intersection, Web controls, durable event storage,
concurrency/revoke/restart evidence and live smoke remain out of scope for
63-0/63-1.
