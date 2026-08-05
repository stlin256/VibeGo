# ADR 0037: Governed admission application boundary

- Status: Accepted for Spec 58-2
- Date: 2026-08-05
- Related: [Spec 58](../specs/58-goal-control-and-harness-completion.md),
  [ADR 0036](0036-goal-control-v1-domain-and-replay-boundary.md),
  [Harness contracts](../harness-contracts.md)

## Context

Spec 58-1 closed the versioned Goal domain and replay boundary but deliberately
did not connect it to a run. The next slice needs a small, auditable daemon
application service without changing the default interactive path or creating
another scheduler/approval/sandbox runtime.

## Decision

1. Add `GoalAdmissionService` under `apps/daemon`. Its public request is an
   explicit `runMode: governed` envelope around the existing `RunConfig` plus
   bounded Goal identifiers, `agentId`, `turnKey`, expected control revision,
   attempt and request id. Missing `runMode` is never interpreted as governed.
2. Read and replay the Goal projection first. The service checks Goal status,
   blocking gates, Todo eligibility, claim owner/expiry, stale revision and
   already-spent turn keys before touching the run manager.
3. Resolve the existing capability profile snapshot and then call read-only
   readiness ports for Workspace, Scheduler, Approval and Sandbox. Scheduler
   capacity is inspected through the Scheduler authority; the service does not
   queue, lock or acquire a lease.
4. Persist an eligible admission decision and `GoalRunBinding` through the v1
   Goal write service, then invoke `RunManager.start` with the preallocated run
   id and the same capability snapshot. The default one-argument
   `RunManager.start` behavior remains unchanged.
5. No model, tool, shell, Git, MCP, Skill or sandbox operation is started by
   Goal Control. No quota is spent in this slice. A failure before
   `RunManager.start` must produce neither a model request nor `run.created`.
6. Binding revision fields use bounded revision tokens so string revisions
   such as `profile-1` and `daemon-policy-1` are not lossy-converted to
   integers. Existing numeric fixtures remain valid.
7. The v0 and v1 SQLite adapters may share `goal_events`: the v0 adapter
   filters v1 rows from legacy projection/replay and exposes a v0-only cursor,
   while refusing new legacy appends after a v1 row exists. The v1 adapter
   remains the authority for mixed replay and additive admission/binding
   events. This preserves legacy reads without allowing replay-order
   corruption.

## Consequences

- Governed admission is opt-in and can be tested with fake readiness ports
  without a provider or process.
- Binding persistence and run persistence are intentionally not one SQLite
  transaction. Spec 58-3 owns crash reconciliation and recovery attempts.
- A preflight race can still cause the authoritative Scheduler to queue or
  reject a run after inspection; the run manager remains the final authority.
- The existing interactive API and event sequence are preserved. Goal Control
  cannot silently throttle an unbound user run.
- A legacy Goal projection remains readable after an additive v1 admission or
  binding event; those v1 rows are intentionally visible only to the v1
  projection. Legacy writers fail closed once a v1 row exists rather than
  appending an event that would make mixed replay invalid.

## Rejected alternatives

- Do not add `runMode` to the core `RunConfig` contract; doing so would make
  legacy callers and the default route depend on Goal Control.
- Do not claim a Scheduler lease during preflight; that would create a second
  queue/lock protocol and leak resources on later failures.
- Do not auto-claim an unclaimed Todo in this slice. Claim tokens remain
  server-side and must be established by the existing Goal mutation boundary;
  governed admission fails closed when the claim is absent or stale.
