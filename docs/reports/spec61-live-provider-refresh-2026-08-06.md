# Spec 60/61 DeepSeek live provider refresh (2026-08-06, second session)

Evidence class: explicitly authorized, bounded live smoke against the real
DeepSeek endpoint. The credential was read only from a process environment
reference (`--secret-env`) and was not written to the repository, report,
settings, events, logs or browser state. The endpoint URL and run identifiers
are intentionally omitted. Model: `deepseek-v4-flash`. Source commit:
`3db45d3` (post tar-fix HEAD).

## Direct adapter smoke (`smoke:deepseek`)

| Path | Status | Bounded evidence |
| --- | --- | --- |
| text / openai-chat-completions | healthy | elapsed 851 ms; first token 743 ms; finish `stop`; usage 16/6 |
| text / anthropic-messages | healthy | elapsed 1004 ms; first token 964 ms; finish `stop`; output 25 tokens |
| cancel | cancelled | aborted before first token; exit code 3 as designed |
| timeout | timeout | 100 ms budget; aborted before first token; exit code 3 as designed |
| reasoning / thinking high | blocked | probe `ready` (766 ms); `DEEPSEEK_THINKING_UNSUPPORTED` |
| reasoning / thinking max | blocked | probe `ready` (599 ms); `DEEPSEEK_THINKING_UNSUPPORTED` |

## Provider-owned search smoke (`smoke:deepseek-search --mode live --authorize`)

| Path | Status | Bounded evidence |
| --- | --- | --- |
| live / openai-responses | blocked | probe `ready` (737 ms); `DEEPSEEK_SEARCH_CAPABILITY_REQUIRED` |

## Daemon harness smoke (`smoke:harness`, real daemon + AgentLoop)

| Path | Status | Bounded evidence |
| --- | --- | --- |
| governed text | healthy | run completed; Goal validated; Todo done; 1 quota consumed; usage 19/9 |
| interactive cancel | cancelled | run cancelled before model output; usage 0/0 |
| interactive context-limit | healthy (expected failure) | run failed with `CONTEXT_BUDGET_EXCEEDED`; usage 0/0 |
| interactive tool | healthy | 2 turns; 1 tool requested/completed; no approval; usage 713/58 |
| interactive approval | healthy | 1 approval required and 1 decided; 1 tool completed; usage 713/58 |

## Findings

- `deepseek-v4-flash` streams correctly through both the OpenAI chat
  completions profile and the Anthropic messages profile on the real endpoint.
- The model does **not** expose a reasoning/thinking capability descriptor for
  this account/endpoint; both `high` and `max` probes return
  `DEEPSEEK_THINKING_UNSUPPORTED`. The reasoning gate stays `blocked`, not
  failed — this is conservative capability metadata, not an adapter defect.
- Provider-owned web search is not exposed for this model/profile
  (`DEEPSEEK_SEARCH_CAPABILITY_REQUIRED`). The search gate stays `blocked`.
- Cancel, timeout and context-budget behavior on the real daemon path matches
  the fixture expectations exactly (exit codes 3/0, zero usage on aborted
  runs).

## Scope and limits

This refresh closes the 61-10/61-11 "never run live" gap with real-endpoint
results (both conservatively `blocked`) and re-confirms the 61-6
text/tool/approval/governed/cancel/context-limit gates on the current HEAD.
It does not claim reasoning or search compatibility, reviewer automation,
public deployment, device coverage, cross-platform parity or release
readiness. Those remain separate release gates under Spec 60.
