# Spec 24: Certificate manager boundary and status

Status: Accepted — MVP implementation in progress.

## Goal

Make public-access TLS easier to operate without exposing certificate material.
VibeGo should show whether the configured certificate is usable and when it
expires, while keeping ACME issuance and platform certificate stores behind a
future adapter boundary.

## Scope

- `packages/certificates` parses an already loaded certificate into safe,
  serializable metadata: subject, issuer, validity window, remaining days,
  SHA-256 fingerprint, and DNS/IP SAN values.
- `apps/daemon` exposes `GET /api/v1/certificates/status` behind the existing
  auth, CSRF/Origin, and LAN/TLS gates.
- The endpoint returns `503 CERTIFICATE_STATUS_UNAVAILABLE` when no certificate
  is configured and never returns PEM, private-key bytes, file contents, or
  filesystem paths.
- The metadata is passed explicitly into the server; the server does not read
  certificate files or contact an ACME provider.
- The Web console must present this status and the next safe setup action; users
  are not expected to edit PEM paths or daemon configuration files by hand.

## Non-goals

- No ACME challenge, DNS API, automatic renewal, or certificate-store writes.
- No private-key export, download, or browser storage.
- No change to LAN TLS fail-closed defaults.

## Contract

```ts
interface CertificateStatus {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  fingerprint256: string;
  subjectAltNames: readonly string[];
}
```

The future manager/ACME adapter must produce the same status contract and pass
credentials to the daemon only in memory.

## Acceptance tests

- X.509 metadata parsing has deterministic tests and stable invalid-certificate
  errors.
- The status endpoint is authenticated on LAN, has no query-token path, and
  contains no PEM/private-key/path fields.
- Missing configuration returns a stable 503 response.
- Full typecheck/test/diff checks pass without network or ACME calls.

## User-facing configuration boundary

Certificate status is intentionally read-only in this spec. A later settings
wizard (Spec 25) will guide users through transport/certificate choices and
show exact next steps without exposing private-key material.
