# Spec 63-8 dedicated reviewer adapter evidence

- Date: 2026-08-06
- Scope: explicit dedicated provider/snapshot injection seam
- Result: focused Agent and daemon checks passed

## Evidence added

- `DedicatedApprovalReviewer` reuses the bounded provider adapter but accepts
  only `reviewerSource=dedicated` and an exact non-secret profile id.
- Provider id, model id and descriptor revision must match the supplied frozen
  `ModelProviderSnapshot`; mismatches fail before a provider call.
- `createApprovalReviewBinding` accepts a dedicated binding only from an
  explicit application resolver. No resolver, unknown profile, provider
  mismatch or malformed snapshot returns no binding and preserves the normal
  deterministic ApprovalBroker path.
- The main daemon intentionally supplies no resolver. Dedicated settings remain
  `degraded`; no second credential store, scheduler, approval authority or
  event table is created.

## Focused verification

```text
pnpm --filter @ready4vibe/agent typecheck                         PASS
pnpm --filter @ready4vibe/agent test                              PASS (47 tests)
pnpm --filter @ready4vibe/agent build                             PASS
pnpm --filter @ready4vibe/daemon typecheck                        PASS
pnpm --filter @ready4vibe/daemon exec vitest run \
  src/approval-review-runtime.test.ts                             PASS (6 tests)
git diff --check                                                  PASS
```

## Boundary assertions

- Same-as-run behavior, AgentLoop, RunManager default start, Scheduler,
  ApprovalBroker authority, Sandbox, WorkspaceRegistry, `run_events` and
  `goal_events` remain unchanged.
- The dedicated adapter sends the same normalized safety metadata and strict
  response contract; it never receives a prompt, transcript, raw tool output,
  command, environment value, credential or absolute path.
- This is injection/application fixture evidence only. Multi-profile durable
  provider resolution and dedicated live smoke remain staged under Spec 63.
