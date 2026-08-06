# Spec 57c developer snapshot evidence (2026-08-06)

## Scope and status

This report records the first runnable VibeGo developer snapshot boundary. The
snapshot is a nightly Windows x64 developer artifact, not a signed installer or
a stable release. The artifact was promoted as an immutable GitHub prerelease
from source commit `ca16fa6b0960a8240fef4627a4da4b0fb1808658` and tag
`v0.1.0-nightly.20260806.ca16fa6`.

## Build and focused gates

- `pnpm install --frozen-lockfile`: passed with the repository lockfile.
- `pnpm build`: passed for all 24 workspace projects (contracts through daemon
  and Web production build).
- `pnpm typecheck`: passed for all 23 typechecked workspace projects.
- `pnpm --filter @ready4vibe/contracts test`: 127/127 passed.
- `pnpm --filter @ready4vibe/daemon test`: 300/300 passed.
- `scripts/package-developer-snapshot.test.mjs`: 3/3 passed, including source
  exclusion, dynamic injected-key references and secret-shaped fixture rejection.
- `scripts/release-preflight.test.mjs`: 5/5 passed, including digest, target,
  traversal/symlink and stable rollback checks.
- `apps/daemon/src/goal-recovery-monitor.test.ts`: 5/5 passed after the
  production retry callback was wired through `retryGoverned`.
- `pnpm test:workflow`: 100/100 passed.
- `git diff --check`: passed.

The commands use the bundled Node 24.14.0 and pnpm 11.9.0 validation runtime;
no runtime toolchain change is committed.

## Snapshot boundary

`pnpm package:developer-snapshot` stages:

- compiled daemon `dist/`, production dependencies and package metadata;
- built React Web assets materialized at `apps/web/dist`, matching the daemon
  production-relative static asset lookup;
- the dependency-free Host launcher;
- snapshot metadata, SHA-256 checksum and bounded release notes.

The packager excludes the daemon root `src/`, TypeScript files, declaration
files, source maps, `tsconfig.json`, `.env`/runtime data and unsafe symlinks.
Pnpm workspace dependency aliases are materialized at every destination so the
extracted daemon resolves `@ready4vibe/*` packages without the source checkout;
the recursive path guard only prevents dependency cycles. The privacy scan
rejects concrete token-shaped values and quoted credential assignments, while
allowing executable references to injected secrets without embedding a value.

The archive audit confirmed: daemon root source absent, no `.ts`/`.tsx`/`.d.ts`
files, no source maps, root `@ready4vibe/contracts` alias present, and the
manifest digest matches the archive and `SHA256SUMS`. The published archive is
`2,636,099` bytes with SHA-256
`bd291af4b812556119ebe6311f35c726165b10fc0d8e366cd3982d58ae8ec3fb`.

## Extracted launcher smoke

The generated archive was extracted into a clean temporary data directory and
started through `launcher/host-launcher.mjs`:

- loopback daemon health: HTTP 200;
- same-origin Web index: HTTP 200, `text/html`;
- default authentication: protected settings route returns HTTP 401 with the
  bounded `AUTH_REQUIRED` code;
- pairing start remains available only through the explicit pairing route;
- launcher stop released the child process and data-directory lease.

The same checks were repeated after downloading all four assets from the
published GitHub release. The downloaded archive digest, manifest source
commit/size, `SHA256SUMS`, Web index layout and source-exclusion audit all
matched the local promotion output.

No model request, DeepSeek credential, external shell, MCP sidecar, public
listener or live network smoke was used by this release test.

## Published prerelease

- Release: [VibeGo 0.1.0 nightly ca16fa6](https://github.com/stlin256/VibeGo/releases/tag/v0.1.0-nightly.20260806.ca16fa6)
- Assets: archive, `release-manifest.json`, `SHA256SUMS` and `release-notes.md`.
- `release-manifest.json` binds the archive to the source commit, Windows x64
  target, byte size and the digest above.

The developer snapshot is unsigned and has no SBOM or provenance attestation.
Stable approval, signing, installer/upgrade/rollback and cross-platform
artifacts remain separate Spec 57/53 gates.
