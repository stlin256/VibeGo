# ADR 0038: Governed terminal writeback and recovery

- Status: Accepted for Spec 58-3
- Date: 2026-08-05
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0036](0036-goal-control-v1-domain-and-replay-boundary.md),
  [ADR 0037](0037-governed-admission-application-boundary.md)

## Context

Spec 58-2 persists a governed admission and binding, then starts the existing
`RunManager`. It intentionally does not reserve delivery quota, validate a
terminal result, complete a Todo, reconcile a crash, or create a governed retry.
Those operations need one daemon application boundary without turning Goal
Control into an executor or changing the AgentLoop state machine.

## Decision

1. Add `GoalRunWritebackService` under `apps/daemon`. A governed binding is
   registered before `RunManager.start`; the service uses the existing
   `RunManager.subscribe` and `readEvents` ports to observe and replay terminal
   runs. Interactive runs without a Goal binding are ignored.
2. Add an injected `GoalRunVerifier` port. It receives a bounded run identity,
   binding snapshot and internal run-event read model, and returns only a
   versioned validation status (`validated`, `failed`, `inconclusive`, or
   `stale`), bounded summary, verifier revision and safe event references. The
   default composition is fail-closed and cannot treat model output as proof.
3. When enabled by the production delivery policy, governed admission reserves
   one bounded quota unit after binding and before run start. A start failure
   releases that reservation; a persisted binding/reservation with no run is a
   recoverable saga and does not silently spend quota.
4. Extend the pure v1 write service with one atomic
   `completeTodoAndConsumeQuota` operation. Under the existing per-Goal lock it
   validates the evidence, Todo, binding/attempt and reservation, then appends
   `todo.completed` and `quota.consumed` in one revision-checked batch. No other
   layer may perform those two transitions as independent writes.
5. Use deterministic event/evidence/reservation/recovery identities derived
   from Goal, binding, run, attempt and phase. The coordinator reads the v1
   projection before each write, making repeated terminal notifications and
   daemon restart replay no-ops; conflicting content or partial state fails
   closed.
6. Recovery reconciliation is read-only with respect to `run_events`: it may
   invoke the injected verifier and append bounded Goal evidence, but it never
   runs a model, tool, shell, Git, MCP, Skill, approval or sandbox operation.
7. Governed retry is an explicit application request that creates a fresh
   request id, run id, attempt, turn key, binding and reservation through the
   existing governed admission service. It never calls the legacy generic
   `RunManager.retryRecovered` path for a governed binding.

## Consequences

- Run terminal state remains authoritative in `run_events`; Goal state remains
  authoritative in `goal_events` and is linked only by bounded IDs/references.
- Validation failure, run failure, cancellation, timeout and restart recovery
  cannot complete a Todo or consume delivery quota.
- The writeback worker is asynchronous and bounded. A verifier or Goal storage
  failure does not rewrite or hide the original run outcome; the next
  reconciliation can retry from the durable events.
- A task-specific verifier and real governed provider evidence are still later
  acceptance work (Spec 58-5); this ADR does not promote fixture-only evidence
  to a stable release capability.

## Rejected alternatives

- Do not add validation decisions to the AgentLoop prompt or core state machine.
- Do not copy complete transcripts/tool outputs or absolute workspace paths into
  Goal events.
- Do not let quota replace Scheduler capacity, Approval, Sandbox or Workspace
  authority.
- Do not use a second scheduler, background queue service, LoopX runtime,
  JSONL/Markdown state file or automatic old-tool replay for recovery.
