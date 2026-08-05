# ADR 0046: Dedicated reviewer provider injection boundary

- Status: Accepted for the 63-8 adapter seam
- Date: 2026-08-06
- Related: [Spec 63](../specs/63-llm-assisted-approval-and-review.md),
  [ADR 0044](0044-llm-assisted-approval-review-boundary.md),
  [ADR 0045](0045-deepseek-provider-clean-room-boundary.md)

## Context

Spec 63 already supports a same-as-run reviewer and persists a non-secret
`dedicatedProfileId`, but the daemon does not yet have a multi-profile secret
resolver. Treating that id as an instruction to reuse the active run provider
would violate snapshot isolation and could silently use the wrong credential.

## Decision

Add a small, explicit application port for a dedicated reviewer binding. The
caller supplies a validated, immutable `ModelProviderSnapshot` and a runtime
`ModelProvider` resolved from the existing daemon-owned model/secret boundary.
The generic bounded reviewer adapter accepts `reviewerSource=dedicated` only
when a non-empty profile id and matching provider snapshot are present. It
shares the same normalized safety request, byte/latency limits, strict model
response schema, exact-key fingerprint check and fail-closed mapping as the
same-as-run adapter.

The default daemon wiring does not provide a resolver. Unknown, stale,
credential-missing or provider-mismatched bindings therefore return no binding
and the existing deterministic ApprovalBroker path remains authoritative. No
new credential store, scheduler, event table, AgentLoop transition, browser
secret or automatic fallback is introduced.

## Consequences

- Dedicated mode has a real, testable injection seam without claiming that
  multi-profile persistence or live dedicated smoke is complete.
- Settings can continue to report `degraded` until a reviewed resolver is
  wired to a provider profile and secret reference.
- A future resolver can be added independently and must freeze its binding per
  run; changing settings affects only later runs.
