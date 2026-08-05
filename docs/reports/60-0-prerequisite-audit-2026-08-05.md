# Spec 60-0 prerequisite audit (2026-08-05)

This report records the prerequisite audit for the Spec 60 verification line.
It is intentionally a status matrix, not a release claim. `verified` means
that the named boundary has source and focused-test evidence; `partial` means
that only a bounded or opt-in slice is present; `blocked` means that the
required real/runtime evidence is not available in this checkout.

## Checkout and toolchain

| Check | Evidence |
| --- | --- |
| Checkout | `main` at `2593f0f` (`feat(spec59): add permission runtime smoke evidence`) was clean and tracking `origin/main` at audit time. |
| Repository | `https://github.com/stlin256/VibeGo.git` |
| Package manager | `pnpm@11.9.0` from `package.json` |
| Runtime | Node `v24.14.0` from the bundled workspace runtime; it was placed first on `PATH` only for validation. |
| Workspace graph | `pnpm-workspace.yaml` declares `apps/*` and `packages/*`; 22 workspace directories are present. |
| Lockfile | `pnpm-lock.yaml` is present and remains unchanged by this audit. |
| Secret boundary | No provider key, private key, cookie, browser storage or user workspace was read by the audit. |

## Prerequisite matrix

| Domain | Status | Source/test evidence | Required follow-up |
| --- | --- | --- | --- |
| Contracts and storage | verified (A-C) | `packages/contracts`, `packages/storage`, independent `goal_events`/`run_events` tests and focused gates | Keep event authorities independent during integration and release testing. |
| Scheduler and RunManager | partial (C-D) | `packages/scheduler` and daemon RunManager/lease/cancellation tests | Add a repeatable two-run concurrency and restart evidence bundle. |
| Model/context/AgentLoop | partial (D-F) | `packages/model-openai`, `packages/context`, `packages/agent`, `scripts/smoke-harness.mjs` and the recorded DeepSeek smoke | Add bounded provider timeout/5xx/cancel and context-truncation evidence without persisting raw content. |
| Approval/policy/permission | partial (A-E) | `packages/policy`, daemon permission settings tests, `scripts/smoke-permissions.mjs` | Production host runner remains unavailable by default; keep full-host opt-in and fail-closed. |
| Sandbox/shell/tools | partial (B-F) | `packages/sandbox`, `packages/sandbox-runtime`, container/host fixture smoke and path/argv tests | Add cross-platform/container evidence and cleanup assertions. |
| Goal Control | partial (A-E) | `packages/goal-control` v1 reducer/admission/writeback tests and governed harness fixture | Add independent task validation, recovery and exactly-once replay evidence. |
| MCP/Skill | partial (A-F) | `packages/skill-mcp`, tool-adapter lifecycle tests and explicit local fixture smoke | Keep transports opt-in; remote server and release evidence remain blocked. |
| Memory/observability | partial (C-F) | daemon memory adapters/supervisor and observability tests | Preserve degraded behavior and add bounded queue/retry evidence. |
| Web/UX | partial (D-E) | `apps/web` focused gate, authenticated conversation/Goal/permission UI tests and responsive layouts | Real-device matrix and recovery UX evidence remain outstanding. |
| Auth/transport/certificates | partial (D-F) | pairing/AuthGate, LAN TLS and certificate contract/readiness tests | Tailscale/SSH/ACME and disconnect/reconnect evidence are not yet release evidence. |
| Host/release | partial (C-G) | host launcher, release-manifest contracts and backup/recovery tests | Installer, signed artifact, SBOM/provenance and upgrade rollback remain blocked. |
| Security/privacy | verified for bounded negatives; partial for runtime | secret/path/raw-output redaction tests across scripts and daemon | Run the complete cross-surface scan in the later evidence bundle. |
| Performance/operations | partial (C-D) | bounded time/output/resource limits and cleanup fixtures | Measure concurrent runs, SQLite writer behavior and restart cleanup on target platforms. |

## Gate decision

Spec 60-0 is **verified for the prerequisite audit only**. It authorizes the
next isolated verification slices (focused gates, daemon integration and
bounded recovery/concurrency evidence). It does not authorize a release claim,
does not promote fixture-only results to real-runtime evidence, and does not
change the default interactive run path.

The following remain explicit blockers for `release-candidate`: complete
`pnpm verify` evidence, real-provider failure/recovery coverage, governed task
validation, cross-platform/remote/certificate evidence, concurrency and
restart measurements, and the signed release bundle described by Spec 60-8.
