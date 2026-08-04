# ADR 0024: Web locale preference and accessibility shell boundary

- Status: Accepted for Phase 56a
- Date: 2026-08-05

## Decision

Add a small Web-only locale adapter and accessibility shell layer to the existing
conversation-first UI. The adapter supports only `en-US` and `zh-CN`, keeps a
versioned non-secret preference in a dedicated browser-storage key, and resolves
the locale as explicit preference → browser language → `en-US`.

The catalog is a typed, bounded map with English fallback. The root document
`lang` attribute follows the selected locale. Switching locale changes labels
only; it does not recreate runs, alter provider/model snapshots, change Goal
state, or reconnect SSE.

The shell adds bounded live status semantics, accessible names for icon-only
controls, keyboard-visible focus and reduced-motion hooks. Existing CSS
container/ration rules remain the only device adaptation mechanism.

## Rationale

Keeping locale state outside `RunProfile` avoids coupling display preferences to
execution policy and preserves the existing privacy scanner. A Web-only adapter
is sufficient for the first release-hardening slice and keeps the daemon small;
pairing-scope sync, full message coverage and native-device settings can be
added behind the same contract later.

## Rejected alternatives

- UA/device sniffing: rejected because it produces brittle layout branches and
  cannot model fold/hinge or available container space.
- Sending locale through every run request: rejected because display language is
  not execution state and must not alter run/provider/Goal snapshots.
- Persisting locale beside credentials or raw settings: rejected because it
  widens the secret-bearing storage boundary without benefit.
- Claiming Playwright emulation as real-device support: rejected; manual matrix
  evidence remains a separate release gate.

## Phase 56a non-goals

This ADR does not add a second transport, server-side translation service,
screen-reader automation, RTL layout, native mobile app or full catalog rewrite.

## Phase 56b extension (implemented)

The next Web-only extension adds a deterministic focus scope to the existing
Settings drawer and moves the core settings/guardrail labels into the same
typed catalog. The focus scope is an interaction concern only: it never
changes run/provider/Goal state or network subscriptions. The implementation
uses a small pure index helper plus DOM wiring, so keyboard behavior remains
unit-testable without adding a browser runtime dependency.
