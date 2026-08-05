# Spec 63-2 same-as-run reviewer evidence

Date: 2026-08-05

## Implemented

- `ApprovalReviewModelOutputSchema` defines the strict bounded model response
  shape. Runtime metadata (policy/reviewer revision, latency, expiry and
  reviewed-at) is filled by the adapter rather than trusted from model output.
- `SameAsRunApprovalReviewer` consumes a validated, frozen
  `ModelProviderSnapshot` and a same-as-run `ApprovalReviewerSnapshot`.
- Only trusted-workspace, restricted-network, read/workspace-write requests in
  a ready read-only/workspace sandbox are eligible. Full-host, network,
  destructive, shell, unknown-risk, untrusted and unavailable-sandbox cases
  never call the provider.
- The model request contains only the bounded tool descriptor, fingerprints,
  workspace id and permission/sandbox/network/Goal summaries. It never sends
  the exact approval key, prompt, transcript, command, tool output,
  environment value, credential or absolute path.
- Request bytes, response bytes and latency are bounded. Provider errors,
  timeout, cancellation, malformed/incomplete streams, tool-call output,
  schema mismatch and exact-key fingerprint mismatch map to stable
  `unavailable` decisions without retrying or granting a capability.

## Focused verification

```text
node node_modules/typescript/bin/tsc -p packages/contracts        PASS
node node_modules/typescript/bin/tsc -p packages/agent --noEmit   PASS
vitest llm-approval.test.ts + approval-review.test.ts             11/11 PASS
vitest approval-review-adapter.test.ts                            5/5 PASS
git diff --check                                                   PASS
```

The adapter fixture covers provider HTTP-style errors, malformed JSON,
schema/fingerprint mismatch, cancellation, timeout, response limits,
ineligible requests, stale revisions and provider/model snapshot mismatch.

## Not claimed

No dedicated reviewer settings, ApprovalBroker intersection, cache/TTL/revoke
ledger integration, Web controls, durable event store or live provider smoke
is enabled by this slice. Existing AgentLoop, RunManager, Scheduler, Approval,
Sandbox, WorkspaceRegistry, `run_events` and `goal_events` remain unchanged.
