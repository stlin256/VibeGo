# Spec 57b deterministic release manifest preflight evidence

- Date: 2026-08-06
- Status: implemented bounded local slice
- Scope: offline artifact hashing and `release-manifest/v1` validation

## Focused evidence

- `scripts/release-preflight.test.mjs`: 5 tests passed.
- `pnpm release:manifest -- --help`: bounded help projection (no network or
  credential access).
- `pnpm test:workflow`: includes the release-preflight fixture.
- `pnpm diff:check`: passed for the implementation slice.

The fixture covers deterministic SHA-256/size output, multi-target artifacts,
missing and symlink rejection, stable rollback requirements, safe argument
parsing and privacy-safe error projection. The manifest is parsed by the
existing `ReleaseManifestSchema`; artifact roots and local paths are not
serialized.

## Authority and privacy boundary

The preflight command is offline and does not contact GitHub, sign or upload
artifacts, generate SBOM/provenance, start a daemon, read credentials or alter
Host, AgentLoop, RunManager, Scheduler, Approval, Sandbox, WorkspaceRegistry,
`run_events` or `goal_events`. It is release-identity evidence only. Packaging,
workflow promotion, signing, install/upgrade/rollback and developer snapshot
publication remain later Spec 57 gates.
