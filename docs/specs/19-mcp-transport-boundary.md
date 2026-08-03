# Spec 19: MCP transport boundary

**Status: Accepted (safe channel adapter MVP)**

## Goal

Turn the validated MCP manifest into a small, testable request boundary. The
boundary must be usable by a future ToolRuntime without making network access or
child-process execution part of the daemon default.

## Design

- `McpTransportClient` accepts a parsed `McpServerManifest`, an
  `IntegrationAllowlist`, and an explicitly injected `McpChannelFactory`.
- The client refuses servers or tool versions not present in the allowlist and
  refuses environment keys not declared by the manifest. Environment values are
  passed only to the injected channel and are never serialized into events or
  errors.
- Calls use bounded JSON-RPC 2.0 `tools/call` messages with a generated request
  id. Request and response bytes have a hard cap; malformed JSON, invalid
  envelopes, mismatched ids, remote errors, timeout, abort, and unavailable
  channels fail with stable safe codes.
- A channel is one-shot for this MVP (`open → request → close`). This avoids a
  background reader, unbounded pending map, and hidden long-lived process. A
  later pooled transport may reuse the same interface only after scheduler and
  lifecycle limits are specified.
- Stdio and HTTP are represented by the same channel interface. This package
  does not import `child_process`, call `fetch`, resolve DNS, or start a server.
  Production channels must be injected behind the sandbox, approval policy, and
  scheduler.

## Exit gate

- Unit tests cover allowlist/server-tool version checks, env allowlist, message
  caps, malformed/mismatched responses, remote errors, timeout, cancellation,
  close-on-error, and successful result decoding.
- No test starts a process or makes a network request.
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check`, and `git diff --check` pass
  before the standalone commit and push.

