# Spec 31: Guided workspace registry

Status: Implemented (MVP slice)

## Goal

Replace the current `workspaceId=default` placeholder with a small daemon-owned
workspace registry. Users select a named workspace from the Web Settings panel
and can explicitly add or remove mappings without editing `.env`, YAML, or JSON.
The registry is single-user. Spec 31 established the process-memory boundary;
Spec 36 adds an injected SQLite adapter for durable non-secret workspace
registrations without changing the public API.

## Safety contract

- The daemon always starts with one `default` workspace rooted at its captured
  working directory. The root is never returned by an API, written to an event,
  included in SSE, logged, or stored in browser preferences.
- Adding a workspace is an authenticated, CSRF-protected operation and requires
  an explicit `confirmation: "add-workspace"` value. The submitted path is used
  only inside the daemon process to construct guarded runtimes.
- Workspace ids are stable, short, and allowlist-shaped (`[a-z0-9][a-z0-9_-]{0,63}`).
  `default` cannot be removed or overwritten. Duplicate ids fail closed.
- A path must resolve to an existing directory. The registry stores the
  normalized absolute path in daemon-local memory and, when Spec 36 persistence
  is enabled, in the private `daemon_settings` table; all tool execution still
  re-validates descendants with `PathGuard` and applies the existing approval,
  sandbox, and scheduler boundaries.
- Removing a workspace affects new runs only. A run captures its runtime and
  workspace root at start; an in-flight run remains cancellable and is not
  rebound to another directory.
- The status shape contains only `id`, a display label, and safe capability
  flags. It does not contain absolute paths, environment values, file contents,
  credentials, or filesystem listings.
- Unknown or removed workspace ids are rejected before a run is queued. There
  is no fallback to `default`, process cwd, or host shell execution.

## API boundary

Authenticated routes under `/api/v1`:

- `GET /workspaces` returns `{ workspaces: WorkspaceStatus[] }`.
- `POST /workspaces` accepts `{ id, path, label?, confirmation }` and returns
  the safe status list. `path` is the daemon-machine path supplied by the user;
  it is never echoed back.
- `DELETE /workspaces/:id` removes a non-default mapping and returns the safe
  status list. The default workspace returns `409 WORKSPACE_PROTECTED`.

Invalid ids, missing directories, duplicate ids, and malformed confirmations
return stable `400`/`409` errors with no path details. All mutating routes use
the existing Origin/CSRF and single-user pairing gate; query tokens remain
forbidden.

## Guided Web behavior

The Settings panel must:

1. show a workspace selector instead of a free-form `workspaceId` field;
2. explain which entry is the daemon's default directory and that added paths
   are on the daemon machine;
3. provide an explicit Add workspace form with id, optional friendly label,
   path, and a confirmation checkbox; and
4. provide a remove action for non-default entries and refresh the selector
   after changes.

The run profile stores only the selected workspace id. It may be persisted in
browser storage because the id and label are non-secret; absolute paths and
the registry mutation payload are never persisted there.

## Runtime wiring

`WorkspaceRegistry` is an injected daemon port. Filesystem and external-shell
runtime factories resolve a root from the registry at run start, then construct
their existing `PathGuard`/container mount for that root. The registry itself
does not execute commands, read files, or grant policy permissions.

## Acceptance tests

- Default listing is secret-free and includes only the captured default label.
- Add, duplicate, invalid-id, missing-directory, protected-remove, and remove
  flows are unit-tested without returning the submitted path.
- Authenticated API tests cover GET/POST/DELETE, CSRF/auth rejection, and
  query-token rejection.
- Web tests cover selector rendering, guided add/remove controls, and the fact
  that browser storage contains an id/profile but never a host path.
- Filesystem and external-shell runtime tests prove that each run resolves the
  selected root, unknown ids fail closed, and disabling/removing a workspace
  does not mutate an already captured runtime.
- Full typecheck, unit tests, diff check, and secret scan pass; tests do not
  invoke Docker/Podman or a real model provider.

## Explicitly deferred

Native OS directory pickers for remote browsers,
Git write/patch tools and the dedicated diff/log explorer, MCP/Skill activation,
public access, and Tailscale/SSH transport adapters remain separate milestones.

## Implementation evidence (2026-08-03)

- `packages/workspaces` provides the validated in-memory registry and safe
  status projection; its paths are never serialized by the status API.
- `apps/daemon` exposes authenticated GET/POST/DELETE workspace routes and
  rejects unknown run workspace ids before queueing. Filesystem and external
  shell factories resolve and capture the selected root per run.
- `apps/web` replaces the free-form id field with a selector and an explicit
  add/remove form. The API and React tests cover confirmation, path redaction,
  fallback selection, and secret-free browser persistence.
- Spec 36 wires the same registry port to a bounded SQLite settings adapter;
  restart tests prove custom ids/labels restore while absolute roots remain
  absent from the public status projection.
