# Spec 62-0 prerequisite audit (2026-08-06)

This is the fresh prerequisite matrix required before the Spec 62 user-facing
documentation phases. It audits the current `main` checkout against Spec 01–61
and records evidence strength separately from release claims.

## Gate decision

**62-0 audit: complete; Spec 62 release-documentation gate: constrained.** The
matrix is current for commit `0a41cb4`, but it does not authorize claims that
remain `partial`, `blocked`, or `not-run`. README changes may correct bounded
status, setup and safety guidance; they must not call the project release-ready
until Spec 60 and the required runtime/device/release gates are complete.

## Checkout and toolchain

| Check | Evidence |
| --- | --- |
| Branch / commit | `main` / `0a41cb4` (`origin/main`); clean worktree at audit start |
| Remote | `origin` points to the public VibeGo repository |
| Package manager | `pnpm@11.9.0` from `package.json` |
| Node | bundled validation runtime `v24.14.0` |
| Workspace graph | `pnpm-workspace.yaml`: `apps/*` and `packages/*`, 22 projects |
| Lockfile | `pnpm-lock.yaml` present; not changed by this audit |
| Workflow fixture | `pnpm test:workflow`: **78/78 passed** |
| Focused current slice | contracts 112/112, model-deepseek 20/20, daemon 247/247; affected typecheck/build gates pass |
| Full static/unit gate | `pnpm verify`: passed typecheck, build, all workspace test jobs, `diff:check` and `git diff --check` |
| Secret boundary | no provider key, private key, cookie, full environment, or user workspace was read or written |

## Evidence legend

| ID | Meaning and limit |
| --- | --- |
| E1 | Current bounded workflow fixture, 78/78; not a full release gate |
| E2 | Focused package/application tests and typechecks recorded in the implementation status; only affected current slices were rerun |
| E3 | Explicitly authorized DeepSeek text/governed/cancel/context-limit reports from the preceding live commit; no broad capacity or provider-failure claim |
| E4 | Existing model, permission, recovery, transport, MCP, container, certificate and performance fixtures; they prove bounded application behavior only |
| E5 | Current full static/unit `pnpm verify` at `0a41cb4`; does not cover live/remote/device/release gates |
| E6 | Required physical devices, public ACME/TLS, Tailscale/SSH, clean-host install, signing/SBOM/attestation and production host-runner evidence |

## Spec 01–61 matrix

`verified (bounded)` means the documented contract or fixture is covered. It
does not mean production deployment. `partial` means implementation exists but
the spec's later phase or runtime evidence is open. `blocked` means a required
gate cannot honestly be claimed from this checkout.

