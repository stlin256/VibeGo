# Spec 63-9 dedicated reviewer profile resolver evidence

- Date: 2026-08-06
- Slice: daemon-owned non-secret profile registry and resolver
- Classification: focused fixture/application evidence, not live provider evidence
- Commit: recorded with the implementation commit

## Scope

`DedicatedReviewerProfilesManager` now stores a bounded list of validated
OpenAI-compatible reviewer profile metadata through the existing
`daemon_settings` adapter. The configure action accepts an API key only as a
write-only process input and constructs the runtime provider in memory. The
status, persistence value and resolver snapshot contain no key, header, raw
provider response, environment value or absolute path.

The production daemon passes the manager through the existing
`dedicatedResolver` port. Dedicated review is selected only by the exact
profile id stored in the approval-review settings snapshot. A restart restores
metadata as `credentialState=required`; it cannot silently reuse the active run
provider or an old credential.

## Focused commands

The following commands were run with the workspace bundled Node/pnpm runtime:

```text
pnpm --filter @ready4vibe/contracts build
pnpm --filter @ready4vibe/daemon build
pnpm --filter @ready4vibe/daemon exec vitest run src/approval-review-settings.test.ts src/approval-review-runtime.test.ts src/dedicated-reviewer-profiles.test.ts src/server.test.ts
```

Result: 57/57 focused daemon tests passed; contracts and daemon typecheck/build
passed.

## Covered cases

- strict profile metadata, endpoint, revision and profile-count bounds;
- unknown fields, API-key/token-shaped fields, query credentials and absolute
  paths rejected;
- metadata persists without the runtime key;
- restart returns `credentialState=required` and no resolver binding;
- two explicit profiles produce isolated provider/snapshot bindings;
- unknown profile, stale revision, provider mismatch and missing credential fail
  closed;
- status/configure/delete routes are bounded and do not echo the key;
- approval settings reports dedicated `ready` only when a local runtime
  binding exists, otherwise remains degraded;
- the dedicated binding is captured separately from the active run provider.

## Authority/privacy check

This slice does not modify the AgentLoop core state machine, RunManager default
interactive start path, Scheduler, deterministic ApprovalBroker authority,
Sandbox, WorkspaceRegistry, `run_events` or `goal_events`. It adds no network
probe, retry loop, child process, host fallback or live dedicated provider
claim. Dedicated upstream health, timeout/5xx/cancellation and cost evidence
remain an explicit opt-in live gate.
