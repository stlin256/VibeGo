# Spec 61-11 live reasoning smoke evidence (2026-08-06)

## Result

The explicit `reasoning` boundary is implemented in the existing
`smoke:deepseek` runner. The default `text`/`cancel`/`timeout` scenarios remain
unchanged. A real provider endpoint was not called in this checkpoint, so this
record is adapter/fixture evidence and does not claim DeepSeek reasoning
compatibility.

## Focused evidence

| Gate | Result |
| --- | --- |
| Smoke parser/runtime tests | 9/9 passed |
| Reasoning mode validation | `high` and `max` accepted; `off`/`auto` blocked before probe |
| Probe ordering | Provider construction is not reached before the probe |
| Capability gate | Missing/non-ready/mismatched or `reasoning=false` remains blocked |
| Privacy guard | Private reasoning event payload is absent from report/event counts |
| Authorized live request | Not run in this checkpoint |

Repository verification also passed: `pnpm verify` completed all four steps
(typecheck, package tests, `diff:check` and `git diff --check`). The focused
smoke+search script run passed 16/16 after the final fixture privacy assertion.

The bounded report contains only provider/profile/model labels, requested
thinking mode, probe status/latency, elapsed and first-visible-token timing,
finish reason, event type counts, usage and stable error codes. It does not
contain private reasoning text, endpoint, prompt, headers, credential, raw
provider response, transcript or absolute path. The runner does not create a
daemon, scheduler, approval store, sandbox, tool runtime or event ledger.

## Remaining gate

An operator must explicitly provide a runtime-only credential and run the
`reasoning` scenario against a complete HTTPS endpoint that returns the strict
versioned capability descriptor. Missing or conservative metadata remains
`blocked`; a fixture cannot be promoted to live provider or release evidence.
