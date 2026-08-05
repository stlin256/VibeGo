# ADR 0044: LLM-assisted approval review boundary

- Status: Accepted for staged implementation (63-1 complete; runtime slices pending)
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
