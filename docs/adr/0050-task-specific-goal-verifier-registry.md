# ADR 0050: Task-specific Goal verifier registry

- Status: Accepted for the bounded Spec 58-6 registry slice
- Date: 2026-08-06
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0038](0038-governed-terminal-writeback-and-recovery.md),
  [ADR 0037](0037-governed-admission-application-boundary.md)

## Context

The governed terminal writeback path already has an injected fail-closed
`GoalRunVerifier`, but it has no explicit task-class selection boundary. A
future semantic verifier must not infer work from a prompt or model self-report,
silently reuse a different task's verifier, or make user-owned action/gate
Todos automatically complete.

## Decision

Add a small daemon-owned `GoalVerifierRegistry` application port. Each entry is
a strict `GoalVerifierDescriptorV1` plus an implementation of the existing
bounded verifier port. Entries are keyed by `advancement`, `monitor` or
`blocker`; `user_action` and `user_gate` have no automatic registry lane and
resolve fail-closed. Registration validates schema version, id/revision,
readiness status, privacy classification and bounded metadata. A task class may
have only one descriptor. Missing, duplicate, malformed, non-ready, stale or
mismatched entries never select a verifier.

`GoalRunWritebackService` derives the task class only from the authoritative
replayed Goal projection. The registry receives a bounded input containing the
binding, task class, run identity/status/output byte count and event digests;
there is no prompt, transcript, raw output, command, path, environment or
secret. A selected verifier result must carry the exact descriptor id and
revision. The service normalizes any other failure to bounded `inconclusive`
evidence, releases a reservation, and leaves Todo/quota state unchanged.

The default daemon intentionally supplies an empty registry. This preserves
existing governed fail-closed behavior and all unbound interactive behavior
until an explicit verifier profile is added in a later slice.

## Consequences

- Task-specific validation becomes explicit, inspectable and revision fenced.
- User action and user gate Todos cannot be silently auto-completed.
- Registry failures are safe but may leave governed work inconclusive until a
  valid verifier is configured.
- The registry does not execute work or become a second scheduler, event source,
  approval authority or sandbox boundary.
