# ADR 0060: developer snapshot packaging and promotion

- Status: Accepted for the Spec 57c developer snapshot slice
- Date: 2026-08-06
- Related: [Spec 57](../specs/57-release-publishing-pipeline.md),
  [ADR 0058](0058-deterministic-release-manifest-preflight.md),
  [Spec 51](../specs/51-host-first-release-and-client-boundary.md)

## Context

Spec 57a/57b provide the release contract and offline manifest preflight, but
there is no repeatable artifact that can be downloaded and started. The first
public release must remain a developer snapshot: it should exercise the real
Host launcher, daemon and built Web shell (materialized at `apps/web/dist` so
the daemon fallback works after extraction) without pretending to be a signed
installer or stable cross-platform release.

## Decision

Add a bounded `package:developer-snapshot` command that stages:

- the daemon production deploy output with workspace dependencies materialized;
- the built React Web directory at `apps/web/dist`, matching the daemon's
  production-relative static asset lookup;
- the Host launcher, package metadata, lockfile and bounded English/Chinese
  snapshot instructions;
- a snapshot metadata file, SHA-256 checksum and release notes.

The packager rejects symlink escapes (with the known pnpm daemon self-link
omitted rather than copied), `.env`/credential/private-key material,
`.research`/`.ready4vibe`/runtime databases, unsafe names and secret-shaped
content. The daemon deploy is reduced to runtime material only: `dist/`,
production `node_modules/` and package metadata are retained, while source
`src/`, TypeScript files (`*.ts`, `*.tsx`, `*.d.ts`) and `tsconfig.json` are
omitted. This prevents test fixtures and source-only credential references
from entering a runnable snapshot while preserving the compiled entry point.
Dependency symlinks are materialized per destination so pnpm workspace aliases
remain resolvable after extraction; only targets on the current recursive path
are skipped to prevent cycles.
The privacy scan rejects concrete token-shaped values and quoted credential
assignments, but does not treat executable references such as
`apiKey: normalized.apiKey` as leaked values. It creates a gzip tar archive
with a deterministic top-level
`vibego-developer-snapshot/` directory and emits only bounded status,
artifact name, size and digest. The archive is a `nightly` Windows x64
developer target for this first promotion; the existing release manifest
contract still owns channel/tag/rollback validation.

The local promotion sequence is: build/typecheck → package and privacy scan →
manifest/checksum verification → extract and start through `host-launcher` →
health/Web/first-run smoke → immutable GitHub prerelease upload. GitHub Actions,
platform signing, SBOM, provenance and stable approval are separate gates and
are not silently claimed by this snapshot.

No credential is read by the packager. GitHub authentication is supplied only
to the explicit `gh release create` command by the operator environment and is
never written to a file, argument, artifact or release note.

The first promotion following this decision is
[v0.1.0-nightly.20260806.ca16fa6](https://github.com/stlin256/VibeGo/releases/tag/v0.1.0-nightly.20260806.ca16fa6)
from commit `ca16fa6b0960a8240fef4627a4da4b0fb1808658`. The Windows x64
archive is 2,636,099 bytes with SHA-256
`bd291af4b812556119ebe6311f35c726165b10fc0d8e366cd3982d58ae8ec3fb`; the
uploaded assets and downloaded archive were verified before publication was
recorded.

The daemon declares every runtime import, including `zod`, directly in its
package boundary so the materialized deploy is buildable without relying on a
hoisted root dependency.
