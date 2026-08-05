# Spec 63-7 reviewer event projection evidence

- Date: 2026-08-05
- Scope: independent approval-review event storage and bounded run projection
- Result: focused contract, storage, agent and daemon checks passed

## Implemented

- `ApprovalReviewEventDraftSchema` removes caller-owned `appendSequence`; the
  independent ledger assigns a monotonic sequence.
- `InMemoryApprovalReviewEventStore` and `SqliteApprovalReviewEventStore` own
  only `approval_review_events`. SQLite uses `BEGIN IMMEDIATE`, restart-safe
  sequence allocation, event-id/idempotency no-op and conflict behavior, and
  atomic batches. `run_events` remains a separate table.
- `ApprovalReviewBroker` emits bounded `review.requested`, terminal
  `review.completed`/`review.unavailable`, and disposal `review.revoked`
  drafts. Sink/storage failures are swallowed and cannot change deterministic
  ApprovalBroker behavior.
- `RunManager` writes the independent projection and a secret-free
  `run_events` UI projection. `GET /api/v1/runs/:runId/review-events` is an
  authenticated, bounded cursor endpoint; it never returns prompts, paths,
  credentials, raw model output or provider headers.

## Focused verification

```text
pnpm --filter @ready4vibe/contracts test --run src/llm-approval.test.ts      PASS (8 tests)
pnpm --filter @ready4vibe/storage typecheck                                  PASS
pnpm --filter @ready4vibe/storage test --run src/approval-review.test.ts     PASS (4 tests)
pnpm --filter @ready4vibe/agent typecheck                                    PASS
pnpm --filter @ready4vibe/agent test --run approval review fixtures          PASS (22 tests)
pnpm --filter @ready4vibe/daemon typecheck                                   PASS
pnpm --filter @ready4vibe/daemon test --run run-manager/server review slice  PASS (38 tests)
git diff --check                                                             PASS
```

## Boundary assertions

- No AgentLoop core state machine, RunManager default start semantics,
  Scheduler, ApprovalBroker authority, Sandbox, WorkspaceRegistry,
  `run_events` schema or `goal_events` authority was replaced.
- Reviewer event payloads contain only stable IDs/fingerprints, revisions,
  bounded decision/reason/latency/expiry and timestamps. Event sink failure,
  provider rejection, timeout, cancellation and disposal retain the normal
  user approval path.
- The live provider smoke remains an explicitly authorized, opt-in command and
  is not claimed by this fixture evidence.
