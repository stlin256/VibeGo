# ADR 0045: DeepSeek provider clean-room boundary

- Status: Proposed
- Date: 2026-08-05
- Related: [Spec 61](../specs/61-deepseek-first-class-provider-integration.md),
  [Spec 03](../specs/03-model-context-contract.md),
  [Spec 47](../specs/47-model-context-agent-loop-productionization.md),
  [ADR 0016](0016-clean-room-harness-productionization.md),
  [upstream harness research](../research/upstream-harness-implementations.md)

## Context

The pinned `MinimumAgentLoop` checkout demonstrates a small DeepSeek
Responses-style agent loop with thinking controls, multiple function calls,
provider-owned web search, an advisory reviewer and a shell/sandbox toggle. It
is useful behavioral evidence for the new DeepSeek first-class provider slice,
but it is intentionally a teaching example rather than a production security
boundary. At commit
`c61b33510c53b95b66f4e44bbe172fcca55516ac`, it uses Python, the OpenAI Python
SDK, `python-dotenv`, `@anthropic-ai/sandbox-runtime`/`srt`, process-local
mutable state, an unbounded in-memory message list and a reviewer input that
contains a raw command and working directory. Its README explicitly lists the
absence of context management, schema validation and defensive security
programming. The repository is licensed under The Unlicense and has no
separate `NOTICE` file at the pinned revision.

## Decision

1. **Use behavior as clean-room input, not source.** VibeGo may reimplement the
   observable two-layer turn/tool behavior, call-ID pairing, explicit thinking
   modes, provider-owned retrieval and bounded reviewer result mapping. No
   Python file, prompt, UI, schema, dependency, `srt` integration or runtime is
   copied or vendored.
2. **Keep one VibeGo execution authority.** DeepSeek is a `ModelProvider`
   adapter behind the existing daemon application boundary. `RunManager`,
   AgentLoop, `ContextManager`, Scheduler, Approval, Sandbox, WorkspaceRegistry,
   Goal Control, `run_events` and `goal_events` keep their current authority.
3. **Make protocol profiles explicit.** Chat Completions, Responses and
   Anthropic Messages are separate endpoint profiles. A profile receives a
   complete endpoint and never guesses or appends a path; an unknown or
   unsupported capability fails closed.
4. **Freeze and minimize run inputs.** Provider, protocol, model, capability,
   thinking, tool, permission, network and retry settings are captured in the
   existing run snapshot. API keys remain daemon-owned secret references. Raw
   transcripts, raw tool output, absolute paths and private reasoning are not
   persisted or sent to a reviewer.
5. **Treat reviewer and search as optional capabilities.** Reviewer decisions
   can only narrow or confirm an exact deterministic low-risk approval key;
   they cannot authorize host, network, secret, untrusted or unknown-tool
   execution. Provider-owned search is off by default and maps to bounded
   untrusted retrieval context through `ContextManager`.

## Alternatives considered

- **Vendor MinimumAgentLoop or invoke its Python CLI:** rejected because it
  adds a second runtime/loop, weakens VibeGo's approval and privacy boundaries,
  and increases resource and upgrade cost.
- **Put DeepSeek-specific branches in AgentLoop:** rejected because protocol
  translation belongs in a provider adapter and would make the core state
  machine provider-specific.
- **Treat all DeepSeek endpoints as OpenAI-compatible:** rejected because
  Responses and Anthropic-shaped messages have different paths, streaming
  events and tool-result pairing semantics.
- **Let reviewer output decide authorization:** rejected because model output is
  untrusted and must remain subordinate to deterministic policy and sandbox
  readiness.

## Consequences

- The first implementation adds a small TypeScript contract/adapter surface and
  focused fixtures, while ordinary fake-provider and interactive paths remain
  unchanged.
- Some provider capabilities and usage fields remain `unknown` until probe or
  live evidence proves them; VibeGo will not infer them from model names.
- A future code-reuse request must record exact file provenance, license/NOTICE,
  dependency impact and removal plan in a new ADR, even though this pinned
  upstream is permissively licensed.

## Rollout and rollback

Spec 61 is staged as contract, protocol, application integration, optional
thinking/reviewer/search, Web settings and explicit live evidence. Each stage
has focused tests and a documentation update before its Git commit. A failed
probe, stream parse, health check or live smoke leaves the existing provider
path active; no run or old tool call is replayed during rollback.
