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
Host launcher, daemon and built Web shell without pretending to be a signed
installer or stable cross-platform release.

## Decision

Add a bounded `package:developer-snapshot` command that stages:

- the daemon production deploy output with workspace dependencies materialized;
- the built React Web directory;
- the Host launcher, package metadata, lockfile and bounded English/Chinese
  snapshot instructions;
- a snapshot metadata file, SHA-256 checksum and release notes.

The packager rejects symlink escapes (with the known pnpm daemon self-link
omitted rather than copied), `.env`/credential/private-key material,
`.research`/`.ready4vibe`/runtime databases, unsafe names and secret-shaped
content. It creates a gzip tar archive with a deterministic top-level
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
