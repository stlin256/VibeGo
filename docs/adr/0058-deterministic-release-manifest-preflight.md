# ADR 0058: Deterministic local release manifest preflight

- Status: Accepted for the bounded Spec 57b slice
- Date: 2026-08-06
- Related: [Spec 57](../specs/57-release-publishing-pipeline.md),
  [ADR 0026](0026-release-manifest-and-promotion-contract.md),
  [Spec 60](../specs/60-complete-verification-and-release-evidence.md)

## Context

Spec 57a validates an immutable `release-manifest/v1`, but the repository has
no repeatable local boundary that hashes an explicitly supplied artifact and
binds it to a tag, source commit, target and channel. Starting with GitHub
Actions or an installer before this boundary would make it difficult to test
release identity without uploading files or reading credentials.

## Decision

Add `scripts/release-preflight.mjs` and the `pnpm release:manifest` command as a
pure, local, side-effect-bounded manifest builder:

1. The caller supplies version/channel, full source commit, host compatibility
   range, creation time and one or more artifact descriptors. Each descriptor
   names a safe basename under an explicit artifact root and a Windows/macOS/
   Linux plus x64/arm64 target.
2. The script streams each file through Node's built-in SHA-256 hash, records
   only digest and byte size, validates the complete object with the existing
   `ReleaseManifestSchema`, and writes JSON only to the explicit output path.
   Artifact roots and local paths never appear in the manifest or diagnostics.
3. Stable channel still requires a non-prerelease version and explicit
   rollback target; preview/nightly channel rules remain owned by the existing
   contract. Missing files, traversal, symlink escape, unsafe names, digest or
   schema errors fail closed with bounded stable error codes.
4. The command never invokes GitHub, uploads artifacts, signs files, generates
   SBOM/provenance, starts a daemon, reads secrets or changes Host, AgentLoop,
   RunManager, Scheduler, Approval, Sandbox, WorkspaceRegistry,
   `run_events` or `goal_events`.

The output is an input to a later pinned workflow/package stage, not a release
or an installer instruction. The fixture uses temporary files and proves
deterministic digesting, multi-target entries, privacy-safe output and failure
on traversal/missing files.

## Consequences

Release identity can be reviewed and reproduced offline before any GitHub or
signing capability is enabled. The project still cannot claim a preview or
stable release until workflow, packaging, SBOM/signing, install/rollback and
release evidence stages are implemented separately.
