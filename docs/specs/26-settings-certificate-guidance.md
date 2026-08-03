# Spec 26: Settings certificate guidance

Status: Accepted — MVP implementation in progress.

## Goal

Make the TLS/public-access boundary understandable from the Web onboarding
surface. A user should be able to tell whether the daemon has a usable
certificate and what safe next step is available without opening config files.

## Scope

- After health/pairing, the Web client requests the authenticated certificate
  status endpoint.
- The Settings panel renders valid-to, remaining days, subject, and SAN values
  as metadata only.
- Missing status in a TLS-required transport shows a clear “certificate setup
  is required” guidance message and links to the documented adapter boundary;
  it does not ask the user to paste a private key into the browser.
- Loopback HTTP remains a valid local development state and is labelled as such.
- Status failures are non-fatal to run configuration; pairing and run controls
  remain available.

## Non-goals

- No certificate issuance, renewal, upload, deletion, or private-key download.
- No automatic ACME network request from the browser.
- No localStorage/cookie persistence of TLS material or access tokens.

## Acceptance tests

- API client requests certificate status only through the authenticated path.
- Settings UI renders safe metadata and missing-TLS guidance without PEM/path
  strings.
- A status 503 does not block the run composer.
- Responsive build and full unit/typecheck suite remain green.
