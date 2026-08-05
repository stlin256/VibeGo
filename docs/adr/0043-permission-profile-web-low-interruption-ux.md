# ADR 0043: Permission profile Web UX and low-interruption approval surface

- Status: Accepted for Spec 59-4
- Date: 2026-08-05
- Related: [Spec 59](../specs/59-permission-profiles-and-low-interruption-approval.md),
  [ADR 0042](0042-permission-settings-grants-and-run-snapshot.md),
  [Spec 38](../specs/38-conversation-first-web-shell.md)

## Context

Spec 59-3 added the daemon-owned permission settings, authenticated full-host
confirmation/revoke lifecycle and immutable run snapshot, but the Web shell did
not yet expose that state. A separate permission UI would duplicate the existing
Settings authority and make the conversation-first surface harder to use.

## Decision

1. Add a controlled permission card to the existing Run Settings tab. It offers
   the two supported profiles (`workspace-coding` and `full-host`) and the three
   approval postures (`bounded-auto`, `session-auto`, `explicit`).
2. `workspace-coding` is the visible safe default: workspace-only, network off,
   no host process, and bounded exact-key approval. `full-host` is never selected
   by default and shows a high-risk warning plus a separate trusted-session
   acknowledgement and confirmation action.
3. Render effective status, revision, reason/next step, grant expiry and revoke
   in the same card. The browser never stores grants, profile revisions, access
   tokens, raw commands, host paths or secrets. The daemon remains the only
   source of truth; settings changes affect later runs only.
4. Extend the existing inline approval/timeline surface with a compact frozen
   permission snapshot summary. The user keeps the same Allow/Deny controls;
   automatic approval remains a daemon policy decision and is not simulated in
   React.
5. Use the existing `ApiClient` authenticated request boundary. Confirmation
   and revoke helpers inject the in-memory paired session identity internally so
   React components do not receive or persist session identifiers.
6. Preserve the existing ratio-first CSS rules and 44px touch targets. The card
   must collapse to a single-column flow on portrait/fold/phone widths and must
   not add a new persistent rail or push the conversation out of view.

## Consequences

- A paired user can understand and change permission posture without editing a
  config file or leaving the conversation workflow.
- Full-host remains fail-closed when confirmation, session, policy or host
  runner readiness is missing; degraded/blocked status is visible rather than
  silently falling back.
- The Web layer remains presentation/application glue. It does not execute
  tools, issue grants, bypass Goal admission, or introduce a second approval
  store.

## Rejected alternatives

- Persisting permission intent or grants in browser storage: would create a
  second authority and risk stale session authorization.
- Hiding permission state only in a generic access tab: makes the safety choice
  invisible when starting a run and conflicts with the low-interruption goal.
- Replacing the inline approval card with a global modal: removes run context
  and breaks the conversation-first interaction contract.
