# ADR 0047: Explicit DeepSeek capability probe and run snapshot propagation

- Status: Accepted for the bounded Spec 61 capability slice
- Date: 2026-08-06
- Related: [Spec 61](../specs/61-deepseek-first-class-provider-integration.md),
  [ADR 0045](0045-deepseek-provider-clean-room-boundary.md)

## Context

The DeepSeek adapter already has capability-gated thinking and provider-owned
search switches, but its probe previously returned `reasoning=false` and
`webSearch=false` unconditionally. A user could therefore complete an
explicit probe and still have no safe way to carry a provider-declared
capability into a run. The environment path also needed to reject a
provider-owned search configuration when no ready capability existed.

## Decision

1. A probe may consume capabilities only from an explicit,
   versioned `deepseek-provider-capabilities/v1` descriptor returned in the
   exact configured response. The descriptor is strict, bounded and
   secret/path-free. Missing descriptors remain conservative (`false` or
   `unknown`); malformed descriptors fail closed as
   `DEEPSEEK_PROTOCOL_UNSUPPORTED`.
2. `DeepSeekProvider` rejects `thinkingMode=high/max` and
   `webSearch=provider-owned` unless the caller supplies a matching ready
   capability snapshot. No capability is inferred from a model name or URL.
3. `InMemoryModelSettingsManager.bindRun` propagates the ready capability
   revision and booleans into the existing generic `ModelProviderSnapshot` and
   `DeepSeekRunSnapshot`. An unprobed run records the existing bounded
   `*-unprobed` revision and keeps reasoning/search false.
4. The capability snapshot is captured once per run. Settings/probe changes
   affect only later runs; no AgentLoop branch, scheduler, approval authority,
   sandbox, workspace registry or event table is introduced.

## Consequences

Explicit provider descriptors can unlock high/max thinking or provider-owned
search without silently broadening permissions. Providers that do not expose a
descriptor remain usable for ordinary text/tool runs, while unsupported
optional capabilities stay visibly unavailable. Real DeepSeek production
support still requires separately authorized live evidence.

## Implementation checkpoint

The slice is implemented with focused contract, adapter and daemon coverage.
The redacted evidence is recorded in
[`spec61-7-capability-snapshot-2026-08-06.md`](../reports/spec61-7-capability-snapshot-2026-08-06.md).
