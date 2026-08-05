# Spec 63-1 contracts and Noop reviewer evidence

Date: 2026-08-05
Scope: `llm-approval/v1` contracts, privacy validation, canonical fingerprints,
idempotency conflict handling and the default-disabled `NoopApprovalReviewer`.

## Implemented

- `packages/contracts/src/llm-approval.ts` defines strict schemas for the
  reviewer snapshot, bounded request, decision, settings projection and audit
  event.
- The contract privacy walk rejects secret-shaped fields/values, credentials,
  environment values, arbitrary URLs, absolute paths and control characters;
  strict objects reject unknown fields and bounded fields reject oversized
  content.
- `packages/agent/src/approval-review.ts` adds the provider-free
  `NoopApprovalReviewer`, deterministic canonical JSON/SHA-256 fingerprints and
  an in-memory event/idempotency ledger for focused tests. It is not an
  ApprovalBroker and grants no capability.
- The migration default is `enabled=false`, `status=disabled` and
  `posture=off`. The Noop reviewer performs no provider, HTTP, subprocess or
  prompt operation and returns a bounded `unavailable` decision.

## Focused verification

```text
node node_modules/typescript/bin/tsc -p packages/contracts        PASS
node node_modules/typescript/bin/tsc -p packages/agent            PASS
vitest packages/contracts/src/llm-approval.test.ts                6/6 PASS
vitest packages/agent/src/approval-review.test.ts                 4/4 PASS
git diff --check                                                  PASS
```

The test fixture covers unknown event/contract fields, secret/API-key-shaped
values, absolute paths, arbitrary URLs, bounded text, disabled no-op behavior,
stable fingerprints, same-content idempotent replay and conflicting event or
idempotency keys. No ApprovalBroker, AgentLoop, RunManager, Scheduler,
Sandbox, WorkspaceRegistry, `run_events` or `goal_events` path was changed.

## Not claimed

Same-as-run provider calls, dedicated reviewer settings, ApprovalBroker
intersection, Web controls, durable reviewer events, cache/TTL/revoke
integration and live reviewer evidence remain 63-2 through 63-7 work.
