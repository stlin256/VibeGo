# ADR 0044: LLM-assisted approval review boundary

- Status: Accepted for staged implementation (63-7 durable event projection and
  same-as-run live smoke complete; dedicated provider/release evidence staged)
- Date: 2026-08-05
- Related: [Spec 63](../specs/63-llm-assisted-approval-and-review.md),
  [ADR 0003](0003-lan-access-and-codex-like-approval.md),
  [ADR 0040](0040-permission-profile-and-approval-contracts.md),
  [ADR 0042](0042-permission-settings-grants-and-run-snapshot.md)

## Context

VibeGo already has deterministic approval policy, permission profiles, exact
approval keys, session grants and sandbox/host boundaries. Low-risk coding
sessions can still produce repetitive prompts. An LLM may help classify those
requests, but allowing the model to become an authority would make prompt
injection, provider failure and model drift security boundaries.

## Decision

Add an optional LLM reviewer behind the daemon ApprovalBroker/application
boundary. The reviewer is advisory and may only narrow or confirm an operation
that deterministic policy has already classified as eligible. The existing
policy, Goal, Scheduler, Approval, Sandbox and Workspace authorities always
win.

The setting is migrated disabled. When explicitly enabled, `same-as-run` is the
default reviewer source and uses the run's frozen model/provider snapshot. A
user may select a dedicated model profile through the existing provider and
secret-reference boundary. Reviewer requests contain only bounded safety
metadata and exact fingerprints; they never contain secrets, paths, raw
transcripts, raw tool output or arbitrary commands.

Timeout, unavailable provider, malformed output, schema mismatch, stale
fingerprint or unsupported decisions enter the existing ask/deny path. No
reviewer failure may cause host fallback, hidden retry, capability widening or
a second scheduler/approval authority.

## Alternatives considered

1. **Let the LLM directly approve tools.** Rejected: it would make an
   untrusted, variable output an authority and could bypass policy or sandbox.
2. **Send the complete conversation to a reviewer.** Rejected: unnecessary
   privacy exposure and prompt-injection surface; bounded normalized metadata is
   sufficient.
3. **Use a mandatory dedicated reviewer service.** Rejected for the first
   slice: it would make ordinary runs depend on another service. Dedicated
   review remains optional, with same-as-run as the default source when enabled.
4. **Silently fall back to full-host when review is unavailable.** Rejected:
   unavailable review must degrade to deterministic ask/deny, never broaden
   execution.

## Consequences

- The feature can reduce low-risk approval friction without changing the
  security authority chain.
- It introduces bounded model latency and possible provider cost, so migration
  is off and settings must expose health and limits.
- New versioned contracts, snapshot fields, privacy tests, failure fixtures and
  Web status controls are required.
- Real reviewer behavior must be opt-in evidence and must never be confused
  with deterministic unit or workflow tests.

## 63-1 implementation checkpoint

The first slice now ships strict `llm-approval/v1` contracts and a
provider-free `NoopApprovalReviewer`. The default snapshot is disabled and
returns only a bounded `unavailable` decision; no provider, HTTP, subprocess,
prompt, ApprovalBroker, AgentLoop or event-authority path is invoked. Canonical
fingerprints and an in-memory idempotency ledger reject changed payloads for a
reused event or idempotency key. Same-as-run provider calls, dedicated settings
and ApprovalBroker intersection remain explicitly staged for 63-2 onward.

The 63-2 same-as-run adapter is now implemented as a provider-port boundary.
It validates and freezes the run snapshot, sends bounded normalized safety
metadata only, and maps provider failure, timeout, cancellation, malformed
output and fingerprint mismatch to `unavailable`. It still does not call the
ApprovalBroker or change the existing authority order; dedicated settings,
cache/revoke semantics and Web integration remain later stages.

The 63-3 settings slice persists only non-secret reviewer intent through the
existing `daemon_settings` boundary and exposes authenticated GET/PATCH/probe
routes. Revision and policy fencing fail closed; dedicated mode without a
profile is blocked and configured dedicated intent remains degraded until its
provider adapter exists. The probe is local validation only, so ordinary runs
remain independent of reviewer availability.

## 63-4 application integration checkpoint

The runtime slice now adds an application-owned `ApprovalReviewBroker` wrapper
around the existing ApprovalBroker. `RunManager` captures a frozen binding per
run, records the secret-free reviewer snapshot in `run.created` and
`RunSnapshot`, and keeps the bounded request context live only until terminal
cleanup before starting the unchanged AgentLoop. The wrapper is reached only after the
existing ToolRuntime has returned `APPROVAL_REQUIRED`; it cannot create a
capability, alter Scheduler/Sandbox/Workspace policy, or replace the delegate
broker.

For an exact, eligible low-risk request, a `bounded-auto-low-risk` reviewer
allow is applied by creating and immediately resolving the delegate's normal
approval entry. This preserves the delegate's decision/history semantics and
the existing `approval.required`/`approval.decided` event path. Advisory mode,
reviewer denial/unavailability, stale revisions, cancellation, or malformed
binding data leave the delegate pending for the user. The wrapper's bounded
in-flight/cache key includes the normalized request, reviewer/policy revisions
and run boundary; terminal cleanup and expiry invalidate it. No AgentLoop core
state transition, RunManager default behavior, run_events/goal_events schema,
or second scheduler/approval authority was introduced.

## 63-5 Web checkpoint

The conversation-first Web shell now exposes the authenticated reviewer
projection through typed API methods and an Approval Review Settings section.
It keeps the migration default off, renders dedicated mode as blocked/degraded
until its provider adapter exists, and sends only non-secret patches with the
daemon-owned expected revision. The UI explains the bounded low-risk scope and
does not present an `Approve everything` or session-grant action. Approval
cards and the run event timeline use bounded labels (`reviewed`, `asked`,
`denied`, `review-unavailable`) without exposing prompts, commands, paths,
credentials or raw model output. Responsive and accessibility fixtures cover
the existing ratio-first shell; durable reviewer event storage and live smoke
remain later phases.

## 63-6 security and concurrency evidence checkpoint

The completed evidence slice is test-only; no fixture demonstrated a concrete
boundary defect. Adapter tests must keep prompt-injection-shaped metadata,
secrets, paths and raw output out of provider inputs; broker tests must prove
exact-key isolation, bounded cache invalidation on scope/revision changes,
terminal/restart disposal and fail-closed timeout/cancellation/provider-error
behavior. No new scheduler, grant store, event table or AgentLoop state
transition was introduced by this checkpoint. Evidence is recorded in
`docs/reports/spec63-6-security-failure-concurrency-2026-08-05.md`.

## 63-7 durable reviewer-event projection checkpoint

Reviewer drafts now flow through an independent `approval_review_events`
ledger. SQLite owns its global append sequence, event-id/idempotency conflict
checks and atomic batches under `BEGIN IMMEDIATE`; the existing `run_events`
table remains untouched as an execution stream. The application emits a
secret-free run projection for the conversation timeline and exposes a
bounded authenticated read route, while storage/sink failure remains
best-effort and cannot alter ApprovalBroker decisions. Disposal records a
bounded `review.revoked` event and prevents stale in-flight completion from
being replayed. An explicitly authorized same-as-run smoke is also complete;
its redacted result and the strict reason-code prompt fix are recorded in
`docs/reports/spec63-7-live-review-smoke-2026-08-05.md`. Dedicated provider
live evidence remains opt-in and staged. Neither smoke nor storage fixtures
changes the existing authority chain. Evidence is recorded in
`docs/reports/spec63-7-review-events-2026-08-05.md`.
