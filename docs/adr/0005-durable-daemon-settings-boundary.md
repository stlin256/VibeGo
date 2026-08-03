# ADR 0005：Daemon 非 secret 设置持久化边界

- Status: Accepted
- Date: 2026-08-03

## Context

Before this decision, the guided workspace registry was process-memory only. A
daemon restart discarded the user's workspace selector choices and forced a
repeat of the Web onboarding flow. Persisting every manager's state at once
would blur the boundary between durable settings, credentials, run events, and
Goal events.

## Decision

1. Add a small versioned `daemon_settings` table to the existing SQLite file.
2. Expose a synchronous `SettingsStore` port with bounded JSON values and
   secret-shaped field rejection.
3. Implement only workspace-registry persistence in Spec 36. The registry
   receives an injected persistence adapter and keeps its public status
   projection path-free.
4. Keep `run_events` and `goal_events` as their existing authorities; settings
   are not replayable domain events and do not participate in run admission.
5. Keep model API keys out of SQLite. Future credential persistence requires a
   separate OS-keyring design and review.
6. On restore or write failure, fail closed rather than silently mapping an
   unknown workspace to `default`.

## Consequences

- Users retain workspace selections across a local daemon restart.
- SQLite remains the only local persistence dependency; no service or queue is
  added.
- Absolute roots exist only in local daemon settings and runtime memory; API,
  browser storage, logs, SSE, Goal events, and run events remain path-free.
- Additional durable managers must define their own versioned spec instead of
  reusing the workspace payload or storing secrets in the generic table.

## Rejected alternatives

- Browser-only persistence: cannot restore daemon-machine roots and can become
  stale when several remote clients are used.
- `.env`/JSON/Markdown files: create a second mutable state source and require
  manual editing.
- `run_events` or `goal_events`: would contaminate domain authorities and make
  settings changes look like execution or Goal progress.
- Persisting API keys in SQLite: rejected until an OS keyring boundary exists.
