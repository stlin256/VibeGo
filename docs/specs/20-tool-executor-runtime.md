# Spec 20: ToolExecutor runtime bridge

**Status: Accepted (explicit adapter MVP)**

## Goal

Provide the missing typed bridge between AgentLoop's generic `ToolRuntime` and
the already-tested `ToolExecutor`. This keeps policy, sandbox, path/argv guards,
and handlers behind one implementation boundary while avoiding a default host
workspace or implicit approval.

## Contract

- `ToolExecutorRuntime` receives a `ToolRegistry`, a `ToolExecutor`, and three
  mandatory callbacks: resolve the workspace root, build the `ToolIntent`, and
  build the matching `SandboxResolveRequest`.
- The callbacks receive the complete AgentLoop tool request, so they can derive
  path/command/network approval keys from the actual input. The bridge never
  invents those fields and never approves a prompt.
- Public descriptors are copied from the registry or an explicit safe mapping;
  handlers, environment values, sandbox capabilities, and private paths are not
  exposed to the model.
- Every call is delegated to `ToolExecutor.execute` with the run's AbortSignal.
  Registry/version/risk, approval, sandbox, and handler checks therefore remain
  centralized and are repeated at execution time.
- The bridge is an opt-in library. `RunManager` and the daemon still construct
  no runtime unless an application explicitly passes one.

## Tests and exit gate

- Tests cover descriptor projection, callback inputs, executor delegation,
  abort propagation, and preservation of fail-closed executor errors.
- No test uses a real filesystem, process, network, Docker, or Podman runtime.
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check`, and `git diff --check` pass
  before the standalone commit and push.

