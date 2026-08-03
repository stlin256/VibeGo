# Spec 36：Durable non-secret workspace settings

**Status: Implemented**

**Date: 2026-08-03**

## Goal

Make the existing guided workspace selector survive a daemon restart without
asking users to edit `.env`, YAML, JSON, PEM, or SQLite files. This slice adds a
small SQLite settings adapter for the workspace registry only; it does not turn
the settings table into a second event log.

## Scope

- Add a versioned `daemon_settings` table in the existing SQLite database.
- Persist only non-secret workspace registration metadata: workspace id, label,
  and the daemon-local normalized root path.
- Restore custom workspaces before the daemon accepts requests; if persisted
  settings are malformed or a path no longer resolves to a directory, fail
  closed instead of silently falling back to `default`.
- Keep `GET/POST/DELETE /api/v1/workspaces` and the Web selector unchanged.
- Use `BEGIN IMMEDIATE` for writes and bounded JSON for the settings value.
- Keep the root path private to the daemon. It must not appear in status, API
  errors, events, SSE, logs, browser storage, or Goal state.

## Storage boundary

`daemon_settings` is separate from both `run_events` and `goal_events`:

```text
events.sqlite
  run_events          # run authority, unchanged
  goal_events         # Goal authority, unchanged
  daemon_settings     # versioned non-secret settings, not an event stream
```

The generic settings port rejects secret-shaped object keys (`apiKey`, token,
private key, password, environment values, and similar) and non-JSON or
over-sized values. Workspace paths are an explicitly local setting because the
daemon must resolve them; the public status projection still omits them.

The model API key is not part of this slice and must never be persisted by the
settings adapter. Model credentials remain in the existing process-memory or
environment boundary.

## Runtime behavior

1. The daemon opens the existing SQLite file and creates `daemon_settings` if it
   is missing.
2. The workspace registry creates its protected `default` entry and restores
   custom entries through an injected persistence port.
3. Add/remove operations update the registry and settings row atomically from
   the caller's perspective; a failed write rolls the in-memory mutation back.
4. A run captures the resolved workspace root exactly as before. Removing a
   workspace affects only future runs.
5. Closing/reopening the database restores the same safe ids and labels without
   exposing the stored roots.

## Security and privacy constraints

- The settings table is local daemon state, never a Goal or run event source.
- No API key, private key, bearer token, CSRF token, environment value, file
  contents, transcript, or tool output may enter the settings value.
- API responses and error messages remain path-free.
- A corrupt or stale persisted entry fails closed; no unknown workspace falls
  back to `default`.
- This slice does not add a settings API that returns raw stored values.

## Tests and exit gate

- SQLite get/set/reopen, bounded JSON, secret-shaped rejection, transaction
  rollback, and close behavior are covered.
- Workspace registry tests cover restore, add/remove persistence, rollback on a
  failed save, and path-free status.
- The daemon persistence adapter tests cover schema/version validation and do
  not expose an absolute path in its public projection.
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check`, and `git diff --check` pass.

## Implementation evidence (2026-08-03)

- `packages/storage` provides the bounded `SettingsStore` port and SQLite
  `daemon_settings` table with `BEGIN IMMEDIATE`, close/reopen, transaction,
  and secret-shaped field guards.
- `packages/workspaces` restores custom entries through an injected port and
  rolls back add/remove mutations when persistence fails.
- `apps/daemon` wires the adapter to the existing `events.sqlite` file before
  the HTTP listener starts; the authenticated workspace API remains path-free.
- `run_events`, `goal_events`, AgentLoop, RunManager, Scheduler, Approval,
  Sandbox, and default unbound run admission were not changed.

## Explicitly deferred

- Persisting model API keys or introducing an OS keyring.
- Persisting Goal write state through this table.
- Persisting arbitrary tool or sandbox policy without a separate versioned spec.
- Cloud sync, multi-user settings, Tailscale/SSH settings, and certificate/ACME
  material.
