# Spec 25: Configuration onboarding and settings UI

Status: Accepted (MVP Web slice implemented; Capability Profiles are tracked
by [Spec 52](52-capability-profiles-and-first-run-experience.md)).

## Goal

Let a single user configure and understand VibeGo from the responsive Web
console. The normal path must not require opening a terminal or editing `.env`,
YAML, JSON, or certificate files by hand.

## First slice

The settings panel owns a typed, non-secret run profile:

- workspace id;
- model provider and model name;
- task trust (`trusted-workspace` or `untrusted-content`);
- sandbox mode and network policy;
- approval mode;
- turn, wall-time, token, tool-call, output, and context limits.

The run composer reads this profile and sends the complete validated `RunConfig`
to the daemon. Defaults remain conservative: trusted workspace, read-only
sandbox, restricted network, on-request approval, and bounded limits.

## Onboarding flow

1. Health check explains loopback/LAN/TLS and whether pairing is required.
2. Pairing uses the existing short-lived code; access and CSRF tokens remain in
   memory only.
3. Settings presents safe controls with inline validation and a compact summary
   before the first run.
4. Certificate status and future model credential adapters show next steps in
   the UI; PEM/private-key/API-key values are never rendered back or placed in
   URLs, event payloads, or Git-tracked files.

## Persistence and secrets

The first slice keeps the profile in browser memory and allows an explicit
reset. A later settings-store spec may persist non-secret preferences locally.
Secrets require a daemon-side secret provider/OS keyring adapter; localStorage,
EventStore, SSE, and repository files are forbidden secret sinks.

## Non-goals

- No browser-side filesystem access or arbitrary path picker yet.
- No direct mutation of TLS files, API keys, or daemon process environment.
- No weakening of LAN TLS, pairing, approval, sandbox, or concurrency gates.

## Acceptance tests

- The settings panel renders on desktop/mobile and exposes each profile field.
- Invalid numeric values are rejected/clamped before `POST /runs`.
- Run requests contain the selected profile and no secret-shaped fields.
- Reset restores conservative defaults.
- Existing pairing, approval, recovery, and certificate status tests remain
  green.
