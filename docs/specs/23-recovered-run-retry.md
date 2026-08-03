# Spec 23: Explicit retry after recovery

Status: Accepted — MVP implementation in progress.

## Goal

Give a user a safe way to continue after Spec 22 marked a run
`needs-recovery`. The action creates a fresh run from the persisted user-level
configuration only; it never guesses whether an interrupted model, tool,
sandbox, or approval operation completed.

## API

`POST /api/v1/runs/:runId/retry`

Request body:

```json
{ "confirmation": "retry-as-new-run" }
```

The endpoint uses the existing bearer, CSRF, Origin, and LAN/TLS gates. It
returns `202` with the new `{ runId, status: "queued", retryOf }`.

- The source run must exist and have status `needs-recovery`.
- Any other status returns `409 RECOVERY_CONFIRMATION_REQUIRED`.
- The server generates a fresh `clientRequestId`; callers cannot replace the
  stored workspace, model, sandbox, approval, or limits through this endpoint.
- The new run starts from the original `RunConfig` and does not copy event
  sequence numbers, pending approvals, tool arguments, environment values, or
  output.
- A retry is an explicit new run. It is not an automatic continuation and the
  original run remains immutable.

## Web behavior

The run console shows a recovery explanation and a single “Retry as new run”
action only for `needs-recovery`. Approval cards and cancel controls are not
shown as active operations for a recovered run.

## Acceptance tests

- Unauthenticated, invalid-confirmation, missing-run, and non-recovered requests
  are rejected without starting a run.
- A recovered run creates exactly one new run with a fresh client request id and
  no copied output or approval list.
- The new run keeps the original safety policy and limits.
- API and React tests cover the action and ensure no raw path/tool payload is
  rendered or submitted.
