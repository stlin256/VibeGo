# Spec 28: Model provider onboarding

Status: Implemented (MVP)

## Goal

Let the single user configure an OpenAI-compatible model provider from the
authenticated Web settings surface. The normal setup path must not require
editing `.env`, YAML, or a daemon config file.

## Security contract

- `GET /api/v1/settings/model` returns only safe metadata: configured state,
  provider id, normalized base URL, model hint, and source (`environment`,
  `web-memory`, or `unconfigured`). It never returns a key, key length,
  authorization header, or secret-shaped error text.
- `POST /api/v1/settings/model` accepts the API key only in the JSON body over
  the existing authenticated transport. HTTPS is required for non-loopback
  provider URLs; an explicit development-only insecure override is not exposed
  by the Web form.
- The MVP secret store is process-memory only. It is intentionally represented
  by the model-settings/provider switching boundary so a Windows Credential
  Manager/keyring or other OS-backed adapter can be added later without
  changing the UI contract.
  Restarting the daemon clears Web-configured secrets; the UI must show this
  state and offer setup again rather than pretending the key persisted.
- Keys are never written to EventStore, browser storage, SSE payloads, URLs,
  logs, thrown messages, or run configuration snapshots.

## Runtime behavior

- Configuring a provider atomically swaps the provider used by subsequently
  created runs. In-flight runs keep their provider instance and credentials.
- Clearing the provider is authenticated and makes new runs fail closed with
  `MODEL_PROVIDER_NOT_CONFIGURED`.
- The provider status is safe to poll after pairing and can drive an inline
  setup card in the settings panel. The key input is write-only and is cleared
  after a successful submit or explicit reset.
- The UI keeps only non-secret provider id, base URL, and model name in the
  existing `RunProfile` preference. The API key is never placed there.

## Acceptance tests

- Authenticated status is secret-free for configured and unconfigured states.
- Invalid URLs, empty/oversized keys, and malformed bodies are rejected without
  changing the active provider.
- A successful configure affects new runs; clear restores fail-closed behavior.
- Concurrent configure requests have one atomic last-write-wins result and do
  not expose the key in response bodies or event records.
- Web setup renders an explicit first-run guide and never stores the key in
  `localStorage`.

## Implementation evidence (2026-08-03)

- `InMemoryModelSettingsManager` atomically swaps the provider used by new
  runs; `RunManager` captures a stable provider snapshot so in-flight runs are
  not changed by a later settings update. Credentials stay out of status
  responses and run events.
- The daemon exposes authenticated GET/POST/DELETE model settings endpoints;
  Web renders the setup card and clears the write-only key field on success.
- Daemon, Web, and OpenAI-compatible provider tests cover safe status,
  validation, clear/fail-closed behavior, URL credential rejection, and body
  transport without URL secrets.
