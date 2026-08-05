# Spec 58-0 prerequisite verification (2026-08-05)

This report is the mandatory prerequisite gate for Spec 58. It records the
current checkout, focused evidence, and the boundary that the next Goal
Control slice is allowed to change. It does not authorize governed admission
or any change to the default interactive run path.

## Checkout and toolchain

| Check | Evidence |
| --- | --- |
| Baseline | `main` at `a129887` (`Merge codex/spec52-r3-run-snapshot: capability snapshot isolation`) was clean and tracking `origin/main`; the audit branch was created from that commit. |
| Current audit branch | `codex/spec58-0-prerequisite-audit`; no pre-existing user or agent changes were present before this documentation slice. |
| Repository | `https://github.com/stlin256/VibeGo.git` |
| Package manager | `pnpm@11.9.0` from `package.json` |
| Runtime | Node `v24.14.0` from the bundled workspace runtime; it was placed first on `PATH` only for validation and is not a repository dependency. |
| Workspace graph | `pnpm-workspace.yaml` declares `apps/*` and `packages/*`; the build/typecheck/test gate covers 22 of 23 workspace projects. |
| Lockfile | `pnpm-lock.yaml` is present and was used by the current checkout. |

## Goal Control prerequisite matrix

The status below is scoped to the current Spec 58 boundary. `verified` means
there is source and focused test evidence for the named boundary; it does not
mean that later governed execution or release evidence is complete.

| Prerequisite | Status | Source and evidence | Remaining constraint |
| --- | --- | --- | --- |
| Spec 34 Goal contracts and pure replay | verified (A/B) | `packages/contracts/src/goal.ts`, `packages/contracts/src/goal.test.ts`, `packages/goal-control/src/index.ts`, `packages/goal-control/src/index.test.ts` | Existing event contract is `ready4vibe_goal_event_v0`; binding/admission/quota-reservation v1 is not present. |
| Independent durable Goal event stream | verified (C) | `packages/storage/src/goal.ts`, `packages/storage/src/goal.test.ts`; `goal_events` uses `BEGIN IMMEDIATE`, goal-local sequence and event-id conflict handling | No cross-stream transaction is allowed; reconciliation must remain an application concern. |
| Bounded Goal mutation API (Spec 40 Phase 2A) | verified (D, bounded) | `packages/goal-control/src/write.ts`, `apps/daemon/src/goal-write-api.test.ts`, authenticated daemon routes | Create/edit/claim/release/evidence mutation exists, but no governed preflight, reservation lifecycle, or run binding route exists. |
| Read-only Goal projection/replay API (Spec 35) | verified (E, read-only) | `apps/daemon/src/goal-api.ts`, `apps/daemon/src/goal-api.test.ts`, `GET /api/v1/goals` and replay routes | Browser does not own Goal state and there is no Goal workflow UI/admission yet. |
| Goal privacy boundary | verified (A–E) | Zod bounded text/ID/time checks plus `findGoalPrivacyViolations`; daemon projection redacts `claimTokenHash` | New v1 contracts must keep secrets, raw output, environment values and absolute paths rejected. |
| Model/context/AgentLoop baseline | partial (A–D; opt-in F) | `packages/model-openai`, `packages/context`, `packages/agent`, daemon run-manager tests; explicit `pnpm smoke:model` exists | No real governed daemon→RunManager→AgentLoop→ContextManager smoke with validation/quota evidence is claimed. |
| Approval/sandbox/shell baseline | partial (A–D; bounded F fixtures) | `packages/policy`, `packages/sandbox-runtime`, daemon approval fixtures, `pnpm smoke:container` | Goal admission must call these existing authorities; it may not grant, bypass or replace them. |
| MCP/Skill lifecycle | partial (A–D; opt-in F fixture) | `packages/skill-mcp`, `packages/tool-adapters`, daemon binding/lifecycle tests, `pnpm smoke:mcp` | MCP remains off by default; Goal must consume a frozen capability/readiness snapshot only. |
| Scheduler and WorkspaceRegistry | verified for existing interactive behavior; governed composition absent | `packages/scheduler`, `packages/workspaces`, `apps/daemon/src/run-manager.ts` tests | Goal service may query readiness but must not add a second queue, lock, or workspace authority. |
| Memory/Observability | partial (bounded adapters) | `apps/daemon` memory adapter/supervisor tests and `packages/observability` focused tests | Optional adapters remain fail-soft and cannot become Goal/run facts or block an interactive run. |
| Transport/certificate boundary | partial (LAN/auth/readiness) | `packages/auth`, `packages/certificates`, daemon transport tests and Spec 55 readiness projection | Tailscale/SSH/ACME and installed-host evidence remain later release work. |
| Host/release boundary | partial (manifest/contracts) | Spec 51 host/client boundary and Spec 57 `release-manifest/v1` contract tests | Installer, signing, SBOM/attestation, upgrade/rollback and real-device evidence remain planned. |

