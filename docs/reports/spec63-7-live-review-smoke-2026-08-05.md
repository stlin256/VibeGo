# Spec 63-7 live reviewer smoke evidence

- Date: 2026-08-05
- Scope: explicitly authorized, direct same-as-run DeepSeek reviewer smoke
- Result: healthy after a strict reason-code prompt correction

## Authorization and limits

The smoke was run manually with `--authorize`, one bounded request, a 5,000 ms
review deadline, and a runtime-only environment-variable secret reference. The
credential value was not written to the repository, settings, events, logs, or
this report. The command is opt-in and is not part of the default verification
gate.

## Redacted diagnostic

The first request produced a JSON object with exactly the six expected keys;
the `reviewId` and approval-key fingerprint matched, and the response was not
truncated or wrapped in a code fence. Strict validation rejected only the
`reasonCode` value because the model returned the unsupported `policy-allow`
value. The adapter therefore returned `unavailable/schema-mismatch` and did
not grant or execute anything.

The reviewer system contract was then made explicit: it enumerates the
versioned reason-code set and requires `eligible` for an eligible `allow` or
`ask-user`, `policy-denied` for `deny`, and `provider-unavailable` for
`unavailable`. Unknown values remain fail-closed.

## Final bounded result

```text
provider: deepseek
model: deepseek-v4-flash
status: healthy
decision: allow
reasonCode: eligible
latencyMs: 1527
usage: inputTokens=460, outputTokens=96
```

The result is direct adapter evidence only. It did not create a run, alter the
ApprovalBroker, execute a tool, or change the authority of Scheduler, Sandbox,
WorkspaceRegistry, `run_events`, or `goal_events`. No raw prompt, model text,
headers, endpoint secret, path, command, environment value, or credential is
stored here.
