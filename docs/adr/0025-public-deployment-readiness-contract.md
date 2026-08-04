# ADR 0025: Explicit public deployment readiness contract

- Status: Accepted; Phase 55a contract slice implemented
- Date: 2026-08-05

## Decision

Add and implement a strict, non-secret `deployment/v1` profile and readiness projection in
`@ready4vibe/contracts`. The profile names the transport topology, TLS policy,
certificate source/challenge, hostname/proxy trust metadata and bounded
connection/rate limits. The projection maps only safe, stable reason codes and
next steps; it never includes private keys, ACME/DNS credentials, absolute
paths, forwarded headers or raw adapter errors.

LAN and public deployment are fail-closed without TLS. An explicit insecure LAN
override remains visible in the profile but can only produce `blocked` readiness.
Tailscale and SSH are represented as future adapter modes and stay
`unknown`/`degraded` until an external health evidence provider is added. The
contract does not open a listener, contact ACME, modify firewall/DNS, spawn an
SSH/Tailscale process or change the current daemon transport resolver.

## Rationale

Keeping topology and readiness separate from runtime authority lets the Web
settings surface explain why a deployment is blocked without adding a second
auth/session/scheduler plane. Explicit mode and TLS fields also preserve the
user's LAN safety requirement while leaving a stable seam for future
Tailscale/SSH and certificate automation.

## Rejected alternatives

- Inferring public/LAN mode from a hostname or user agent: rejected because it
  hides exposure and cannot be audited.
- Treating a configured certificate path or ACME account as readiness: rejected
  because only a verified certificate/adapter health result is evidence.
- Falling back to loopback HTTP when a public mode is unhealthy: rejected;
  callers must receive `blocked` and choose an explicit mode change.
- Embedding deployment state in `run_events` or `goal_events`: rejected; these
  remain execution and Goal authorities.

## Non-goals for Phase 55a

No ACME client, DNS adapter, reverse proxy, Tailscale/SSH forwarder, daemon
route, Web settings control, firewall change or real network smoke is included.

## Phase 55b extension (read-only projection)

Expose the computed readiness through `GET /api/v1/deployment/readiness` using
the existing daemon authentication boundary. The Web shell may render the
bounded status/reason/next-step projection next to certificate metadata, but
the route accepts no configuration mutation and creates no run, event or
transport side effect. A missing projection is a stable unavailable response;
the browser must remain usable and preserve the existing interactive composer.
