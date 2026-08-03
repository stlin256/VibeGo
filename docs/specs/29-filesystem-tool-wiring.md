# Spec 29: Explicit filesystem tool wiring

Status: Implemented (MVP)

## Goal

Expose the already-tested filesystem adapters through the daemon only after an
explicit authenticated Web setting. This makes the local harness useful for
real coding tasks while preserving fail-closed behavior for untrusted content,
shell execution, external sandboxes, and unsupported workspace mappings.

## Safety contract

- The daemon starts with filesystem tools disabled. `GET/POST
  /api/v1/settings/tools` exposes and changes only safe metadata and an
  `filesystemEnabled` boolean; the setting is process-memory only and is never
  stored in EventStore or browser profile storage.
- Enabling the setting exposes only `filesystem.read@1.0.0` and
  `filesystem.write@1.0.0`. Shell, Git, MCP, Skill, network, and destructive
  host tools are not registered by this slice.
- The workspace root comes from the daemon's captured workspace registry and is
  represented in status by a safe label only. Unknown workspace ids fail
  safely without revealing absolute paths; there is no fallback to `default`.
- Every call still passes through `ToolExecutorRuntime`, `ToolRegistry`,
  `ApprovalPolicy`, `SandboxResolver`, and `PathGuard`. Read-only reads are
  allowed by policy; writes require the existing approval continuation. An
  untrusted task cannot fall back to host filesystem access and fails closed.
- The runtime is captured when a run starts. Disabling tools later affects new
  runs only; an in-flight run retains its explicit runtime snapshot.
- No absolute workspace path, environment snapshot, file content beyond the
  bounded tool output, or secret is written into status responses, URLs, or
  configuration persistence.

## API contract

`GET /api/v1/settings/tools` returns:

```json
{
  "filesystemEnabled": false,
  "workspaceLabel": "workspace",
  "availableTools": []
}
```

`POST /api/v1/settings/tools` accepts `{ "filesystemEnabled": boolean }` and
returns the same safe status. Both routes are authenticated on LAN and use the
existing CSRF/origin gate for the mutating request.

## Web behavior

The Settings panel presents a clear “Filesystem tools” toggle with the current
workspace label, explains that writes still require approval, and never asks
for or displays a private path outside the local settings flow. The toggle is
not written to the non-secret run profile so reset semantics remain separate.

## Acceptance tests

- Disabled status has no public tool descriptors and new runs receive no
  runtime; enabling exposes only the two filesystem descriptors.
- Read calls stay inside the guarded workspace; path traversal, symlink escape,
  and untrusted host fallback are rejected before handlers run.
- Workspace writes reach the existing approval broker and are not executed
  before an allow decision.
- Runtime enable/disable changes apply to new runs while captured in-flight
  snapshots remain stable.
- Authenticated API and Web tests never render or return absolute workspace
  paths, file contents, or secrets.

## Implementation evidence (2026-08-03)

- `InMemoryToolSettingsManager` builds the existing guarded filesystem runtime
  and keeps it disabled until `POST /api/v1/settings/tools` explicitly enables
  it.
- `RunManager` and `AgentLoop` capture per-run runtime snapshots, while the Web
  toggle, API, path/approval, untrusted fallback, and secret-free status tests
  cover the user-visible boundary.
- Shell, Git, MCP/Skill, network, and external sandbox tools remain unregistered
  in this slice; non-default workspace mapping is supplied by Spec 31 and is
  captured per run.
