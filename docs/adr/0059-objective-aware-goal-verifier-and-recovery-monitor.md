# ADR 0059: objective-aware Goal verification and recovery monitor

- Status: Accepted for the Spec 58 semantic-validation and monitor slice
- Date: 2026-08-06
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0038](0038-governed-terminal-writeback-and-recovery.md),
  [ADR 0050](0050-task-specific-goal-verifier-registry.md),
  [ADR 0054](0054-bounded-task-execution-verifier.md)

## Context

The existing `advancement` fixture proves only bounded execution evidence. A
completed run can therefore be mistaken for a completed objective unless a
Goal-owned acceptance contract is supplied. Restart reconciliation is also a
one-shot operation; no daemon-owned monitor continuously observes due Todos,
terminal recovery and blocked gates.

## Decision

1. Add an optional, versioned `GoalVerificationPlanV1` to a Todo. The plan is
   structured acceptance criteria: required/forbidden event types and a
   bounded minimum output byte threshold. It contains no prompt, transcript,
   command, path, environment or secret.
2. Extend the bounded verifier input with a privacy-checked
   `GoalObjectiveSnapshotV1`: Goal/Todo identity, bounded objective and Todo
   title, a deterministic SHA-256 objective digest and the frozen plan. The
   digest binds the snapshot to the authoritative Goal projection; the plan
   determines what evidence counts as satisfying the objective.
3. Register a daemon-owned deterministic objective criteria verifier for the
   automatic `advancement`, `monitor` and `blocker` lanes. It returns
   `validated` only when the frozen run is completed, the terminal event is
   successful, all plan requirements are present, no forbidden event exists,
   output meets the plan and the objective digest is correct. Missing plans,
   malformed snapshots or contradictory evidence return `inconclusive`.
   This is structured semantic validation, not an LLM self-report and not a
   second execution authority.
4. Add `GoalRecoveryMonitor` in the daemon application layer. Its serialized
   bounded tick first replays terminal/restart recovery through
   `GoalRunWritebackService.reconcile()`, then evaluates the existing pure
   `shouldRun` decision for every Goal. Production wiring supplies a narrow
   callback for a due Todo only when an existing governed binding and a valid
   claimed agent are available; it calls `retryGoverned`, which creates a fresh
   attempt through `GoalAdmissionService` and therefore the existing Scheduler,
   Approval, Sandbox, Workspace and quota gates. Missing bindings/claims are
   observed but not launched. The monitor never retries a successfully
   completed run whose semantic validation is inconclusive, never replays an
   old tool call, owns a queue, or creates a second scheduler.

The production registry now contains only this deterministic local verifier;
ordinary interactive/unbound runs never enter the registry. A governed Todo
without a verification plan remains fail-closed and cannot consume quota.

## Consequences

- Goal completion requires an explicit, replayable objective contract instead
  of a run-success heuristic.
- Criteria remain bounded and testable without exposing raw model/tool output;
  richer provider/LLM semantic review can be added later behind a new port.
- Recovery is idempotent and monitor ticks cannot overlap. Fresh retries use a
  new attempt/turn key through the existing admission path; a completed run
  with inconclusive objective evidence remains open for explicit operator
  action rather than causing an unbounded retry loop.
- No changes are made to AgentLoop core state, RunManager default start,
  Scheduler policy, Approval/Sandbox authorities, WorkspaceRegistry,
  `run_events` or `goal_events` ownership.
