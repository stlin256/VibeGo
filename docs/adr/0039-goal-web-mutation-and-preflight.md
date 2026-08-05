# ADR 0039: Goal Web mutation and side-effect-free governed preflight

- Status: accepted for implementation (58-4a)
- Date: 2026-08-05
- Scope: authenticated Web Goal workflow and daemon preflight projection

## Context

The daemon already exposes a bounded Goal write API and an explicit governed
admission service, while the conversation-first Web shell only renders a
read-only Goal projection. Users therefore cannot maintain a Goal or understand
why a governed run is blocked without reading daemon logs. Calling the governed
run route merely to discover readiness would be unsafe because admission may
persist an admission decision, binding and quota reservation before starting a
run.

## Decision

Add a Web mutation client/UI over the existing authenticated Goal write routes,
and add a separate `POST /api/v1/goals/:goalId/preflight` application port. The
preflight port replays the authoritative Goal Control stream and asks existing
capability, WorkspaceRegistry, Scheduler, Approval and Sandbox readiness ports
for bounded read-only decisions. Its response contains only safe identifiers,
revisions, checksums, status and bounded reasons.

Preflight is never an admission shortcut: it does not append to `goal_events`,
touch `run_events`, reserve or consume quota, create a `GoalRunBinding`, acquire
a Scheduler lease, grant approval, launch a sandbox, invoke a model, or call a
tool. A later governed submit must re-run the same checks through
`GoalAdmissionService`; a stale preflight is not a capability grant.

The Web keeps event ids and transient form state in memory only. It does not
store claim tokens, API keys, cookies, private keys, absolute paths, complete
transcripts or raw tool output in browser storage or API responses.

## Consequences

The first Goal workflow is useful without changing ordinary interactive runs and
gives users an explainable, fail-closed readiness view. Claim/release token UX,
governed submit, terminal writeback/recovery and real-device validation remain
separate slices so each can be tested and merged independently.

## Rejected alternatives

- Reusing `POST /api/v1/runs/governed` as a dry-run: rejected because it can
  persist admission/binding/quota state and is not a read-only operation.
- Computing readiness only in React: rejected because browser state cannot be
  authoritative for Scheduler, Approval, Sandbox or server policy revisions.
- Adding a Web-only scheduler or approval store: rejected because existing
  daemon authorities remain the single source of truth.
