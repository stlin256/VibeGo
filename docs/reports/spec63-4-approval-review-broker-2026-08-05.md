# Spec 63-4 ApprovalReviewBroker focused evidence

- Date: 2026-08-05
- Scope: application-layer reviewer integration only
- Status: passed focused fixtures; Web, durable reviewer events, dedicated
  provider selection and live smoke remain pending

## Implemented boundary

`packages/agent/src/approval-review-broker.ts` adds an
`ApprovalReviewBroker` wrapper around the existing `ApprovalBroker`. It first
creates the delegate's normal pending approval, then performs a bounded review
using a per-run immutable binding. Only an exact normalized fingerprint and
bounded safety metadata are sent to the reviewer. A reviewer allow is effective
only for `bounded-auto-low-risk`, trusted content, restricted network, ready
read/workspace-write sandbox and ready permission scope; it resolves the same
delegate entry through `decide('allow')`. Deny, unavailable, stale, malformed,
ineligible and cancelled outcomes leave the user approval pending.

`apps/daemon/src/approval-review-runtime.ts` constructs same-as-run bindings
only after the authenticated settings/policy, model snapshot and permission
snapshot are available. Missing or stale inputs return no binding. `RunManager`
records the secret-free reviewer snapshot in `run.created`/`RunSnapshot`,
registers the live binding before the unchanged `AgentLoop` starts and disposes
it at terminal cleanup. The migration default therefore remains the historical
direct broker path.

## Focused commands

The workspace bundled Node runtime was used because the interactive shell does
not expose `node` on PATH:

```text
pnpm --filter @ready4vibe/agent test
5 test files, 38 tests passed

pnpm --filter @ready4vibe/agent build
passed

pnpm --filter @ready4vibe/daemon test -- src/approval-review-runtime.test.ts src/run-manager-approval-review.test.ts
36 test files, 242 tests passed (the package script expands the focused
arguments to the daemon package suite)

pnpm --filter @ready4vibe/daemon typecheck
passed

git diff --check
passed
```

## Covered assertions

- disabled/no binding performs no reviewer work and preserves the delegate;
- same-run exact requests share one bounded in-flight/TTL review, while a
  different run cannot reuse it;
- advisory mode, reviewer denial, stale revisions and malformed bindings keep
  the normal user approval path;
- destructive/network/untrusted/full-host/no-ready-sandbox requests cannot be
  auto-resolved even if a fake reviewer returns `allow`;
- caller cancellation aborts the shared reviewer when no waiter remains and
  removes the delegate pending request;
- auto-allow retains `approval.required` and `approval.decided` events and
  invokes the existing runtime `approve` hook only after delegate resolution;
- normalized requests contain no prompt, transcript, command, raw argument,
  environment, credential or absolute path.

## Not claimed by this checkpoint

This evidence does not claim a dedicated provider adapter, Web settings/timeline
controls, durable reviewer event storage, live DeepSeek reviewer smoke, or the
full Spec 63 security/release evidence bundle. `run_events`, `goal_events`,
AgentLoop, Scheduler, Sandbox, WorkspaceRegistry and the existing ApprovalBroker
remain the authorities; no second scheduler or event table was added.
