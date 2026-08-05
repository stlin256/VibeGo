# Spec 61-6 DeepSeek live evidence

Date: 2026-08-05  
Code under test: `4591c8c`  
Evidence class: `live` (single-user, bounded, opt-in)

The credential was supplied only through the process environment variable
referenced by `--secret-env`. It was not written to this report, the repository,
settings, run events, logs, or browser state. The endpoint value is intentionally
omitted from the report; the run used an explicit HTTPS Chat Completions path.

## Adapter smoke

| Field | Value |
| --- | --- |
| schemaVersion | `deepseek-smoke/v1` |
| provider / profile / model | `deepseek` / `openai-chat-completions` / `deepseek-v4-flash` |
| scenario / thinkingMode | `text` / `off` |
| status | `healthy` |
| elapsedMs / firstTokenMs | `1066` / `925` |
| finishReason | `stop` |
| eventTypes | `text-delta=6`, `usage=1`, `completed=1` |
| usage | input `16`, output `6` |
| errorCode | none |

The adapter called the complete configured endpoint once. No retry or replay was
observed after visible output.

## Harness smoke

| Field | Value |
| --- | --- |
| schemaVersion | `harness-smoke/v1` |
| mode / provider / profile | `interactive` / `deepseek` / `openai-chat-completions` |
| model / thinkingMode | `deepseek-v4-flash` / `off` |
| status / runStatus | `healthy` / `completed` |
| runId | `run_019fd1fe-ea45-77ff-9933-12d479608ae5` |
| providerSnapshot | provider `deepseek`; descriptor/config `harness-deepseek-config`; capability `deepseek-provider-capability-unprobed` |
| eventTypes | `run.created=1`, `model.requested=1`, `model.delta=9`, `model.usage=1`, `model.completed=1`, `run.completed=1` (plus four status/turn lifecycle events) |
| usage | input `19`, output `9` |
| errorCode | none |

This evidence proves the configured DeepSeek provider can complete a bounded
interactive run through the existing daemon and AgentLoop path. It does not
prove tool/Approval/Sandbox, reviewer, provider-owned search, reasoning
capability, governed quota, mobile Web, cross-platform, or release readiness.
Those remain separate evidence gates.

