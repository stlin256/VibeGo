# ADR 0026: Immutable release manifest and promotion contract

- Status: Accepted for Phase 57a contract slice
- Date: 2026-08-05

## Decision

Define a strict `release-manifest/v1` contract in `@ready4vibe/contracts` for
artifact identity, target platform, checksum, signature/attestation references,
source commit, compatibility range and rollback target. Add a small ordered
promotion state machine for preflight, draft, approval, publish and withdraw.

The manifest is metadata only. It must not contain credentials, private keys,
absolute paths, full build environments, mutable `latest` URLs or user data.
Stable release promotion requires an immutable SemVer tag and an explicit
approval phase; a published release is never overwritten.

## Rationale

Keeping release identity separate from Host update state preserves the existing
`current/previous/candidate` runtime authority while giving a future GitHub
workflow a versioned input/output boundary. Pure validation is cheap to test
offline and prevents accidental publication side effects during development.

## Rejected alternatives

- Treating a Git branch or `latest` URL as release identity: rejected because
  either can move without a new artifact digest.
- Reusing `HostUpdateState` for public channel promotion: rejected because Host
  installation and maintainer approval have different authorities and lifecycles.
- Letting the contract carry CI logs or environment variables: rejected because
  those values can contain secrets, paths and user data.

## Non-goals for Phase 57a

No GitHub workflow, release upload, platform signing, SBOM generation,
attestation, installer, artifact download or stable promotion is performed.
