# Spec 58-6e terminal-event ordering evidence (2026-08-06)

## Finding and fix

The first current-commit governed DeepSeek smoke exposed a race in the
task-specific Goal verifier boundary. `RunManager` emits the terminal status
transition immediately before the explicit `run.completed` event. Writeback
was treating both as terminal, so it could capture `run.status` as the
verifier terminal digest, record `inconclusive`, and release quota before the
authoritative terminal event arrived.

The fix makes explicit terminal events (`run.completed`, `run.failed`,
`run.cancelled`, `run.needs_recovery`) the only writeback trigger. A status-only
terminal transition is no longer enough to validate or spend quota; restart
reconciliation remains fail-closed until an explicit recovery/terminal event
is present. The Harness report now exposes only bounded validation status and
verifier id, plus a stable diagnostic label when available.

## Evidence

| Gate | Result |
| --- | --- |
| Goal writeback regression | `src/goal-writeback.test.ts`: 14/14 |
| Daemon focused suite | 287/287 before the added regression test; all tests pass after it |
| Harness workflow | 85/85 |
| Governed live smoke after fix | `healthy`; `validated`; Todo `done`; one quota consumed |

The regression test asserts that a task verifier receives `run.completed`, not
the preceding `run.status` transition. The live report contains only bounded
status, event counts, validator labels and aggregate usage; no prompt, key,
raw output, path or transcript is retained.

## Invariants preserved

- `run_events` and `goal_events` remain separate authorities;
- Goal writeback still does not execute a model, tool, shell, filesystem,
  MCP/Skill or scheduler operation;
- interactive unbound runs keep their original start path;
- only validated evidence completes Todo and consumes quota;
- duplicate terminal notifications remain idempotent.
