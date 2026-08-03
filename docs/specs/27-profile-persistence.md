# Spec 27: Non-secret profile persistence

Status: Implemented (MVP)

## Goal

Make the settings wizard practical across page refreshes without turning the
browser into a credential store. Only the typed, non-secret `RunProfile` is
persisted, and the user can reset it in one action.

## Contract

- Storage key: `vibego.run-profile.v1`.
- Value: JSON `RunProfile` containing workspace/model identifiers, trust,
  sandbox, approval, and bounded limits only.
- Invalid, old, oversized, or secret-shaped values are ignored and replaced by
  conservative defaults.
- Storage failures (private browsing/quota/disabled storage) fall back to
  in-memory profile state and do not block runs.
- Pairing tokens, CSRF tokens, API keys, PEM/private keys, headers, and event
  payloads are never written to this key.

## Web behavior

The Settings panel writes preferences after validated changes and the Reset
button clears the key through the same controlled path. The UI labels these as
local preferences, not daemon configuration; server-side changes still use
explicit authenticated adapters.

## Acceptance tests

- Valid profiles round-trip through a fake storage adapter.
- Malformed profiles and secret-shaped fields fall back to defaults.
- Storage read/write exceptions do not throw into the UI.
- Full Web/daemon and repository tests remain green.

## Implementation evidence (2026-08-03)

- `RuntimeApp` initializes from `loadRunProfile()`, persists validated edits
  with `saveRunProfile()`, and clears the key before restoring defaults.
- Web tests cover round-trip persistence, malformed/secret-shaped rejection,
  and disabled/quota-failing storage adapters.
- No pairing token, CSRF token, model credential, certificate material, or
  event payload is included in the persisted profile.
