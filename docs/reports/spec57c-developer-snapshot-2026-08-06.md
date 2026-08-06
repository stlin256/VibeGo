# Spec 57c developer snapshot evidence (2026-08-06)

## Scope and status

This report records the first runnable VibeGo developer snapshot boundary. The
snapshot is a nightly Windows x64 developer artifact, not a signed installer or
a stable release. The immutable source commit, tag, archive digest and byte
size are recorded by the generated `release-manifest.json`; this report avoids
duplicating values that could become stale when the documentation-only commit
is promoted.

## Build and focused gates

- `pnpm install --frozen-lockfile` — passed with the repository lockfile.
- `pnpm build` — passed for all 24 workspace projects (contracts through daemon
  and Web production build).
- `scripts/package-developer-snapshot.test.mjs` — 3/3 passed, including source
  exclusion, dynamic injected-key references and secret-shaped fixture rejection.
- `scripts/release-preflight.test.mjs` — 5/5 passed, including digest, target,
  traversal/symlink and stable rollback checks.
- `apps/daemon/src/goal-recovery-monitor.test.ts` — 4/4 passed after the
  production retry callback was wired through `retryGoverned`.
- `git diff --check` — passed.

The commands use the bundled Node 24.14.0 and pnpm 11.9.0 validation runtime;
no runtime toolchain change is committed.

## Snapshot boundary

`pnpm package:developer-snapshot` (the script was also invoked directly for the
offline release run) stages:

- compiled daemon `dist/`, production dependencies and package metadata;
- built React Web assets;
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
manifest digest matches the archive and `SHA256SUMS`.

## Extracted launcher smoke

The generated archive was extracted into a clean temporary data directory and
started through `launcher/host-launcher.mjs`:

- loopback daemon health: HTTP 200;
- same-origin Web index: HTTP 200, `text/html`;
- default authentication: protected settings route returns HTTP 401 with the
  bounded `AUTH_REQUIRED` code;
- pairing start remains available only through the explicit pairing route;
- launcher stop released the child process and data-directory lease.

No model request, DeepSeek credential, external shell, MCP sidecar, public
listener or live network smoke was used by this release test.

## Promotion limits

The developer snapshot is unsigned and has no SBOM or provenance attestation.
GitHub prerelease upload is an explicit immutable promotion step; stable
approval, signing, installer/upgrade/rollback and cross-platform artifacts
remain separate Spec 57/53 gates.
