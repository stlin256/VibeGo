# ADR 0036: Goal Control v1 domain contracts and replay boundary

- Status: Accepted for Spec 58-1
- Date: 2026-08-05
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [Spec 34](../specs/34-goal-control-plane-loopx-integration.md),
  [ADR 0004](0004-native-goal-control-and-loopx-interop.md)

## Context

The repository already has a strict Goal v0 event stream, deterministic
projection/replay, SQLite `goal_events`, and bounded mutation/read APIs. Spec
58 needs a governed execution vocabulary—binding, admission decision, quota
reservation and validation evidence—without invalidating existing v0 events or
making Goal Control a second execution runtime.

The next slice is intentionally a domain boundary. It must be useful to a
future daemon application service while remaining safe to replay, migrate and
test without starting a model, tool, shell, Git, MCP, Skill or sandbox.

## Decision

1. Add versioned v1 contracts additively. Existing v0 schemas and parsers stay
   valid; `GoalRunBindingV1Schema`, `GoalAdmissionDecisionV1Schema`,
   `GoalQuotaReservationV1Schema`, `GoalValidationEvidenceV1Schema` and
   `GoalRecoveryRecordV1Schema` carry explicit schema versions, bounded IDs/text,
   ISO timestamps, revisions and privacy-safe references.
2. Define a v1 Goal event envelope with `schemaVersion`, `eventId`,
   `controlRevision`, goal-local `appendSequence` for stored events and a
   deterministic fingerprint. Unknown event types, duplicate event IDs with
   changed content, secrets, environment values, raw outputs and absolute
   paths fail closed. Same event ID and same content is a no-op.
3. Keep `goal_events` independent from `run_events`. A mixed replay builder
   accepts legacy v0 events and additive v1 events in append order, produces a
   deterministic v1 projection/checksum, and never mutates the old projection
   contract. V0-only callers continue to use the existing builder unchanged.
4. Model quota as an explicit state machine:
   `reserved -> consumed | released | expired`. Reservation identity is
   `bindingId + attempt + turnKey`; consumption is exactly once per turn key.
   Scheduler capacity, Approval, Sandbox, Workspace and provider failures may
   release a reservation but cannot be bypassed by quota state.
5. Expose a pure Goal Control v1 write service for binding, admission,
   reservation, validation, recovery and handoff events. It uses optimistic
   `controlRevision`, per-goal serialization, request/event idempotency and
   fail-closed stale/duplicate transitions. It has no execution side effects.
6. Keep v1 application wiring opt-in and out of the default `RunManager.start`
   path. Durable storage may replay the new envelope, but no second scheduler,
   LoopX runtime, Markdown/JSONL state, POSIX lock or host bridge is added.

## Consequences

- Hidden or future application services can depend on a stable v1 contract
  without coupling to the v0 event payloads.
- V0 history can be replayed before v1 events, so migration is additive and
  checksums remain deterministic.
- Reservation and validation transitions are auditable and testable before
  governed admission exists.
- The slice does not claim governed execution, terminal-run verification,
  recovery reconciliation or Web Goal workflow; those remain Spec 58-2 onward.

## Test boundary

The implementation must cover strict/unknown-event rejection, privacy/path
rejection, v0-to-v1 replay, deterministic checksum, event idempotency/conflict,
optimistic stale revision, reservation transition/exactly-once consume,
validated-evidence gating, recovery attempt isolation and bounded handoff
events. Tests must not start a real provider, process, shell, MCP server or
sandbox.
