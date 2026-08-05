# ADR 0054: bounded task execution-evidence verifier

- Status: Accepted for the bounded Spec 58-6d slice
- Date: 2026-08-06
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0050](0050-task-specific-goal-verifier-registry.md),
  [ADR 0051](0051-bounded-goal-verifier-timeout-and-cancellation.md),
  [ADR 0052](0052-goal-verifier-run-snapshot.md),
  [ADR 0053](0053-goal-verifier-bounded-runtime-contract.md)

## Context

The registry and runtime contract now provide a bounded port, but the default
daemon still has no concrete task verifier. The Harness fixture previously
returned `validated` without examining the run evidence. That is useful for
transport smoke tests, but it cannot be used as independent validation.

The current input intentionally contains event digests and aggregate output
bytes, not prompts, transcripts, model output, tool arguments, commands,
workspace paths or secrets. Therefore this slice can prove only a narrow
execution-evidence predicate. It must not be described as proof that a Goal's
semantic objective was achieved.

## Decision

Add a daemon-owned deterministic execution-evidence verifier for the explicit
`advancement` task lane. It returns `validated` only when all of the following
bounded facts hold:

1. the authoritative task class is `advancement`;
2. the frozen run status is `completed`;
3. the terminal digest is `run.completed`;
4. the digest list contains at least one `model.completed` event;
5. no `model.error`, `run.failed`, `run.cancelled`, `run.needs_recovery` or
   `run.status` terminal failure digest is present; and
6. the server-owned aggregate `outputBytes` is greater than zero.

Missing or contradictory evidence returns bounded `inconclusive`, never
`validated`. The result carries only the verifier id/revision, a bounded
summary and authoritative run/terminal references. An abort signal is checked
before evaluation and produces `inconclusive`.

The verifier is exposed through an explicit factory used by Harness fixtures;
the production daemon keeps its registry empty until a later, user-selected
semantic verifier profile exists. No verifier executes a model, tool, shell,
Git, MCP, Skill, filesystem operation or sandbox. No AgentLoop, RunManager,
Scheduler, Approval, Sandbox, WorkspaceRegistry, `run_events` or `goal_events`
authority changes.

## Consequences

- Harness governed evidence no longer relies on an unconditional success
  callback; it exercises an independent, deterministic predicate.
- The predicate is intentionally narrower than semantic Goal validation. A
  future objective-aware verifier must use a new versioned contract and remain
  fail-closed for missing evidence.
- Ordinary interactive runs and the default daemon remain unchanged.
- Failure, timeout, stale snapshot, malformed result and quota/writeback
  behavior continue to be owned by `GoalRunWritebackService`.
