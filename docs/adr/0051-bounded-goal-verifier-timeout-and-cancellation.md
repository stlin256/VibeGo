# ADR 0051: bounded Goal verifier timeout and cancellation

- Status: Accepted for the bounded Spec 58-6 verifier runtime slice
- Date: 2026-08-06
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0050](0050-task-specific-goal-verifier-registry.md),
  [ADR 0038](0038-governed-terminal-writeback-and-recovery.md)

## Context

The task-specific `GoalVerifierRegistry` selects an explicit verifier, but the
writeback coordinator previously awaited `verify()` without a deadline. A
faulty or unavailable verifier could therefore keep a governed run's
reservation open indefinitely. This is a liveness and resource problem, not a
reason to change the AgentLoop or to let a verifier become an execution
authority.

## Decision

Add a daemon-owned, bounded timeout around `GoalRunVerifier.verify`. The
verifier port accepts an optional `AbortSignal`; the coordinator creates a
fresh controller for each terminal validation and aborts it when the bounded
deadline expires. The timeout is server-controlled (default 10 seconds,
minimum 100 ms, maximum 30 seconds) and cannot be enlarged by Web input.

If the deadline wins, or a verifier rejects/returns an invalid result, the
coordinator writes only bounded `inconclusive` evidence, releases the governed
quota reservation and leaves the Todo incomplete. A late verifier result is
ignored. Cooperative implementations should stop network, subprocess or
other work when the signal is aborted; non-cooperative implementations are
still isolated from Goal finalization by the timeout race.

The default daemon continues to use an empty verifier registry and the
fail-closed verifier. Interactive runs, `run_events`, `goal_events`,
AgentLoop, RunManager, Scheduler, Approval, Sandbox and WorkspaceRegistry are
unchanged. The timeout does not retry a verifier or replay a tool call.

## Consequences

- A stuck verifier cannot hold a reservation forever.
- Timeout/cancellation behavior is deterministic and auditable through bounded
  validation evidence, without persisting raw errors or verifier payloads.
- Cancellation is best-effort for third-party implementations; the writeback
  decision remains fail-closed even if a verifier ignores the signal.
- Semantic task validation and production verifier registration remain later
  Spec 58-6 work; this ADR does not claim that run completion proves a Todo.
