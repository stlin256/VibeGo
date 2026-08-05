# ADR 0053: bounded Goal verifier runtime contract

- Status: Accepted for the bounded Spec 58-6c contract slice
- Date: 2026-08-06
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0050](0050-task-specific-goal-verifier-registry.md),
  [ADR 0051](0051-bounded-goal-verifier-timeout-and-cancellation.md),
  [ADR 0052](0052-goal-verifier-run-snapshot.md)

## Context

The verifier registry and writeback timeout are bounded, but the verifier port
was represented only by TypeScript interfaces. That left the application
boundary without a versioned runtime parser, an explicit event-digest limit, or
a strict result parser. A future semantic verifier must not receive an
unbounded event list, prompt/transcript/model output, tool arguments, command,
path, environment value or credential. Invalid verifier results must remain
fail-closed and must never complete a Todo or consume quota.

## Decision

Add strict `GoalVerifierInputV1`, `GoalVerifierEventDigestV1` and
`GoalVerifierResultV1` Zod contracts in `packages/contracts`. The input contains
only the frozen Goal binding, authoritative automatic task class, run metadata,
one terminal digest and bounded run-event digests. The event list and output
byte count have server-owned limits; callers cannot enlarge them through Web or
Goal payloads. Unknown fields, malformed ids/timestamps, secret-shaped fields,
absolute paths and oversized values are rejected.

`GoalRunWritebackService` parses the input immediately before invoking a
selected verifier and parses its result before normalization. Parse failure
produces bounded `inconclusive` evidence with quota release. The existing
timeout, abort, descriptor id/revision match, duplicate-evidence and run
snapshot rules remain authoritative.

This is a contract and application-boundary hardening slice, not semantic proof.
The default daemon still registers no semantic verifier. The contracts do not
execute a model, tool, shell, filesystem, Git, MCP, Skill or sandbox and do not
modify AgentLoop, RunManager default start, Scheduler, Approval, Sandbox,
WorkspaceRegistry, `run_events` or `goal_events`.

## Consequences

- Future semantic verifiers have a stable, bounded, privacy-checked input/output
  port.
- Oversized or malformed runtime data fails closed instead of being truncated or
  silently interpreted.
- The current fixture/fail-closed verifier and ordinary interactive runs remain
  unchanged.
- Real task-specific semantic validation and release-level A–G evidence remain
  staged for a later explicit verifier profile and live gate.

