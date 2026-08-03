# ADR 0007: Codex-like conversation-first Web presentation

- Status: Accepted
- Date: 2026-08-03

## Context

The initial VibeGo Web MVP exposed every configuration field in the primary
scroll. This made the application look like a settings dashboard instead of a
coding session. Codex demonstrates a more useful hierarchy: conversation and
next action occupy the center, while workspace navigation and contextual
controls remain available at the edges.

## Decision

Use a three-region React shell—workspace rail, conversation column, and context
rail—with a responsive collapse policy driven by width and `aspect-ratio`.
Settings remain the same guided, authenticated controls but move into a
dismissible drawer/sheet. Goal projection, approvals, recovery, SSE, and run
contracts are reused; no Codex code is vendored and no second state authority is
introduced.

## Consequences

- The context rail owns Goal, connection, sandbox, and guardrail summaries so
  the workspace rail remains a navigation surface rather than a second status
  dashboard.
- The desktop grid uses a bounded context column and `minmax(0, 1fr)` for the
  conversation column, preventing Goal or top-bar controls from being clipped
  at the viewport edge.
- The conversation column renders the timeline before the composer. New task
  is a one-click draft reset/focus action; model, workspace, sandbox, and
  approval setup remain secondary controls in Settings.

- Normal task entry is faster and the primary surface represents real user work;
  screenshots remain optional local review artifacts.
- Desktop users can keep Goal and safety context visible without losing the
  composer; phone users get a focused conversation surface.
- A small amount of presentation state (drawer/context visibility) lives only
  in React memory and is not persisted.
- Settings remain reachable and testable, but they are no longer the default
  first viewport.
