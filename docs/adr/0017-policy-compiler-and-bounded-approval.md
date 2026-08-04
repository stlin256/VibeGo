# ADR 0017: Native policy compiler and bounded approval grants

- Status: accepted for 48-R1 implementation
- Date: 2026-08-04
- Related: [Spec 48](../specs/48-approval-sandbox-shell-runtime.md),
  [harness contracts](../harness-contracts.md),
  [ADR 0016](0016-clean-room-harness-productionization.md)

## Context

The repository already has a deterministic `ApprovalPolicy` used by the
explicit tool adapters. Its legacy `allow | prompt | forbidden` result is
useful for the existing bridge, but it does not yet expose the complete
Codex-like policy snapshot required by Spec 48: exact argument-bound approval
keys, bounded session-grant use, stale revision handling, effective sandbox
metadata, and a distinction between a server decision and a stricter client
request.

## Decision

1. Add a pure TypeScript compiler under `@ready4vibe/policy`. It receives only
   server-resolved metadata and a caller-provided SHA-256 argument fingerprint;
   raw arguments, commands, paths, environment values and secrets never enter
   the compiler result or grant state.
2. Use `allow | ask | deny` for the new contract. Unknown tools/schema,
   revision mismatch, untrusted host execution, network mismatch, unsupported
   sandbox and privilege-like risks are fail-closed `deny` decisions.
3. Allow automatic/session grants only for a declared low-risk class. Grants
   are exact-key, short-lived, bounded-use records and include a visible safe
   reason. They cannot authorize shell, network, destructive or privilege-like
   work.
4. The server may upgrade a client request to `ask` or `deny`; a client may
   only request a stricter decision. Effective sandbox and network values are
   returned as part of the immutable policy snapshot.
5. Keep the existing `ApprovalPolicy` API and runtime wiring unchanged in R1.
   Integration with `AgentLoop`, Web approval continuation and real process
   runners remains in later Spec 48 phases.

## Consequences

- policy decisions are deterministic and testable without a process, network,
  model provider or container runtime;
- exact grants cannot silently widen when arguments, workspace, sandbox,
  network, trust or policy revision changes;
- the R1 compiler adds a small amount of hashing and metadata validation but
  does not create another scheduler or event authority;
- existing callers can migrate incrementally because the legacy adapter remains
  available until the later runtime integration slice.

The follow-up continuation path remains owned by the existing AgentLoop,
RunManager, ApprovalBroker and authenticated Web endpoint. Spec 48-R4 verifies
that an untrusted external-sandbox request reaches a bounded
`approval.required` card, consumes one exact runtime grant, and resumes only
the same run; the compiler is not replaced by a second scheduler or approval
authority.

## Rejected alternatives

- storing raw arguments in approval grants or events;
- blanket session approval for all writes or shell commands;
- allowing the model or browser to choose a weaker effective policy;
- copying Codex/OpenHands policy source or introducing a second runtime.
