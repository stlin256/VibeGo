# Spec 61-0 prerequisite audit (2026-08-05)

This report is the mandatory prerequisite gate for Spec 61. It audits the
current checkout against Spec 01 through Spec 60, including the already
existing Spec 58 and Spec 59 documents. It is a status matrix, not a release
claim. The audit deliberately distinguishes source/test evidence from real
provider, real-device, remote, certificate, and release evidence.

## Gate decision

**61-0: verified for the prerequisite-audit boundary only.** The repository
does contain Spec 58 and Spec 59:

- [Spec 58](../specs/58-goal-control-and-harness-completion.md) is Draft with
  58-0 through 58-5 implementation slices recorded. Governed admission remains
  explicit, and 58-6/58-7 plus complete recovery and release evidence are open.
- [Spec 59](../specs/59-permission-profiles-and-low-interruption-approval.md) is
  Draft with 59-1 through 59-5 slices recorded. The safe profile, bounded
  approval posture, full-host confirmation boundary, Web controls, and opt-in
  smoke fixture exist; production host execution, cross-platform/container and
  release evidence remain partial.

Because required `partial`, `blocked`, and `not-run` items remain, this report
does **not** authorize rewriting the README as release-ready, changing the
default run path, or marking Spec 61 complete.

## Checkout, toolchain, and workspace graph

| Check | Current evidence |
| --- | --- |
| Commit / branch | `d462ca1` on `main`; worktree clean; `main` tracks `origin/main` at the same commit after the Spec 61 gate push. |
| Remote | `https://github.com/stlin256/VibeGo.git` (`origin`). |
| Package manager | `pnpm@11.9.0` from `package.json`. |
| Node runtime | Bundled workspace Node `v24.14.0` (`codex-primary-runtime`); it is used only as a validation runtime and is not committed. |
| Workspace graph | `pnpm-workspace.yaml` declares `apps/*` and `packages/*`; 2 apps plus 20 packages = 22 workspace projects. |
| Lockfile | `pnpm-lock.yaml` exists and was not changed by this audit. |
| Secret boundary | No provider key, private key, cookie, browser storage, or user workspace was read or written. Provider environment presence was checked only as a boolean and no value was emitted. |
| Authority boundary | No change was made to `run_events`, `goal_events`, AgentLoop, RunManager default start, Scheduler, Approval, Sandbox, WorkspaceRegistry, or the interactive run route. |

## Evidence legend

| ID | Evidence and limitation |
| --- | --- |
| E1 | Current commit: `pnpm test:workflow` passed **59/59**. This is the fixed, bounded workflow fixture suite; it is not a full release gate. |
| E2 | Prior full gate at `8876a99`: `pnpm verify` passed 22 workspace projects and 796 tests. It predates the later certificate/performance implementation commits, so it is stale for the current commit and must be rerun before release claims. |
| E3 | User-authorized DeepSeek success smoke for interactive and explicit governed routes, with bounded redacted reports and governed Todo/quota writeback. No live failure/timeout/cancel evidence was collected. |
| E4 | Model fixture evidence: `smoke-model` 7/7 and `@ready4vibe/model-openai` 19/19. Missing credentials, provider errors, timeout/abort and malformed streams are fixture coverage only. |
| E5 | Permission, recovery, transport, MCP, container and Harness fixtures are bounded and redacted; they prove application boundaries, not production host/remote behavior. |
| E6 | Certificate focused package evidence: 17/17 tests plus typecheck/build; rotation is an injected in-memory controller. It does not prove ACME, OS certificate stores, public listeners, or daemon integration. |
| E7 | Observability/performance evidence: `@ready4vibe/observability` 66/66 and a bounded performance fixture with two runs, peak concurrency 2, p95 about 120 ms, two samples and zero drops. It is not a capacity or cross-platform result. |
| E8 | Required real-device matrix, ACME, Tailscale/SSH, signed release artifacts, SBOM/provenance, clean-machine install/upgrade/rollback and production host-runner evidence are absent or explicitly deferred. |

