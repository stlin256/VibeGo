# Spec 63-3 reviewer settings evidence

Date: 2026-08-05

## Implemented

- `packages/contracts/src/llm-approval.ts` now defines the strict durable
  `ApprovalReviewSettings` and partial patch contracts. Only enabled/source/
  posture/profile id/limits/revision metadata are representable; credentials,
  endpoints, headers, environment values and paths are not.
- `apps/daemon/src/approval-review-settings.ts` adds a SQLite/InMemory
  `daemon_settings` manager with migration default `enabled=false`,
  `reviewerSource=same-as-run`, `posture=off`, bounded limits and optimistic
  `reviewerRevision` fencing. Enabling without an explicit posture selects
  `advisory-low-risk`; disabling always returns `posture=off`.
- Policy revision changes are blocked until an explicit settings patch refreshes
  the snapshot. `dedicated` without a profile is blocked; a configured
  dedicated profile is degraded until a provider-backed probe is available.
  The 63-3 probe is local validation only and performs no network, provider or
  subprocess operation.
- The authenticated daemon exposes `GET/PATCH /api/v1/settings/llm-approval`
  and `POST /api/v1/settings/llm-approval/probe`. Responses are the bounded
  projection only and never return secret-shaped values or endpoint data.

## Focused verification

```text
node node_modules/typescript/bin/tsc -p packages/contracts        PASS
node node_modules/typescript/bin/tsc -p apps/daemon --noEmit      PASS
vitest approval-review-settings.test.ts                           6/6 PASS
vitest server.test.ts                                             35/35 PASS
git diff --check                                                   PASS
```

The fixtures cover defaults, enable/disable behavior, stale revision and
policy revision fencing, dedicated profile degradation, SQLite restart
recovery, privacy rejection and the daemon API route. No ApprovalBroker,
AgentLoop, RunManager, Scheduler, Sandbox, WorkspaceRegistry, `run_events` or
`goal_events` behavior is changed.

## Not claimed

Dedicated provider selection/probe, same-as-run snapshot wiring into new runs,
ApprovalBroker intersection, Web Settings controls, durable reviewer events,
cache/TTL/revoke behavior and live reviewer evidence remain later Spec 63
phases.
