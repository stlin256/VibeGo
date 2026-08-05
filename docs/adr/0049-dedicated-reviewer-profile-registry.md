# ADR 0049: Daemon-owned dedicated reviewer profile registry

- Status: Accepted for the bounded Spec 63-9 resolver slice
- Date: 2026-08-06
- Related: [Spec 63](../specs/63-llm-assisted-approval-and-review.md),
  [ADR 0046](0046-dedicated-reviewer-provider-injection.md),
  [ADR 0032](0032-durable-model-endpoint-profile.md)

## Context

The 63-8 adapter introduced an explicit dedicated reviewer binding port, but
the production daemon intentionally supplied no resolver. Persisting a key or
silently reusing the active run provider would violate the credential and
snapshot boundaries. A bounded profile registry is needed before a dedicated
reviewer can be selected in a real daemon run.

## Decision

Add a small daemon-owned `DedicatedReviewerProfilesManager` that stores up to a
bounded number of validated non-secret profile records through the existing
`SettingsStore`. Each record contains only an opaque profile id, provider id,
complete HTTPS endpoint, model name, profile revision and timestamp. The
write-only configure command accepts an API key only in the current process;
the manager constructs an `OpenAICompatibleProvider` in memory and keeps no
durable credential. On restart, metadata is retained but the runtime binding is
absent until the user configures the credential again.

The manager implements the existing `dedicatedResolver` port. Resolution is
explicitly keyed by the requested profile id and returns a fresh immutable
`ModelProviderSnapshot` plus the matching runtime provider. Unknown ids,
missing credentials, stale revisions and provider/snapshot mismatches fail
closed. The resolver is called while a run binding is captured, so settings
changes cannot mutate an in-flight run. A bounded authenticated status API
exposes only profile metadata and credential availability; no endpoint secret,
key, header, raw provider response or absolute path is returned.

No second credential store, scheduler, event table, AgentLoop transition,
ApprovalBroker authority or host fallback is introduced. Network health/live
provider smoke remains a separate explicit gate.

## Consequences

- Dedicated mode can resolve an explicitly configured profile without
  accidentally inheriting the current run provider.
- A daemon restart is fail-closed for dedicated review until the credential is
  supplied again.
- The registry is intentionally small and OpenAI-compatible first; additional
  provider adapters require their own contracts and focused evidence.
- `status=ready` describes local binding availability, not upstream health or
  release readiness.