## Spec 01–60 matrix

`verified (bounded)` means source and focused tests cover the documented slice;
it does not imply real deployment evidence. `partial` means a slice exists but
the spec's later phase or required runtime evidence is open. `blocked` means a
required gate cannot be honestly claimed from this checkout.

| Spec | Source / implementation boundary | Focused or full evidence | Real/runtime evidence | Status | Next gate / blocker |
| --- | --- | --- | --- | --- | --- |
| 01 | `packages/policy`, `packages/sandbox`, `packages/agent` | E1/E2 | bounded fixtures | verified (bounded) | production host/container evidence remains outside this slice |
| 02 | `packages/contracts`, `packages/storage` run/event schemas | E1/E2 | SQLite fixture only | verified (bounded) | retain event ordering and privacy checks |
| 03 | `packages/contracts`, `packages/context`, `packages/model-openai` | E1/E2/E4 | E3 success only | partial | real provider failure and context-limit evidence (60-4) |
| 04 | `packages/storage`, daemon health and event store | E1/E2 | local SQLite only | verified (bounded) | clean-host restart evidence (60-3) |
| 05 | `packages/testkit`, `packages/agent` fake loop | E1/E2 | deterministic fake provider | verified (bounded) | no fake result may substitute for E3/E4 live evidence |
| 06 | daemon run API and SSE replay | E1/E2/E3 | local daemon only | partial | remote disconnect/reconnect and device evidence (56/60) |
| 07 | ContextManager/model context budgeting | E1/E2/E4 | fixture and one live success | partial | failure, truncation and privacy evidence (60-4) |
| 08 | AgentLoop daemon provider integration | E1/E2/E3 | live success only | partial | provider failure/recovery and run snapshot proof |
| 09 | Tool registry and deterministic ApprovalPolicy | E1/E2 | policy fixtures | verified (bounded) | production tool execution remains gated by 48/59 |
| 10 | SandboxResolver, PathGuard, ArgvGuard | E1/E2/E5 | container/host fixtures only | partial | cross-platform sandbox evidence and fail-closed host path |
| 11 | filesystem/shell adapters and ToolExecutor | E1/E2/E5 | injected/local fixtures | partial | real approved tool run plus resource cleanup |
| 12 | `packages/auth` and daemon transport gate | E1/E2/E5 | loopback/LAN negative fixture | partial | remote transport and disconnect evidence |
| 13 | React/TypeScript PWA shell | E1/E2 | browser fixture only | partial | real browser/device matrix (56/61-6) |
| 14 | `packages/certificates`, HTTPS readiness | E1/E2/E6 | in-memory certificate lifecycle | partial | ACME/OS store/public listener evidence (55/60-6) |
| 15 | Skill/MCP manifest and allowlist | E1/E2/E5 | local manifest/transport fixture | partial | authorized remote server and release evidence |
| 16 | external sandbox runtime planning/resolver | E1/E2/E5 | Docker/Podman planning fixture | partial | installed runtime on target platforms |
| 17 | Docker/Podman CLI runner | E1/E2/E5 | bounded CLI fixture | partial | cross-platform runner and cleanup evidence |
| 18 | AgentLoop/daemon tool wiring | E1/E2/E5 | injected tool path | partial | approved production tool path without authority bypass |
| 19 | one-shot MCP JSON-RPC transport | E1/E2/E5 | local stdio/HTTP fixture | partial | remote transport, cancellation and release evidence |
| 20 | ToolExecutor runtime bridge | E1/E2 | bounded bridge tests | partial | real sandbox/approval/resource integration |
| 21 | approval continuation broker/API/Web card | E1/E2/E5 | in-memory approval fixture | partial | host runner, expiry/restart and device evidence |
| 22 | restart recovery marker | E1/E2/E5 | deterministic restart fixture | verified (bounded) | clean daemon restart/install evidence |
| 23 | explicit post-recovery retry | E1/E2/E5 | bounded retry fixture | partial | verify no old tool replay under real recovery |
| 24 | certificate status projection | E1/E2/E6 | safe metadata fixtures | partial | live certificate lifecycle and public deployment |
| 25 | configuration onboarding/settings | E1/E2 | Web/API fixtures | partial | clean-checkout user walkthrough (61-3) |
| 26 | certificate guidance in settings | E1/E2/E6 | Web metadata fixture | partial | ACME/installed certificate evidence |
| 27 | non-secret profile persistence | E1/E2 | persistence/restart fixtures | verified (bounded) | full clean-host first-run proof |
| 28 | model provider onboarding | E1/E2/E4 | bounded probe fixtures; E3 success | partial | secret-store/real failure evidence |
| 29 | explicit filesystem tool wiring | E1/E2/E5 | guarded adapter fixtures | partial | approved real workspace run and cleanup |
| 30 | guided external shell/sandbox wiring | E1/E2/E5 | container fixture | partial | host/container parity and remote evidence |
| 31 | workspace registry | E1/E2 | registry/settings fixtures | verified (bounded) | clean-host and multi-device UX evidence |
| 32 | guided Git read-only tools | E1/E2/E5 | bounded argv/path fixtures | partial | real approved workspace Git evidence |
| 33 | bounded tool-output inspector | E1/E2 | Web rendering fixtures | partial | accessibility/device and long-output evidence |
| 34 | native Goal Control Phase 0/1 | E1/E2 | contract/replay/SQLite fixtures | partial | governed closure is tracked by Spec 58; no LoopX/Python runtime |
| 35 | authenticated Goal read-only projection | E1/E2 | daemon/Web focused tests | verified (bounded) | governed mutation/recovery UX remains later |
| 36 | durable `daemon_settings` workspace boundary | E1/E2 | SQLite restart/rollback fixtures | verified (bounded) | retain independent `run_events`/`goal_events` authorities |
| 37 | ratio-first responsive UI | E1/E2 | viewport fixtures | partial | real desktop/portrait/phone/fold/tri-fold/tablet matrix (56) |
| 38 | conversation-first Web shell | E1/E2 | Web focused tests | partial | real device, accessibility and recovery walkthrough |
| 39 | TencentDB Agent Memory adapter/sidecar boundary | E1/E2 | bounded adapter/supervisor fixtures | partial | upstream sidecar/live health and rollback evidence |
| 40 | Goal write API and bounded mutations | E1/E2 | authenticated mutation/preflight tests | partial | governed submit, terminal verifier and recovery (58) |
| 41 | host-first distribution/client boundary | E1/E2 | contract/launcher fixtures | partial | installable host and future-client interoperability |
| 42 | shadcn-style Web design system | E1/E2 | component/Web tests | partial | visual/accessibility/device acceptance |
| 43 | resource/token/cost audit | E1/E7 | observability/performance fixtures | partial | physical-device and long-run resource measurements |
| 44 | provider/usage management and upstream reuse | E1/E2/E4 | provider/settings fixtures | partial | durable credential adapter and upstream license audit |
| 45 | observability API/Web projection | E1/E7 | 66/66 package evidence | partial | lifecycle/resource/pricing production evidence |
| 46 | automated verification workflow | E1 plus verification fixtures | E1 current; E2 stale full gate | partial | rerun complete `pnpm verify` on current commit |
| 47 | model/context/AgentLoop productionization | E1/E2/E3/E4 | live success plus fixtures | partial | authorized provider failure/recovery and context limits |
| 48 | approval/sandbox/shell runtime closure | E1/E2/E5 | bounded policy/runner fixtures | partial | production host runner and cross-platform evidence |
| 49 | MCP/Skill capability lifecycle | E1/E2/E5 | local opt-in session smoke | partial | remote server, cancellation, release and security evidence |
| 50 | observability lifecycle integration | E1/E7 | package and bounded lifecycle fixtures | partial | automatic resource/pricing and restart evidence |
| 51 | host-first release/client boundary | E1/E2 | launcher/release contracts | partial | installer, client boundary and clean-host proof |
| 52 | capability profiles/first-run | E1/E2/E5 | settings/snapshot fixtures | partial | complete first-run and real permission execution |
| 53 | host install/upgrade/backup/recovery | E1/E2 | manifest/SQLite adapter fixtures | partial | installer/upgrade/daemon route and clean-machine evidence |
| 54 | model-provider onboarding | E1/E2/E4 | strict probe/settings fixtures | partial | provider/run behavior and secret-store production evidence |
| 55 | public deployment/certificate operations | E1/E6 | rotation controller 17/17 | blocked for release | ACME, renewal, rollback, public listener and runbook evidence |
| 56 | i18n/accessibility/device matrix | E1/E2 | pure Web/ratio fixtures | blocked for real-device release | manual screen-reader and real device matrix |
| 57 | release publishing/supply-chain proof | E1/E2 | `release-manifest/v1` contract only | blocked | GitHub workflows, artifacts, checksum, SBOM, signing and provenance |
| 58 | Goal Control/Harness completion umbrella | E1/E3/E5 | 58-0..58-5 slices and bounded Harness | partial | 58-6/58-7, task validation, failure/recovery and release evidence |
| 59 | permission profiles/low-interruption approval umbrella | E1/E5 | 59-1..59-5 slices and permission smoke | partial | production host runner, cross-platform/container and release evidence |
| 60 | complete verification/release evidence gate | E1; E2 is stale | focused fixtures only | blocked | current full verify, real failures, governed validation, remote/cert/device and release bundle |

