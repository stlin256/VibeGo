# ADR 0022: Optional MCP settings and status boundary

- Status: accepted and implemented for Spec 49-R3
- Date: 2026-08-04
- Related: [Spec 49](../specs/49-mcp-skill-transport-and-capability-lifecycle.md),
  [ADR 0021](0021-mcp-capability-snapshot-and-registry.md),
  [harness contracts](../harness-contracts.md)

## Context

R1 and R2 provide transport/session and pure capability projection, but there
is no user-facing way to see whether an optional MCP integration is configured.
The daemon already has a versioned, bounded `daemon_settings` adapter and an
authenticated settings API. R3 must expose useful state without turning a
settings toggle into an implicit process/network side effect or a second
execution authority.

## Decision

1. Add a strict, versioned MCP settings/status contract in
   `@ready4vibe/contracts`. Persist only server identity, transport, label,
   manifest revision and capability references. Reject URLs, commands, argv,
   paths, environment data, secret-shaped keys/values and unknown fields.
2. Add an application-level `McpSettingsManager` that uses the existing
   `SettingsStore`. Its probe port is injected; no default probe is installed.
   Disabled integrations are a no-op, and an enabled integration without a
   probe is reported as bounded `degraded` rather than failing the daemon.
3. Add authenticated `GET/PATCH /api/v1/settings/mcp` and
   `POST /api/v1/settings/mcp/probe`. The response is a safe status projection;
   no raw protocol response, credential, executable path or URL is returned.
4. Add one MCP card to the existing Web settings drawer. It is informational
   and does not gate the conversation composer or default run path.

## Consequences

- Restart restores the non-secret MCP intent without restoring a process,
  socket, credential or live capability registry.
- Tests can prove disabled zero-side-effect and degraded fail-soft behavior
  with a fake probe; real transport remains a later explicit activation slice.
- `McpCapabilityRegistry` remains the only capability projection boundary, and
  `ToolRegistry`, `Approval`, `Scheduler`, `Sandbox`, `AgentLoop`,
  `RunManager`, `run_events` and `goal_events` are unchanged.

## Rejected alternatives

- Persisting a raw MCP manifest or endpoint URL in `daemon_settings`.
- Starting stdio children or making HTTP probes from the settings constructor.
- Registering advertised tools directly from a settings route.
- Treating a degraded optional integration as a Web or run failure.
