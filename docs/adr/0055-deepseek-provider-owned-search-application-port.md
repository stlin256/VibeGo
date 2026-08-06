# ADR 0055: DeepSeek provider-owned search application port

- Status: Accepted for the bounded Spec 61-9 slice
- Date: 2026-08-06
- Related: [Spec 61](../specs/61-deepseek-first-class-provider-integration.md),
  [ADR 0048](0048-deepseek-application-capability-boundary.md),
  [Spec 03](../specs/03-model-context-contract.md)

## Context

The DeepSeek capability service can already decide whether provider-owned
search is eligible and can map a strict response into bounded retrieval
context. There is no safe application port for an actual provider request. A
generic tool registration would incorrectly make search inherit arbitrary
network or shell authority and would bypass the existing Approval, Sandbox and
Scheduler boundaries.

## Decision

Add a separate `DeepSeekSearchExecutor` contract in the DeepSeek adapter and an
optional executor dependency on `DeepSeekApplicationCapabilityService`.

1. The adapter accepts a complete validated Responses endpoint, runtime-only
   credential and an `AbortSignal`; it never appends paths or exposes headers.
2. The application service evaluates the immutable run snapshot, network mode
   and explicit approval before invoking the executor.
3. The executor returns only a strict `DeepSeekSearchResponse`; the service
   immediately maps it through the existing bounded ContextManager projection.
4. Missing executors, aborts, transport/HTTP errors, malformed payloads and
   budget overflow are degraded and produce no context. No transparent retry
   or replay is allowed after a request has started.
5. The default daemon does not construct this executor. A future application
   composition may inject one after real endpoint compatibility and live
   evidence are separately accepted.

The port does not modify `ModelProvider`, AgentLoop, RunManager default start,
Scheduler, ApprovalBroker, Sandbox, WorkspaceRegistry, `run_events` or
`goal_events`; those remain the authorities for model execution and tool
authorization.

## Consequences

Search wiring is testable without a live key and cannot silently widen generic
tool/network authority. The current product remains search-off by default and
fail-closed when the optional port is absent. Live DeepSeek search semantics,
provider response compatibility and release readiness remain unproven until an
explicit opt-in smoke is recorded.
