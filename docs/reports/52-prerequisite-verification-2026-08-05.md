# Spec 52 prerequisite verification (2026-08-05)

This report is the mandatory pre-implementation gate for Spec 52. It was
recorded from the clean `main` checkout before any Capability Profile runtime
code was added.

## Checkout and toolchain

| Check | Evidence |
| --- | --- |
| Branch/worktree | `main`, clean, tracking `origin/main`; `git diff` and `git diff --cached` empty |
| Repository | `https://github.com/stlin256/VibeGo.git` |
| Package manager | `pnpm@11.9.0` from `package.json` |
| Runtime | Node `v24.14.0` (bundled runtime; PATH was augmented only for validation) |
| Workspace graph | 23 projects declared by `pnpm-workspace.yaml`; 22 package/app projects participate in build/typecheck/test |
| Lockfile | `pnpm-lock.yaml` present and used by the current checkout |

## Prerequisite map

Status is scoped to the boundary that Spec 52-R0/R1 may rely on. A later
release requirement can remain planned without being silently treated as
implemented.

| Prerequisite | Status for 52-R0/R1 | Source and test evidence | Later gap / constraint |
| --- | --- | --- | --- |
| Spec 25 configuration onboarding | verified | `apps/web/src/api.ts`, `apps/web/src/App.tsx`, `apps/web/src/api.test.ts`, `apps/web/src/App.test.tsx` | Capability Profile onboarding is the new Spec 52 slice; no duplicate settings authority may be added. |
| Spec 27 profile persistence | verified | `loadRunProfile`/`saveRunProfile` and Web API tests | Only bounded non-secret browser preferences are persisted. |
| Spec 28 model onboarding | verified | `apps/daemon/src/model-config.ts`, `apps/daemon/src/model-config.test.ts`, model contract tests | Credential/keyring improvements remain outside R0/R1. |
| Spec 30 external shell/sandbox wiring | verified | `apps/daemon/src/sandbox-settings.ts`, sandbox settings tests, tool-adapter tests | Shell remains explicit and default-off; no host fallback. |
| Spec 31 workspace registry | verified | `packages/workspaces/src/index.ts`, workspace tests, daemon workspace tests | Profile stores only a workspace id; roots remain daemon-private. |
| Spec 36 durable settings | verified | `packages/storage/src/settings.ts`, storage settings tests, workspace persistence tests | `daemon_settings` is not an event source and cannot widen run authority. |
| Spec 37 ratio-first UI | verified | `apps/web/src/styles.test.ts`, `device-matrix.test.ts`, `performance-report.test.ts` | Visual screenshots are intentionally not a repository gate. |
| Spec 38 conversation-first shell | verified | `apps/web/src/components/vibego/*`, `ConversationShell.test.tsx`, `App.test.tsx` | Profile UI must stay in the existing drawer/sheet and keep the composer first. |
| Spec 40 Goal write API | verified | `packages/goal-control/src/write.ts`, `goal-write.test.ts`, daemon goal-write API tests | Goal admission is still explicit and is not connected to default `POST /runs`. |
| Spec 41 Host-first boundary | partially implemented (umbrella) | Same-origin contract is implemented by Spec 51 R1–R4; ADR 0010 remains authoritative. | Installer/signing and future transport adapters remain later release work; status wording is normalized in this docs commit. |
| Spec 42 Web design system | verified | Local UI primitives and VibeGo composition tests; `pnpm check:module -- @ready4vibe/web` | New profile UI must reuse existing components; no second UI framework. |
| Spec 48 approval/sandbox/shell | verified for R1–R4 | `packages/policy`, `packages/sandbox-runtime`, `apps/daemon` approval fixtures; focused package tests | VM/remote execution and broader release closure remain outside R0/R1. |
| Spec 49 MCP/Skill lifecycle | verified for opt-in R1–R4 | `packages/skill-mcp`, `packages/tool-adapters`, daemon activation/lifecycle tests and local smoke fixtures | MCP remains off by default; no profile may auto-start a server. |
| Spec 51 Host-first release | verified for R1–R4 | static Web, launcher, certificate readiness and `@ready4vibe/client-sdk` fixtures | R3b ACME/OS-store/renewal and signed release artifacts remain planned. |
| `docs/harness-contracts.md` | verified | Run state, snapshots, approval, sandbox, MCP, transport, settings and Goal boundaries match the current source/tests | Any new profile contract must narrow, never bypass, these authorities. |

## Validation commands

The required full gate passed before this report was written:

```text
pnpm verify
  typecheck: passed
  test: passed (668 tests across 22 workspace projects)
  diff:check: passed
  git diff --check: passed
```

Focused gates also passed:

```text
pnpm check:module -- @ready4vibe/contracts @ready4vibe/context @ready4vibe/model-openai @ready4vibe/agent
pnpm check:module -- @ready4vibe/policy @ready4vibe/sandbox @ready4vibe/sandbox-runtime @ready4vibe/tools @ready4vibe/tool-adapters @ready4vibe/skill-mcp
pnpm check:module -- @ready4vibe/workspaces @ready4vibe/storage @ready4vibe/goal-control @ready4vibe/scheduler @ready4vibe/observability
pnpm check:module -- @ready4vibe/auth @ready4vibe/certificates @ready4vibe/client-sdk @ready4vibe/daemon @ready4vibe/web
```

Each focused command completed build, selected-package typecheck and selected
package tests. The command is the preferred inner loop for later Spec 52
slices; `pnpm verify` remains mandatory before each substantive commit.

## Gate decision

The prerequisite boundaries needed for the strict contract and pure resolver
are verified. The following are explicitly **not** claimed as complete and
remain release-gate work: Goal-governed admission (52-R4), Tailscale/SSH and
ACME adapters (52-R5), the cross-component core-Harness closure and redacted
live model evidence (52-R6), and installed Host acceptance (52-R7).

This report authorizes only the next isolated slice: versioned, secret-free
Capability Profile contracts and a pure resolver. It does not authorize a
change to default `RunManager` start behavior, Goal admission, AgentLoop,
Scheduler, Approval, Sandbox, WorkspaceRegistry, `run_events` or
`goal_events`.
