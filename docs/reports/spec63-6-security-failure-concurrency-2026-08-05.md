# Spec 63-6 security, failure and concurrency evidence

- Date: 2026-08-05
- Scope: reviewer adapter and ApprovalReviewBroker fail-closed evidence
- Result: focused package and daemon checks passed

## Evidence added

- Same-as-run adapter fixtures cover prompt-injection-shaped tool summaries,
  fixed reviewer policy text, empty tool definitions, disabled/stale/ineligible
  requests, blocked sandbox, enabled network, provider errors, malformed JSON,
  schema mismatch, exact fingerprint mismatch, response byte limits, timeout
  and caller cancellation. Ineligible requests make zero provider calls.
- Broker fixtures cover exact same-run sharing, run isolation, deterministic
  user approval fallback, scope-aware cache invalidation, bounded TTL expiry,
  in-flight disposal and terminal/restart cleanup. Disposal aborts the review
  state and leaves the delegate approval as the only decision path.
- Existing daemon fixtures continue to cover immutable run snapshots, settings
  revision fencing, binding failure fallback, normal `approval.required` /
  `approval.decided` events, authenticated settings routes and secret-free
  projections.

## Focused verification

```text
pnpm --filter @ready4vibe/agent typecheck                         PASS
pnpm --filter @ready4vibe/agent test --run \
  src/approval-review-adapter.test.ts \
  src/approval-review-broker.test.ts                             PASS (15 tests)
pnpm --filter @ready4vibe/daemon test --run \
  src/run-manager-approval-review.test.ts \
  src/approval-review-runtime.test.ts \
  src/approval-review-settings.test.ts \
  src/server.test.ts                                             PASS (47 tests)
git diff --check                                                  PASS
```

## Boundary assertions

- No AgentLoop core state machine, RunManager default start behavior, Scheduler,
  ApprovalBroker authority, Sandbox, WorkspaceRegistry, `run_events` or
  `goal_events` schema was changed.
- Reviewer input remains bounded normalized metadata. Tests do not permit
  prompts, transcripts, commands, raw tool output, environment values,
  credentials or absolute host paths to cross the adapter boundary.
- Reviewer timeout, cancellation, malformed output, provider failure and stale
  or ineligible scope never replay a tool call, widen a capability or create a
  foreign-session grant. The normal user approval path remains available.

## Remaining Spec 63 work

Durable reviewer event projection/storage, a dedicated provider-backed reviewer
and explicitly authorized live smoke remain 63-7/later work. This report is
fixture evidence only and makes no live provider or production-readiness claim.
