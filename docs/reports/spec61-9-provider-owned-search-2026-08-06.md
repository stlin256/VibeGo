# Spec 61-9 provider-owned search evidence (2026-08-06)

## Result

The bounded provider-owned search application port is implemented and passes
the deterministic fixture. The default daemon still does not construct a
search executor, and no live DeepSeek endpoint or credential was used.

## Focused evidence

| Gate | Result |
| --- | --- |
| Contract request/privacy | `@ready4vibe/contracts` deepseek-provider suite: 125/125 |
| DeepSeek adapter | `@ready4vibe/model-deepseek` focused suite: 25/25 |
| Daemon application port | daemon focused workflow: 287/287 |
| Typecheck | contracts, model-deepseek and daemon: passed |
| Search fixture | `deepseek-search-smoke/v1`, `status=healthy`; ready/denied/malformed/cancelled cases all expected |

The fixture report contains only case names, bounded status/reason codes, item
counts and context byte counts. It does not contain a query, URL, endpoint,
credential, header, prompt, raw provider response, transcript or absolute path.

## Boundary proven

- A complete Responses endpoint and runtime-only credential are used by the
  adapter; it never appends a path.
- A matching ready capability, enabled network and explicit approval are all
  required before the executor is called.
- Strict versioned search requests/responses are validated; malformed payloads
  fail closed.
- Results become bounded `retrieval`/`untrusted` context through the existing
  `ContextManager` projection.
- Abort, timeout, transport/HTTP and context-limit failures do not replay a
  request and do not produce context.
- No generic `ToolRuntime`, scheduler, approval store, sandbox, Goal writer,
  `run_events` or `goal_events` authority was added or modified.

## Not closed

This evidence does not prove DeepSeek's live `web_search` response shape,
provider billing/latency, production network policy, or any Spec 60 release,
remote-device, certificate or public deployment gate. Those remain explicitly
partial or blocked until an authorized live smoke and the corresponding release
evidence are recorded.