## Required blockers and re-acceptance commands

| Blocker | Owner role | Return / fallback spec | Re-acceptance evidence |
| --- | --- | --- | --- |
| Full gate is stale for `d462ca1` | Harness maintainer | Spec 60-1/60-2 | `pnpm verify` plus `pnpm diff:check` and `git diff --check` |
| Real provider failure/timeout/cancel and context-limit path absent | Model/runtime maintainer | Spec 60-4 and Spec 47 | Explicitly authorized live smoke with bounded timeout/cost; keep E4 fixture as negative control |
| Task-specific governed validation, writeback and crash/retry closure incomplete | Goal/daemon maintainer | Spec 58-6 and Spec 60-3 | `pnpm smoke:harness` plus independent verifier/recovery evidence; no default interactive admission |
| Permission host runner and container/platform parity incomplete | Security/runtime maintainer | Spec 59-5 and Spec 48 | `pnpm smoke:permissions`, `pnpm smoke:container`, target-platform cleanup evidence |
| ACME, public certificate lifecycle, Tailscale and SSH absent | Transport/release maintainer | Spec 55 and Spec 60-6 | staging-only ACME plus explicit remote adapter smoke; otherwise remain `blocked` |
| Real device/accessibility matrix absent | Web/accessibility maintainer | Spec 56 and Spec 61-6 | manual desktop/portrait/phone/fold/tri-fold/tablet and screen-reader report |
| Install/upgrade/rollback, signing, SBOM and provenance absent | Release maintainer | Spec 53/57 and Spec 60-8 | clean-machine artifact workflow with immutable manifest/checksum/signature/attestation |

## Allowed next action

Until the blockers above are either verified or explicitly recorded as a
release limitation, Spec 61 may proceed only with documentation corrections,
focused tests, and bounded implementation slices that preserve the existing
authorities. In particular:

- do not rewrite README or `README-zh.md` to imply release-ready Goal,
  full-host, ACME, Tailscale/SSH, real-device, or signed-release support;
- do not connect Goal admission to the default interactive `POST /api/v1/runs`
  route;
- do not replace `run_events` with `goal_events`, add a second scheduler, or
  bypass Approval/Sandbox/WorkspaceRegistry;
- do not put provider credentials, private keys, raw transcripts, tool output,
  absolute paths, or complete environment values in documentation or evidence.