| Spec | Source / focused evidence | Runtime evidence | Status | Return gate |
| --- | --- | --- | --- | --- |
| 01 | policy/sandbox/agent; E1/E2 | bounded fixtures | verified (bounded) | host/container release evidence |
| 02 | contracts/storage events; E1/E2 | local SQLite | verified (bounded) | retain ordering/privacy |
| 03 | contracts/context/model; E1/E2/E3 | live success only | partial | real failure/context-limit bundle |
| 04 | storage/daemon health; E1/E2 | local restart | verified (bounded) | clean-host restart |
| 05 | testkit/fake loop; E1/E2 | deterministic provider | verified (bounded) | never replace live evidence |
| 06 | run API/SSE; E1/E2/E3 | local daemon | partial | remote reconnect/device |
| 07 | ContextManager; E1/E2/E3 | bounded live success | partial | truncation/failure/privacy |
| 08 | AgentLoop/provider binding; E1/E2/E3 | live success only | partial | failure/recovery snapshot |
| 09 | tools/ApprovalPolicy; E1/E2 | policy fixtures | verified (bounded) | production tool gate |
| 10 | sandbox/path/argv guards; E1/E2/E4 | bounded runners | partial | cross-platform sandbox |
| 11 | filesystem/shell adapters; E1/E2/E4 | injected fixtures | partial | approved real tool cleanup |
| 12 | auth/transport; E1/E2/E4 | LAN negative fixture | partial | remote disconnect/TLS |
| 13 | React/TS Web; E1/E2 | browser fixtures | partial | real device/accessibility |
| 14 | certificates; E1/E2/E4 | in-memory rotation | partial | ACME/OS store/public listener |
| 15 | Skill/MCP manifest; E1/E2/E4 | local opt-in | partial | remote/release security |
| 16 | external sandbox resolver; E1/E4 | planning/fixture | partial | installed runtimes |
| 17 | container CLI runner; E1/E4 | bounded CLI | partial | target platform cleanup |
| 18 | AgentLoop tool wiring; E1/E4 | injected tool path | partial | production approved path |
| 19 | MCP JSON-RPC; E1/E4 | local stdio/HTTP | partial | remote cancellation/release |
| 20 | ToolExecutor bridge; E1/E2 | bounded bridge | partial | real sandbox/approval |
| 21 | approval continuation; E1/E4 | in-memory approval | partial | expiry/restart/device |
| 22 | restart marker; E1/E4 | deterministic recovery | verified (bounded) | clean daemon install |
| 23 | explicit retry; E1/E4 | bounded no-replay | partial | real recovery no replay |
| 24 | certificate status; E1/E4 | metadata only | partial | lifecycle/public deploy |
| 25 | onboarding/settings; E1/E2 | Web/API fixtures | partial | clean-checkout walkthrough |
| 26 | certificate guidance; E1/E4 | Web metadata | partial | ACME/installed cert |
| 27 | durable profiles; E1/E2 | restart fixtures | verified (bounded) | clean-host first run |
| 28 | model onboarding; E1/E2/E3 | bounded probe/live success | partial | secret-store/failure |
| 29 | filesystem wiring; E1/E4 | guarded fixtures | partial | approved real workspace |
| 30 | shell/sandbox guidance; E1/E4 | container fixture | partial | host/container parity |
| 31 | workspace registry; E1/E2 | settings fixtures | verified (bounded) | clean-host/device UX |
| 32 | Git read-only tools; E1/E4 | argv/path fixtures | partial | approved Git run |
| 33 | bounded output inspector; E1/E2 | Web fixtures | partial | long-output/accessibility |
| 34 | native Goal Control; E1/E2 | replay/SQLite | partial | Spec 58 governed closure |
| 35 | Goal read projection; E1/E2 | daemon/Web focused | verified (bounded) | mutation/recovery UX |
| 36 | daemon settings; E1/E2 | SQLite restart | verified (bounded) | preserve event authorities |
| 37 | ratio-first UI; E1/E2 | viewport fixtures | partial | physical device matrix |
| 38 | conversation Web shell; E1/E2 | Web focused | partial | device/accessibility/recovery |
| 39 | TencentDB boundary; E1/E4 | adapter/supervisor fixtures | partial | upstream sidecar/live rollback |
| 40 | Goal mutation API; E1/E2 | auth mutation/preflight | partial | governed verifier/recovery |
| 41 | host/client boundary; E1/E2 | launcher fixtures | partial | installable host/client |
| 42 | Web design system; E1/E2 | component tests | partial | visual/accessibility/device |
| 43 | usage/cost audit; E1/E4 | bounded observability | partial | physical/long-run samples |
| 44 | provider/usage reuse; E1/E2/E3 | settings/live success | partial | durable credential/upstream audit |
| 45 | observability projection; E1/E4 | package fixtures | partial | lifecycle/resource/pricing |
| 46 | verification workflow; E1/E5 | fixed scripts | partial | current full verify |
| 47 | model/context/loop; E1/E2/E3 | live success only | partial | failure/recovery/context limits |
| 48 | approval/sandbox/shell; E1/E4 | bounded runners | partial | host/cross-platform evidence |
| 49 | MCP/Skill lifecycle; E1/E4 | local opt-in | partial | remote/cancel/release |
| 50 | observability lifecycle; E1/E4 | bounded fixtures | partial | automatic resource/pricing |
| 51 | host-first release; E1/E2 | launcher/contracts | partial | installer/client clean host |
| 52 | capability profiles; E1/E2/E4 | settings/snapshot | partial | full first run/real permission |
| 53 | install/backup/recovery; E1/E2 | adapters only | partial | installer/upgrade/restore |
| 54 | provider onboarding; E1/E2/E3 | probes/live success | partial | production secret store/provider |
| 55 | public deployment/certs; E1/E4 | rotation fixture | blocked for release | ACME/renewal/public listener |
| 56 | i18n/accessibility/devices; E1/E2 | pure ratio fixtures | blocked for real-device release | manual matrix/screen reader |
| 57 | release publishing; E1/E2 | manifest contract | blocked | workflow/artifact/sign/SBOM |
| 58 | Goal/Harness umbrella; E1/E3/E4 | bounded harness/governed smoke | partial | task verifier/recovery/release |
| 59 | permission profiles; E1/E4 | permission smoke | partial | host/container/platform/release |
| 60 | complete verification; E1/E3/E5 | focused/live slices | blocked | current full gate/failures/remote/release |
| 61 | DeepSeek provider; E1/E2/E3 | text/governed/cancel/context-limit | partial | reasoning/search/tool/reviewer/docs |

## Required blockers and re-acceptance

The former stale full-gate blocker is resolved by the current `pnpm verify`
run at `0a41cb4`; the remaining blockers below are runtime, remote, device or
release evidence gaps.

| Blocker | Return spec | Evidence required |
| --- | --- | --- |
| Provider 5xx/timeout and broad failure evidence | 60-4/47 | explicitly authorized bounded live negative smoke, never a fake pass |
| Task-specific Goal validation/recovery | 58-6/60-3 | independent verifier, crash/retry evidence and no old tool replay |
| Host/container/platform parity | 48/59-5 | permission/container cleanup evidence on target platforms |
| ACME/public/Tailscale/SSH | 55/60-6 | staging-only certificate and explicit remote adapter smoke |
| Real device/accessibility matrix | 56/62-6 | desktop/portrait/phone/fold/tri-fold/tablet plus screen reader review |
| Install/upgrade/sign/SBOM/provenance | 53/57/60-8 | clean-machine artifact workflow and rollback evidence |
| DeepSeek reasoning/search/reviewer production paths | 61/63 | capability-backed fixtures, provider/tool/reviewer wiring and separately authorized live evidence |

## Safety conclusion

The audit did not alter AgentLoop, RunManager default start, Scheduler,
Approval, Sandbox, WorkspaceRegistry, `run_events`, `goal_events` or the
interactive route. No secret, raw transcript, raw tool output, absolute path or
complete environment value is stored in this report. Until the blockers are
closed, Spec 62 must keep user documentation accurate and bounded rather than
promoting the repository to `release-ready`.
