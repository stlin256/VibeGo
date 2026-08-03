# Spec 38: Conversation-first Web shell

**Status: Accepted (implemented)**

**Date: 2026-08-03**

## Problem

The first Web scaffold put the complete run profile at the top of the page.
That is useful for onboarding but makes normal use feel like an administration
form. A user who is already paired should see the task conversation, run state,
and the next action first. Settings must remain discoverable without competing
with the conversation.

## Decision

Adopt a Codex-like information hierarchy without copying Codex source or
branding:

1. **Workspace rail** — current workspace, recent task slots, connection state,
   and a clear Settings entry;
2. **Conversation column** — a message/run timeline as the primary surface, an
   empty conversation state when idle, and a compact composer docked below the
   stream. Approval and recovery cards stay inline with the timeline;
3. **Context rail** — read-only Goal projection, transport/sandbox summary, and
   guardrails. It can collapse into a Details drawer.

The three regions share the existing React components and daemon contracts. The
change is presentation-only: it does not add a second run stream, scheduler,
Goal writer, or tool execution path. Settings become an authenticated drawer or
sheet; the existing guided controls stay intact and preserve their validation
and secret-handling behavior.

## Responsive variants

| Viewport family | Composition | Primary interaction |
| --- | --- | --- |
| Wide desktop / ultrawide | Workspace rail + conversation + persistent context rail | Keyboard-friendly composer and inline approvals |
| Standard desktop / tablet landscape | Narrow workspace rail + conversation; context rail can collapse | Keep run and Goal visible together when width allows |
| Portrait monitor / tablet portrait | Compact top navigation + conversation; context below or Details sheet | Single reading flow, no horizontal scrolling |
| Fold cover / ordinary phone | Conversation only, compact top bar, bottom Details/Settings sheets | Full-width composer and equal-width approval actions |
| Unfolded fold / wide fold / tri-fold | Two panes when `width/aspect-ratio` affords it; otherwise portrait stack | Preserve pane order around hinges without device sniffing |

Width and `aspect-ratio` decide density; no UA, model, hinge API, or device
identity is stored. `prefers-reduced-motion`, safe-area insets, keyboard focus,
and 44px touch targets remain mandatory.

## Interaction contract

- The active conversation is the first meaningful content after the top bar;
  the composer is the last action in that flow, not an onboarding form above
  an empty result panel.
- The wide desktop grid keeps all three regions inside the viewport: the
  workspace rail remains narrow, the conversation column is the flexible
  column, and the Goal/context rail is bounded and shrink-safe.
- Settings never push the conversation off-screen on desktop; they open as a
  dismissible drawer with an explicit close button and Escape support.
- Goal projection remains read-only and uses the existing authenticated API.
- Approval and recovery cards stay inline with the run timeline; actions are
  never hidden behind the settings drawer.
- Pairing remains fail-closed. Before pairing, the conversation area shows the
  pairing gate and does not expose authenticated controls.
- No secret, host path, token, or device posture is added to browser storage or
  screenshot fixtures.

## Acceptance

- React smoke tests prove the conversation-first landmarks, drawer semantics,
  Goal read-only label, and unchanged security/settings controls.
- CSS contract tests cover the three-column desktop, two-pane tablet, and
  conversation-only phone rules.
- Manual visual review may use local screenshots during development, but no
  screenshot fixture or image is required in the repository acceptance set.

## Deferred

Multi-session history, server-side transcript search, native split-screen APIs,
and a fully paginated diff/review workspace remain later milestones.

Implementation note: the wide context rail also contains the connection,
sandbox, and guardrail summaries. Keeping those summaries beside Goal avoids a
second status dashboard in the workspace navigation rail.
