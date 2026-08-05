# Spec 61-8 application capability evidence

- Date: 2026-08-06
- Scope: daemon application capability boundary
- Status: focused implementation complete; live provider evidence remains a
  separate gate

## Implemented

`DeepSeekApplicationCapabilityService` consumes only the immutable generic and
DeepSeek run snapshots. It provides bounded resolutions for thinking mode and
tool calling, requires a matching ready capability plus enabled network and
explicit approval for provider-owned Responses search, and maps strict search
results to `retrieval`/`untrusted` context items. The result is projected with
`ContextManager` limits for bytes, items and tokens. Invalid or mismatched
snapshots, missing capabilities, malformed search results and context overflow
are fail-closed with stable bounded reason codes.

The service has no provider, fetch, credential, subprocess, tool executor,
Scheduler, ApprovalBroker, Sandbox, Goal writer or event sink. It is exported as
an injectable daemon application port; no production composition or default
interactive run path was changed.

## Focused verification

| Command | Result |
| --- | --- |
| `pnpm --filter @ready4vibe/daemon test -- deepseek-capability-runtime.test.ts` | 254 daemon tests passed (including 7 new tests) |
| `pnpm --filter @ready4vibe/daemon build` | passed |
| `pnpm --filter @ready4vibe/model-deepseek test` | 20/20 passed |

The daemon test command currently runs the package suite because of its Vitest
script forwarding; the new file is explicitly listed as passing. No secret,
prompt, raw provider response, absolute path or credential was used or stored.

## Remaining gates

This evidence does not claim live DeepSeek reasoning/search support, direct
provider-owned retrieval execution, task-specific Goal verification, or Spec
60 release readiness. Those require separately authorized live and release
evidence. `AgentLoop`, `RunManager` default start, `Scheduler`, `Approval`,
`Sandbox`, `WorkspaceRegistry`, `run_events` and `goal_events` remain unchanged.
