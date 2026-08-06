# Spec 58-6f objective-aware verifier and recovery monitor evidence

- Date: 2026-08-06
- Status: implemented bounded production slice
- Scope: structured objective criteria, semantic writeback and serialized
  recovery monitoring

## Focused evidence

- `packages/contracts/src/goal.test.ts` and `goal-verifier.test.ts`: objective
  plan/snapshot privacy and strictness coverage passed.
- `apps/daemon/src/goal-execution-verifier.test.ts`: 14 tests passed, including
  digest binding, missing/forbidden criteria, automatic lanes and bounded
  result references.
- `apps/daemon/src/goal-recovery-monitor.test.ts`: 3 tests passed, including
  reconcile-before-monitor, overlapping tick serialization, bounded failure and
  timer start/stop.
- `apps/daemon/src/goal-writeback.test.ts`: 15 tests passed, including a
  governed Todo completed only after the production objective plan validated.
- `pnpm --filter @ready4vibe/contracts build`: passed.
- `pnpm --filter @ready4vibe/goal-control build`: passed.
- `pnpm --filter @ready4vibe/daemon build`: passed.
- Daemon focused invocation: 297 tests passed across the existing daemon test
  graph (Vitest workspace config also executes dependent daemon files).

The objective verifier accepts only a completed run with a successful terminal,
no negative event, matching Goal/Todo objective digest, required event types,
no forbidden event and sufficient bounded output bytes. A missing plan or
contradictory evidence is `inconclusive`; writeback releases reservation and
leaves the Todo open. The monitor never replays an old run or old tool call.

## Authority and privacy boundary

The production registry contains only the deterministic local criteria verifier
for automatic `advancement`, `monitor` and `blocker` lanes. Interactive/unbound
runs never enter Goal admission or this registry. `GoalRecoveryMonitor` calls
the existing `GoalRunWritebackService.reconcile()` and pure `shouldRun`; an
optional launcher must delegate to `GoalAdmissionService`, preserving
Scheduler, Approval, Sandbox and Workspace gates. No AgentLoop core state,
RunManager default start, `run_events`, `goal_events` or runtime authority was
changed. No prompt, transcript, raw model/tool output, command, path,
environment or secret is stored in the verifier input/result.
