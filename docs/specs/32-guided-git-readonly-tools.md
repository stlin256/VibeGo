# Spec 32: Guided Git read-only tools

Status: Implemented (MVP slice)

## Goal

Make the harness useful for inspecting a coding workspace without turning Git
into an arbitrary shell. The authenticated Web Settings panel explicitly
enables three fixed read-only tools: `git.status`, `git.diff`, and `git.log`.
The first slice feeds their bounded results through the existing AgentLoop
tool/event path; a dedicated paginated diff/log explorer is a later UI slice.

## Safety contract

- Git tools are disabled at daemon startup and are never registered merely
  because a `git` executable is present. Enabling requires the authenticated
  Web toggle; the toggle is process-memory only.
- Only the three fixed tool descriptors are exposed. User input may select
  `git.diff` staged state and a bounded `git.log` count; it cannot supply a
  subcommand, flag, repository path, environment, remote, or arbitrary argv.
- The runner always invokes `git` with `shell:false`, a captured workspace root,
  a minimal environment, `GIT_TERMINAL_PROMPT=0`, and bounded timeout/output.
  `git.diff` additionally uses `--no-ext-diff` and `git.log`/status use
  `--no-pager`; no network or image pull is initiated.
- Results are read-only. No commit, checkout, reset, apply, hook, remote, or
  patch-write operation is registered. Output is capped and the captured
  workspace root is redacted before it can enter tool events.
- Tools support only trusted `read-only` and `workspace-write` runs. An
  untrusted task must use `external-sandbox`; host Git is not a fallback and
  therefore receives no Git descriptors in that mode. Unknown workspace ids
  fail closed through the workspace registry.
- The per-run runtime captures the workspace id/root and runner settings at
  run start. Disabling Git affects new runs only; an in-flight read remains
  bounded and cancellable.

## Guided Web settings

The Settings panel provides a clear “Git read-only tools” switch with:

1. a disabled-by-default explanation;
2. the safe workspace label (never the absolute path); and
3. a list of the exact descriptors that become available.

The switch is independent from filesystem and external-shell toggles. It does
not write a key, path, event payload, or environment snapshot to browser
storage.

## API boundary

Authenticated routes:

- `GET /api/v1/settings/git` returns `{ enabled, availableTools }`.
- `POST /api/v1/settings/git` accepts `{ "enabled": boolean }` and returns
  the same safe status.

Mutations use the existing Origin/CSRF, pairing, and query-token rejection
rules. Missing or malformed settings fail with `GIT_SETTINGS_UNAVAILABLE` or
`INVALID_REQUEST`; no Git command is started by a settings request.

## Runtime wiring

`InMemoryGitSettingsManager` receives the workspace registry and an injected
`ProcessRunner`. When enabled it constructs a per-run `ToolExecutorRuntime`
with fixed Git descriptors, workspace-registry-bound root, `SandboxResolver`,
and `ApprovalPolicy`. Production uses a small child-process runner with a
minimal environment; tests inject a fake runner and never invoke Git.

## Acceptance tests

- Default status has no Git descriptors; explicit Web enablement exposes only
  `git.status@1.0.0`, `git.diff@1.0.0`, and `git.log@1.0.0`.
- Fixed argv, staged/log limits, cwd, timeout, minimal env, cancellation, and
  output redaction are covered by adapter tests.
- Unknown workspace ids, untrusted host fallback, external-sandbox mismatch,
  arbitrary subcommands/flags, and disabled settings fail closed.
- Authenticated API tests cover GET/POST, malformed bodies, and secret/path-free
  responses; React/API tests cover the guided toggle.
- Full typecheck, unit tests, diff check, and secret scan pass without a real
  model, Git process, network, or Docker/Podman runtime.

## Implementation evidence (2026-08-03)

- `packages/tool-adapters` now provides `GitToolAdapter` for the three fixed
  commands. It validates staged/log bounds, uses `shell:false`, applies a
  minimal Git environment, caps output, supports cancellation, and redacts the
  captured workspace root.
- `apps/daemon/src/git-settings.ts` provides the process-memory toggle,
  `ChildProcessGitRunner`, workspace-root capture, and fail-closed runtime
  selection. Host Git is never exposed for untrusted or external-sandbox runs.
- `apps/daemon` exposes authenticated `GET/POST /api/v1/settings/git` routes
  and composes the captured Git runtime with the existing filesystem and
  external-shell runtimes.
- `apps/web` adds a guided Git card and API client methods; the card lists the
  exact descriptors and states that commits, remotes, patch writes, and
  arbitrary flags are unavailable.
- Adapter, daemon API/runtime, and Web API/render tests cover fixed argv,
  bounded process execution, secret/path-free responses, toggling, workspace
  capture, and fail-closed trust/sandbox cases.

## Explicitly deferred

Git write/patch/apply tools, remote operations, worktree mutation, commit
creation, dedicated diff/log pagination and syntax highlighting, external
sandbox Git execution, and durable settings persistence remain separate specs.
