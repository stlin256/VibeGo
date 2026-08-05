# Spec 60-4/60-5 live harness evidence

- Date: 2026-08-05
- Scope: explicitly authorized DeepSeek provider through the daemon harness
- Provider: `deepseek`
- Model: `deepseek-v4-flash`
- Profile: `openai-chat-completions`

## Authorization and privacy boundary

Each live invocation used `--secret-env` and a runtime-only credential with one
bounded request. The key was not passed as a CLI value and was not written to
the repository, daemon settings, events, logs, or this report. The smoke output
keeps only stable status/error codes, event counts, revisions, latency and
aggregate usage.

## Governed success

```text
mode: governed
scenario: text
status: healthy
runStatus: completed
goal.status: validated
goal.todoStatus: done
goal.totalSpent: 1
usage: inputTokens=19, outputTokens=9
```

The request crossed the authenticated local daemon HTTP route, captured the
provider snapshot, ran through `RunManager`/`AgentLoop`, and completed Goal
admission, validation/writeback and exactly-once quota consumption. The result
did not bypass Scheduler, Approval, Sandbox, Workspace or Goal authorities.

## Cancellation

```text
mode: interactive
scenario: cancel
status: cancelled
runStatus: cancelled
usage: inputTokens=0, outputTokens=0
```

The daemon cancel route terminated the run before model output and no tool
replay was observed. This is cancellation evidence, not a throughput claim.

## Context-budget expected failure

The new opt-in `context-limit` harness scenario captures a deliberately tiny
context budget. It reports a healthy smoke only when the real daemon path ends
with the declared failure:

```text
mode: interactive
scenario: context-limit
status: healthy
runStatus: failed
errorCode: CONTEXT_BUDGET_EXCEEDED
usage: inputTokens=0, outputTokens=0
```

This keeps context exhaustion distinct from provider failure or a successful
text run. Provider timeout/5xx remains covered by the injected failure fixture;
no fake result is promoted to live evidence.

