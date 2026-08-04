# ADR 0032: Durable non-secret model endpoint profile

- Status: Accepted for Spec 54 Phase 4
- Date: 2026-08-05

## Decision

Persist only the validated model provider id, HTTPS endpoint, model hint,
profile revision and timestamp through the existing `SettingsStore`. The
profile uses a versioned contract and is stored in the existing
`daemon_settings` table; it is not an event stream or a second provider
registry.

The API key is never part of the profile. On restart, the daemon restores the
non-secret metadata but keeps the model provider unconfigured until a key is
provided by the existing process-memory/environment boundary. The status makes
this explicit as `durable-profile` with a credential-required state, allowing
the Web setup form to reuse the endpoint/model without pretending that a key
survived restart.

Configure writes the profile before replacing the active provider. Clear
deletes the profile before removing the active provider. A persistence failure
therefore leaves the prior provider and profile untouched. Existing runs keep
their captured provider snapshot; only later runs observe a successful change.

## Rationale

Users should not have to retype non-secret endpoint metadata or edit `.env`
after every daemon restart, while a browser or SQLite database must never hold
an API key. Reusing the existing settings adapter preserves its size, strict
privacy and SQLite transaction boundaries without introducing a second
configuration authority.

## Rejected alternatives

- Persisting the API key in `daemon_settings`: rejected because settings are
  intentionally non-secret and can be backed up or inspected as metadata.
- Treating a saved endpoint as a configured provider: rejected because a run
  must fail closed when the credential is absent.
- Replacing the existing provider registry: rejected because provider/run
  snapshot binding remains the daemon application authority.
- Writing profile changes to `run_events` or `goal_events`: rejected because
  settings are durable snapshots, not execution or Goal facts.

## Non-goals for Phase 4

No OS keychain implementation, provider download, automatic probe, model
request, ACME/TLS operation, or change to AgentLoop, RunManager, Scheduler,
Approval, Sandbox, WorkspaceRegistry, `run_events` or `goal_events` is included.
