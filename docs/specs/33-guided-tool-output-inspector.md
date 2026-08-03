# Spec 33: Guided tool-output inspector

Status: Implemented (MVP slice)

## Goal

Make bounded tool results visible in the remote Web run console. The first
consumer is the Spec 32 Git read-only slice: users should be able to inspect
`git.status`, `git.diff`, and `git.log` output without opening a second shell or
guessing what the agent received. This is a presentation-only slice over the
existing SSE event stream.

## Safety and resource contract

- No new daemon route, process capability, approval path, or model input is
  introduced. The Web client consumes only `tool.requested`, `tool.started`,
  and bounded `tool.output` events already emitted by the AgentLoop.
- Tool output is rendered as React text/preformatted text; event payloads are
  never interpreted as HTML or executable markup.
- The browser renders at most 24 recent tool outputs and at most 128 KiB of
  UTF-8 text per output. Long content is visibly marked as display-truncated;
  the server-side output cap and event sequence remain authoritative.
- Output cards are not persisted. They disappear on refresh and are rebuilt
  from the current run snapshot/SSE replay; tokens, keys, certificate material,
  and absolute host paths are not copied to browser storage.
- The inspector keeps a call id to tool id mapping from safe event metadata. If
  an event is malformed or unknown, it is ignored or shown as “Tool output”;
  malformed data must not break the run console.
- Git output is displayed as bounded text with the adapter's `[workspace]`
  redaction intact. The inspector does not add Git write, remote, patch, or
  arbitrary command controls.

## Guided Web behavior

The Run Console adds a compact “TOOL OUTPUTS” section when output events exist:

1. each card identifies the fixed tool id (for example `git.diff`) and call;
2. cards show byte count and server/display truncation indicators;
3. `<details>` keeps large output collapsed by default on mobile while allowing
   an explicit user expansion; and
4. status/diff/log text is readable without exposing a daemon-machine path.

The existing event timeline remains the source of truth and continues to
support SSE resume by sequence. This slice does not add pagination or syntax
highlighting; those remain later UI work.

## Acceptance tests

- Web render tests show Git tool output, byte/truncation metadata, and safe
  text rendering without echoing an absolute path.
- Malformed output payloads and unknown call ids do not throw or render unsafe
  markup.
- Display limits cap each output and the total number of cards.
- Existing API/SSE, typecheck, full unit tests, diff check, and secret scan
  remain green without a model, Git process, network, or container runtime.

## Implementation evidence (2026-08-03)

- `apps/web/src/App.tsx` now projects safe `tool.output` events into a
  collapsed, responsive inspector. Git output is formatted as text with exit
  code/stderr metadata and no new execution control.
- The projection keeps only the latest 24 cards and truncates each rendered
  value to 128 KiB UTF-8, while displaying server/display truncation markers.
  Unknown or malformed payloads fall back to a safe text card or are ignored.
- Web render tests cover Git output, HTML escaping, malformed events, and the
  card-count limit. No daemon route or browser-storage schema changed.

## Explicitly deferred

Paginated output/diff APIs, syntax highlighting, patch application, inline
review comments, search/export, durable transcript storage, and server-side
redaction of arbitrary workspace content remain separate specs.
