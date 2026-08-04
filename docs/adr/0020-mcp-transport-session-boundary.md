# ADR 0020: Injected MCP transport and session boundary

- Status: accepted for Spec 49-R1
- Date: 2026-08-04
- Related: [Spec 49](../specs/49-mcp-skill-transport-and-capability-lifecycle.md),
  [Spec 19](../specs/19-mcp-transport-boundary.md),
  [ADR 0016](0016-clean-room-harness-productionization.md)

## Context

The manifest and one-shot JSON-RPC client validate inputs but intentionally do
not start processes or make network requests. Spec 49 needs a real protocol
boundary without making MCP a daemon dependency or giving a server authority
over tools, approval or sandbox policy.

## Decision

1. Add native TypeScript stdio and Streamable HTTP channel factories behind
   injected spawn/fetch ports. Stdio receives only server-resolved argv and
   allowlisted env; HTTP posts to the exact validated manifest URL and accepts
   only bounded response framing. Credentials are runtime headers supplied by
   an in-memory port and never stored in manifests, events or health DTOs.
2. Add a bounded `McpProtocolSession` for initialize, request-id correlation,
   progress notifications, timeout, AbortSignal cancellation and deterministic
   close. Stable transport errors expose codes only; raw protocol data is
   discarded after bounded parsing.
3. Keep transport separate from policy. Session capability results are
   temporary and cannot register ToolRegistry descriptors, bypass Approval,
   Scheduler or Sandbox, or change an in-flight run snapshot. Disabled mode
   does not call spawn/fetch, and the daemon does not auto-start sessions.
4. Test with fake child and fetch ports. Real MCP servers and network smoke are
   explicit later commands, never part of `pnpm verify`.

## Consequences

- Process/network integration is optional and low overhead; a broken server
  degrades to a stable status instead of blocking ordinary chat.
- Protocol framing and lifecycle are reusable for later activation/ToolExecutor
  work while existing one-shot callers remain compatible.
- Capability validation, approval and resource scheduling still need the R2/R4
  slices before any MCP tool can execute.

## R1 implementation record

`@ready4vibe/skill-mcp` now ships the decision as native TypeScript: the stdio
and Streamable HTTP factories accept only injected spawn/fetch ports, while
`McpProtocolSession` owns initialize, bounded request correlation, progress,
timeout/cancellation and idempotent close. HTTP status classes are mapped to
stable `MCP_HTTP_401`, `MCP_HTTP_403`, `MCP_HTTP_429`, `MCP_HTTP_5XX` and bounded
4xx codes; raw response bodies, headers and runtime auth values never enter an
error message. The focused package suite uses fake child/fetch ports and does
not start a process or make a network request.

## Rejected alternatives

- auto-starting every manifest during daemon boot;
- inheriting the daemon environment or putting API keys in a manifest;
- rewriting HTTP URLs to guessed paths such as `/chat/completions`;
- copying an MCP SDK/server implementation or creating a second ToolRegistry.
