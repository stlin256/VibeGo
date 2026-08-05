# Spec 63-5 Web approval-review evidence

- Date: 2026-08-05
- Scope: authenticated Web settings projection, bounded approval explanation,
  timeline labels and ratio-first accessibility coverage
- Result: focused Web checks passed

## Delivered

- `ApiClient` exposes typed `GET/PATCH /api/v1/settings/llm-approval` and
  `POST /api/v1/settings/llm-approval/probe` helpers. The request fixture
  proves that only non-secret intent and the daemon revision fence are sent.
- The conversation-first Settings sheet contains an off-by-default Approval
  Review section. It supports same-as-run, a bounded dedicated profile ID,
  off/advisory/bounded-auto posture, bounded latency/byte/cache limits and
  health/revision/latency/error/next-step status.
- `RunSnapshot` accepts the secret-free reviewer snapshot captured at run
  creation. Approval cards and the run timeline render only the bounded
  `reviewed`, `asked`, `denied` and `review-unavailable` labels when matching
  reviewer event projections exist.
- The only approval action remains the authenticated one-time `/approve` path.
  The UI directs session-wide access to Permission settings and does not create
  a second grant mechanism.
- Existing width/aspect-ratio rules keep the new controls readable on wide and
  portrait desktop, tablet, phone, fold-cover/unfolded and tri-fold segments;
  controls retain keyboard focus, labelled radiogroups, status live regions and
  44px touch targets.

## Focused verification

```text
pnpm --filter @ready4vibe/web typecheck                         PASS
pnpm --filter @ready4vibe/web test --run \
  src/components/vibego/ApprovalReviewSettingsCard.test.tsx \
  src/components/vibego/ApprovalCard.test.tsx \
  src/App.test.tsx src/styles.test.ts                          PASS (39 tests)
pnpm --filter @ready4vibe/web test --run src/api.test.ts        PASS (28 tests)
git diff --check                                                PASS
```

The repository's existing device-matrix and style-contract fixtures remain
the source of truth for ratio coverage; no browser/device claim is made from a
static render alone.

## Boundaries and remaining work

- No API key, token, private key, endpoint credential, prompt, transcript, raw
  model response, command, tool output or absolute host path is accepted by
  the reviewer settings component or written to browser storage.
- The Web layer does not add a scheduler, policy authority, provider, grant
  store or second approval route. Existing runs keep their daemon-captured
  reviewer snapshot.
- Durable reviewer event storage/projection, dedicated provider execution and
  explicitly authorized live reviewer smoke remain Spec 63-6/63-7 work. Until
  those phases, missing reviewer events simply leave the normal approval card
  unchanged and provider failures remain fail-closed.
