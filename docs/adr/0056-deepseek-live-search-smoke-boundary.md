# ADR 0056: Explicit live DeepSeek provider-owned search smoke

- Status: Accepted for the bounded Spec 61-6/61-9 smoke slice
- Date: 2026-08-06
- Related: [Spec 61](../specs/61-deepseek-first-class-provider-integration.md),
  [ADR 0055](0055-deepseek-provider-owned-search-application-port.md),
  [Spec 60](../specs/60-complete-verification-and-release-evidence.md)

## Context

The provider-owned search application port is covered by deterministic fixtures,
but the repository has no explicit way to verify a real DeepSeek Responses
endpoint. A generic network tool or a hard-coded capability flag would make the
smoke over-claim support and could bypass the existing approval/network gate.

## Decision

Add a single-purpose `smoke:deepseek-search` runner with two explicit modes:

1. `fixture` remains the default and performs no credential lookup, network
   request, daemon start, scheduler work or tool execution.
2. `live` is rejected unless the operator supplies `--authorize`, a complete
   HTTPS `openai-responses` endpoint, a bounded model id and a secret-env name.
   The runner reads the credential only from that process environment, probes
   the exact endpoint first, and proceeds only when the strict versioned probe
   declares a matching ready `webSearch` capability.

The live path constructs the existing `DeepSeekProvider` and
`DeepSeekApplicationCapabilityService`, invokes one fixed bounded retrieval with
`network=enabled` and an explicit approval decision, and emits only provider,
profile, model, status, bounded latency, probe status, item/context counts and a
stable error code. It never prints or persists the endpoint, query, secret,
headers, raw response, prompt, path or transcript.

Probe failure, missing capability, cancellation, timeout, malformed response,
HTTP failure and context overflow remain `blocked`, `cancelled`, `timeout` or
`failed`; they are never reported as healthy. The runner is not part of the
default `pnpm verify` and does not modify AgentLoop, RunManager, Scheduler,
ApprovalBroker, Sandbox, WorkspaceRegistry, `run_events` or `goal_events`.

## Consequences

The real search compatibility gate becomes repeatable and opt-in while the
default development workflow stays offline and low-resource. A provider that
does not expose the required strict capability descriptor remains explicitly
blocked, which is safer than guessing that a Chat endpoint supports
Responses-style `web_search`.
