# Spec 37: Ratio-first responsive Web experience

**Status: Accepted (implemented; visual screenshots deferred)**

**Date: 2026-08-03**

## Goal

Make the VibeGo console usable across desktop monitors, portrait monitors,
phones, foldables, wide foldables, tri-fold devices, and tablets. The layout
must adapt from the viewport's width and aspect ratio rather than assuming a
single device class or merely shrinking the desktop view.

## Design contract

- CSS is the source of truth for responsive behavior; no user-agent sniffing,
  device database, or JavaScript viewport classifier is allowed.
- Breakpoints use both `min/max-width` and `min/max-aspect-ratio`. Width controls
  touch target and text density; aspect ratio controls pane ownership and
  navigation placement.
- Every layout keeps the pairing gate, run composer, approval controls, Goal
  read-only projection, and safety guidance reachable without horizontal
  scrolling or clipped controls.
- The browser stores only the non-secret run profile. Device posture, host
  paths, tokens, and model credentials never enter browser storage.
- `prefers-reduced-motion`, zoom, keyboard focus, safe-area insets, and coarse
  pointer input are first-class constraints. Touch targets remain at least
  44px.

## Ratio buckets and UX intent

| Bucket | Representative viewports | UX composition |
| --- | --- | --- |
| Wide desktop | 21:9, 16:9, 16:10; width ≥ 1280 | Persistent left summary rail, main run/Goal column, four-column settings grid, generous output height. |
| Standard desktop | 3:2, 4:3; width 900–1279 | Two-column shell with a narrower rail, three-column settings, no density that hides approval actions. |
| Portrait desktop | 9:16 or 10:16; width ≥ 900 | Single reading column, summary becomes a top strip, settings become two columns, run/approval actions stay near the output. |
| Tablet landscape | 4:3, 3:2, 16:10; width 768–1199 | Two-pane shell when ratio ≥ 1.15; otherwise the portrait tablet composition. |
| Tablet portrait / wide fold | 4:3, 3:2, ~8:7; width 600–899 | Single column with a compact top navigation; Goal metrics use two columns and settings use two columns. |
| Fold cover / ordinary phone | ~21:9 cover, 19.5:9, 16:9; width ≤ 599 | Phone-first stack, full-width composer and approval buttons, one-column settings, compact Goal cards. |
| Unfolded fold / tri-fold | ratio 1.15–1.80; width 600–1399 | Treat as tablet landscape only when the ratio affords two panes; otherwise use the tablet portrait stack. No hinge-specific assumptions. |

The buckets intentionally overlap at boundaries. The more conservative
composition wins: narrow width wins over ratio, and a portrait ratio wins over
desktop density. This prevents a tall browser window or a folded cover screen
from receiving clipped desktop controls.

## Component behavior

1. **Topbar and navigation**: wide desktop keeps brand and connection status in
   one row; portrait and phone layouts use a compact top strip. The connection
   state remains visible in every bucket.
2. **Settings**: grid columns change by bucket (4 → 3 → 2 → 1). Workspace,
   model, sandbox, and tool sections remain grouped with clear headings; no
   section is hidden solely because the viewport is narrow.
3. **Run composer**: the message field keeps readable line length. On phone and
   portrait layouts the submit action becomes full width and follows the field.
4. **Approval/recovery**: action buttons never share a clipped horizontal row;
   phone and portrait modes stack them with equal width.
5. **Goal projection**: wide views use four metric columns; tablet and portrait
   views use two; phone cards stack owner/status metadata while retaining the
   read-only label and refresh action.
6. **Run output and tool inspector**: output gets a bounded height per bucket;
   narrow views avoid nested horizontal scroll and preserve safe text wrapping.

## Verification

The responsive contract is verified by CSS and React unit tests. Manual visual
screenshots are useful during design review but are intentionally not stored in
the repository or embedded in the README files; the frontend only needs to
remain usable at the documented width/aspect-ratio buckets.

## Deferred

Native hinge APIs, fold-segment CSS environment variables, orientation locks,
per-device pixel-density tuning, and a separate native shell remain deferred.
