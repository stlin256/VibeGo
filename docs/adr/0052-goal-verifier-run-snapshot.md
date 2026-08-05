# ADR 0052: freeze the Goal verifier snapshot per governed run

- Status: Accepted for the bounded Spec 58-6 verifier snapshot slice
- Date: 2026-08-06
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0050](0050-task-specific-goal-verifier-registry.md),
  [ADR 0051](0051-bounded-goal-verifier-timeout-and-cancellation.md)

## Context

The task-specific registry is mutable so a daemon can replace a verifier with
a newer revision. Resolving the registry only after a run reaches a terminal
state would let an in-flight governed run silently switch verifier identity or
revision. That violates the run-snapshot rule and makes writeback results
dependent on timing.

## Decision

When `GoalRunWritebackService.registerBinding` is called (before the governed
run can emit its first event), it asynchronously captures the authoritative
Todo task class and the registry resolution. Terminal processing waits for
that capture and uses the captured descriptor/implementation; it never
re-resolves a mutable registry for that run. A missing, blocked, stale or
unavailable capture remains fail-closed and produces bounded `inconclusive`
evidence. The capture contains only the descriptor and an in-process verifier
reference; no prompt, output, tool, path, credential or event payload is
stored.

If a registry revision changes after capture, later governed runs use the new
revision while the existing run continues with its frozen snapshot. Duplicate
terminal notifications reuse the already-written validation evidence and do
not invoke either snapshot again. The default daemon has no registry and keeps
the existing fail-closed verifier behavior.

## Consequences

- Verifier identity and revision are deterministic for each governed run.
- Registry updates are safe for future runs without affecting in-flight work.
- A temporary Goal projection/store failure at capture fails closed rather
  than falling back to a different verifier.
- No AgentLoop, RunManager, Scheduler, Approval, Sandbox, WorkspaceRegistry or
  event-authority behavior changes.

## Implementation evidence

The writeback coordinator now captures the registry resolution when a binding
is registered (the governed admission boundary supplies the authoritative
Todo task class) and passes that promise through terminal reconciliation. A
focused daemon fixture updates the registry from revision 1 to revision 2
while a run is in flight and proves that revision 1 is invoked once; duplicate
terminal notifications reuse the persisted evidence.