## Source audit conclusions

The checkout contains these Goal foundations:

- `GoalRunBinding` exists only as a small v0-shaped contract (`bindingId`,
  Goal/Todo references, mode and optional control revision); it is not persisted
  as a run snapshot and is not used by `RunManager`.
- `GoalShouldRunDecision` is a pure bounded decision helper. It can report
  `eligible`, but no application service turns that result into a run.
- Goal quota currently projects spent turn keys and supports a guarded
  `quota.spent` event. There is no `reserved → consumed | released | expired`
  lifecycle or exactly-once reservation ledger.
- Evidence and Todo completion have a pure validated-evidence guard, but there
  is no terminal-run verifier port, asynchronous writeback, or crash/restart
  reconciliation.
- `apps/daemon/src/main.ts` wires the independent Goal store and write/read
  APIs only. `RunManager.start` remains the sole default run creation path;
  no Goal admission service is present.

Therefore the following are explicit blockers for 58-1 and later phases:

1. Add versioned v1 contracts without invalidating existing v0 replay.
2. Define reservation/binding/evidence event semantics and deterministic
   projection rules before adding a daemon application service.
3. Keep interactive `RunManager.start` behavior and event ordering unchanged.
4. Add application integration and failure fixtures before any default-path
   wiring; fake-only or design-only tests cannot be used as release evidence.

## Validation evidence

The required focused gate for the Goal and application boundaries passed with
the bundled Node runtime:

```text
pnpm check:module -- @ready4vibe/contracts @ready4vibe/goal-control @ready4vibe/storage @ready4vibe/daemon @ready4vibe/web
  build dependency closure: passed
  selected typecheck: passed
  selected tests: passed
  contracts: 78 tests
  goal-control: 17 tests
  storage: 66 tests
  daemon: 180 tests
  web: 96 tests
```

The repository gate also passed from the same baseline:

```text
pnpm verify
  typecheck/build: passed
  test: passed (668 tests across 22 workspace projects)
  diff:check: passed
  git diff --check: passed
```

SQLite emitted only the existing Node experimental-feature warning during the
storage and daemon tests. No provider credential, network request, shell
command, MCP server, container, or live Goal admission was started by these
gates.

## Gate decision

58-0 is **verified for the documented prerequisite boundary**. It authorizes
only the next isolated slice, 58-1: versioned Goal binding/admission/quota
reservation/evidence contracts and pure reducer fixtures. It does **not** make
the following claims:

- governed admission is implemented;
- the default `POST /api/v1/runs` path is Goal-aware;
- quota can grant capability or bypass Scheduler, Approval, Sandbox or
  WorkspaceRegistry;
- a real governed LLM run or release-ready Harness evidence exists.

The existing behavior remains authoritative: unbound interactive runs continue
through `RunManager.start`, `run_events` remains independent from
`goal_events`, and Goal Control does not execute models, tools, shell, Git,
MCP, Skill or sandbox operations.
