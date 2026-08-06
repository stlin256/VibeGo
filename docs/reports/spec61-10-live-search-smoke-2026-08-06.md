# Spec 61-10 provider-owned search smoke evidence (2026-08-06)

## Result

The explicit `smoke:deepseek-search` live boundary is implemented. The default
mode remains an offline fixture; live mode requires `--authorize`, a complete
HTTPS Responses endpoint, a bounded model and a secret-env reference. The live
runner probes the exact endpoint and refuses to search unless the strict
capability descriptor declares matching provider-owned search support.

## Focused evidence

| Gate | Result |
| --- | --- |
| Search smoke parser/runtime tests | 6/6 passed |
| Fixture cases | healthy: ready, denied, malformed and cancelled |
| Live provider request | not run in this checkpoint |
| Default daemon behavior | unchanged; no search executor is constructed |

The runner's live report is bounded to provider/profile/model labels, status,
probe status/latency, item/context counts and stable error codes. It does not
include the endpoint, query, secret, secret-env name, headers, prompt, raw
response, transcript or absolute path. The fixture and live code paths do not
create a daemon listener, generic network tool, scheduler, approval store or
event ledger.

## Remaining gate

An operator must explicitly run the live mode with a runtime-only credential
against a provider endpoint that returns the required versioned capability
descriptor. Missing or conservative capability metadata remains `blocked`; a
fixture result cannot be promoted to live provider compatibility or release
evidence.
