# ADR 0061: one-click local launch and portable runtime bootstrap

- Status: Accepted for the source-checkout launch slice
- Date: 2026-08-06
- Related: [ADR 0060](0060-developer-snapshot-packaging-and-promotion.md),
  [Spec 51](../specs/51-host-first-release-and-client-boundary.md)

## Context

Until now a source checkout required a pre-installed Node.js `>=22.12.0` and
pnpm `11.9.0`, plus three manual commands (`pnpm install`, `pnpm build`,
`node scripts/host-launcher.mjs --open`). That is a poor first-run experience
and each step is a separate failure surface. The release pipeline still ships
an unsigned developer snapshot, so the source checkout remains the primary
way users try VibeGo.

## Decision

Add a two-layer one-click entry:

1. `start-vibego.bat` (repository root, double-click) resolves a Node.js
   runtime in strict order: a portable copy under `.ready4vibe/runtime/node`,
   a Node.js `>=22` already on `PATH`, or an official pinned Node.js LTS zip
   downloaded and extracted under `.ready4vibe/runtime`. It never installs
   anything system-wide and never modifies user or machine environment
   variables; the portable runtime only prefixes `PATH` inside its own
   process.
2. `scripts/launch-local.mjs` (also exposed as `pnpm launch`) performs the
   repo-local bootstrap: it locates pnpm on `PATH` or activates the
   `packageManager`-pinned pnpm through the corepack shipped with Node, runs
   `pnpm install --frozen-lockfile` and `pnpm build` only when their output
   markers are missing, then delegates to the existing Host launcher with
   `--open`.

Windows `.cmd` shims (`pnpm`, `corepack`) cannot be spawned without a shell,
so they are wrapped through `ComSpec /d /s /c` with the same argument quoting
as `scripts/verification-evidence.mjs`; every other child process keeps plain
argv form with the shell disabled. No credential, endpoint or absolute user
path is printed by the launcher beyond what the Host launcher already emits.

## Consequences

- A fresh Windows machine can start VibeGo by double-clicking one file; all
  state stays inside the repository directory (`.ready4vibe/` is already
  ignored by git).
- Repeat runs are cheap: runtime, dependencies and build outputs are reused
  via marker checks.
- The portable runtime is a convenience, not a release artifact: signed
  installers and bundled-runtime releases remain separate Spec 57/60 gates.
- Non-Windows platforms use `pnpm launch`; a POSIX shell equivalent of the
  runtime bootstrap is a later, separately reviewed slice.
