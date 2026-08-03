# Spec 18: AgentLoop and daemon tool wiring

**Status: Accepted (MVP implementation in progress)**

## Goal

Connect model tool-call deltas to the existing registry, approval policy, sandbox
resolver, and tool executor without making host execution the default. The loop
must remain useful with a model that does not request tools and must fail closed
when no runtime is explicitly injected.

## Boundaries

- `AgentLoop` receives an optional `ToolRuntime`; `undefined` means the model
  request contains no tools and a tool call is rejected with `TOOLS_UNAVAILABLE`.
- A runtime exposes only public tool descriptors. It owns the mapping from a
  model name to a versioned `ToolIntent` and calls `ToolExecutor` for every
  invocation. The loop never calls shell, filesystem, Docker, Podman, MCP, or
  Skill code directly.
- Every call is bounded by `RunConfig.limits.maxToolCalls`, the scheduler's
  `toolProcesses` resource, the configured sandbox, and the approval policy.
- Accumulated JSON arguments are capped at 256 KiB per call before parsing, so a
  provider cannot grow an in-memory buffer without bound.
- Unknown names, malformed JSON arguments, policy prompts/denials, sandbox
  failures, missing handlers, and executor errors are safe, deterministic
  failures. No approval is fabricated and no policy decision is cached by the
  loop.
- Tool output is returned to the next model turn as a bounded JSON-safe tool
  message. Raw secrets, environment snapshots, and private paths are never
  emitted as event payloads.
- The MVP supports one tool round per model turn and continues up to
  `maxTurns`. A `tool-calls` completion without a usable runtime is terminal.
  Approval continuation APIs are a later spec; a prompt currently emits
  `approval.required` and fails the run with `APPROVAL_REQUIRED` rather than
  blocking an orphaned in-memory promise.
- `RunManager` accepts a runtime only through explicit options. The daemon's
  default construction remains runtime-free, so production host tools cannot be
  enabled accidentally by importing the package.

## Event contract

For each model call, the loop appends:

1. `tool.requested` with call id, public tool id/version, risk, and argument
   byte count (not raw arguments).
2. `approval.required` when the executor reports `APPROVAL_REQUIRED`.
3. `tool.started` immediately before executor invocation.
4. `tool.output` with bounded serialized output and a `truncated` flag.
5. `tool.completed` with success/failure and safe byte/exit metadata.

All events use the turn id as correlation id. A failed tool call is followed by
`run.failed`; no `tool.completed` success event is written for a rejected call.

## Tests and exit gate

- Agent tests cover descriptor injection, delta accumulation, malformed JSON,
  tool output continuation, max-tool-call enforcement, approval-required,
  unknown-tool and runtime-unavailable failures, cancellation, and concurrent
  independent workspaces.
- RunManager tests prove the runtime is opt-in and event subscriptions observe
  tool events.
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check`, and `git diff --check` must
  pass before the standalone Git commit and push.
