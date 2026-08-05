# ADR 0048: DeepSeek application capability boundary

- Status: Accepted for the bounded Spec 61-8 slice
- Date: 2026-08-06
- Related: [Spec 61](../specs/61-deepseek-first-class-provider-integration.md),
  [ADR 0047](0047-deepseek-capability-probe-and-run-snapshot.md),
  [Spec 03](../specs/03-model-context-contract.md)

## Context

The DeepSeek package already validates capability metadata, translates provider
events and maps provider-owned search results. The daemon still needs one
application-owned boundary that can consume the immutable run snapshot without
adding provider-specific branches to AgentLoop or letting search inherit
generic network access.

## Decision

Add an injectable `DeepSeekApplicationCapabilityService` in the daemon. It:

1. validates the generic provider snapshot, DeepSeek run snapshot and matching
   ready capability snapshot;
2. resolves thinking mode and tool-calling eligibility from captured metadata;
3. gates provider-owned search on the Responses profile, the captured search
   capability, enabled network and explicit approval;
4. maps only strict, bounded search responses to untrusted retrieval context and
   runs them through a bounded `ContextManager` projection.

The service is a pure application port. It has no HTTP client, credential,
subprocess, scheduler, approval store, sandbox executor, Goal writer or event
authority. It returns degraded/blocked results instead of widening scope. The
existing AgentLoop, RunManager default start path, Scheduler, Approval,
Sandbox, WorkspaceRegistry, `run_events` and `goal_events` remain authoritative.

## Consequences

Provider-specific capability decisions become testable at the daemon boundary,
and future search/reasoning wiring can be added without changing the core loop.
The slice does not claim that a live DeepSeek endpoint supports search or
reasoning; those claims still require explicit opt-in evidence and the Spec 60
release gates.
