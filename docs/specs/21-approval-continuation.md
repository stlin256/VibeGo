# Spec 21: Approval continuation

**Status: Accepted (single-user in-memory MVP)**

## Goal

Complete the approval path after `approval.required`: show a safe pending
request, let the authenticated user allow or deny it, and resume the same tool
call without replaying the model turn or fabricating policy approval.

## State and safety

- `ApprovalBroker` owns pending decisions by opaque `approvalId`. The default
  single-user implementation is in-memory, bounded, and expires each request
  after 120 seconds. A daemon restart loses pending approvals; a future durable
  implementation must recover explicitly rather than auto-run a write.
- Pending payloads contain only run/turn/call ids, public tool id/version/risk,
  argument byte count, creation time, and expiry. They never contain raw JSON
  arguments, paths, environment values, tokens, or provider responses.
- A request may be decided once as `allow` or `deny`. Repeated decisions return
  `CONFLICT`; unknown/expired ids return `NOT_FOUND`/`CONFLICT` without changing
  the run.
- `allow` calls `ToolRuntime.approve`, which must update the same exact
  `ToolIntent` approval cache key, then retries the rejected tool once. The
  executor still rechecks registry, risk, sandbox, and handler constraints.
  If the runtime has no approval capability, the run remains fail-closed.
- `deny`, expiry, cancellation, and broker errors do not retry the tool. The
  loop writes `approval.decided` or `approval.expired` and a safe `run.failed`
  (or `run.cancelled` for cancellation).
- Waiting has a finite deadline and the scheduler lease remains observable in
  the snapshot. The daemon default uses the broker, while direct AgentLoop
  construction without one keeps the existing immediate fail-closed behavior.

## API/UI

- `GET /runs/:runId` adds a safe `approvals[]` summary.
- `POST /runs/:runId/approve` accepts `{ approvalId, decision: "allow" | "deny" }`.
  It is authenticated, CSRF/origin protected in LAN mode, and never accepts a
  token or decision in the URL.
- SSE carries `approval.required`, `approval.decided`, and `approval.expired`;
  the Web console renders an approval card with explicit Allow/Deny actions and
  refreshes the run snapshot after the decision.

## Tests and exit gate

- Broker tests cover expiry, cancellation, one-shot decisions, bounded pending
  state, and safe payloads.
- Agent/RunManager/server tests cover waiting, allow+retry, deny, expiry,
  cancel, endpoint authentication, idempotent rejection, and snapshots.
- Web API/component tests cover request shape, no URL token leakage, and both
  decision buttons.
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check`, and `git diff --check` pass
  before an independent commit and push.
