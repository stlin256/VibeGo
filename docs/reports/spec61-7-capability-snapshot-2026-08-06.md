# Spec 61-7 capability probe and run snapshot evidence (2026-08-06)

## Scope

This slice closes the explicit DeepSeek capability boundary. It does not claim
that the public DeepSeek endpoint currently advertises these optional
capabilities, and it does not replace the separately authorized live evidence
gates.

## Implemented behavior

- `deepseek-provider-capabilities/v1` is a strict, bounded, secret/path-free
  descriptor accepted only from the exact configured probe response.
- Missing descriptor metadata keeps reasoning, tool-call, structured-output and
  provider-owned search conservative; usage still uses the bounded response
  field when present.
- Malformed or unknown descriptor fields return
  `DEEPSEEK_PROTOCOL_UNSUPPORTED` without returning provider response data.
- `DeepSeekProvider` rejects high/max thinking and provider-owned search unless
  a ready descriptor matches provider, endpoint profile and model.
- `bindRun` propagates the ready capability revision and safe booleans into the
  existing generic provider snapshot and secret-free `DeepSeekRunSnapshot`.
  Matching endpoint/profile/model settings retain a probe; endpoint or model
  changes clear it and optional capabilities fail closed.

## Focused verification

Using the bundled Node runtime (`v24.14.0`) and workspace pnpm:

- `@ready4vibe/contracts`: build; 112/112 tests passed.
- `@ready4vibe/model-deepseek`: build; 20/20 tests passed.
- `@ready4vibe/daemon`: build; 247/247 tests passed.
- `git diff --check`: passed.

The package test commands may discover all tests in the selected workspace;
they do not run the full repository `pnpm verify` gate. No network request was
made by these fixtures, and no credential, raw transcript, tool output,
absolute path or complete environment value is recorded here.

## Authority and release limits

The slice does not modify AgentLoop's state machine, RunManager's default
interactive start path, Scheduler, Approval, Sandbox, WorkspaceRegistry,
`run_events` or `goal_events`. It only enriches the already existing immutable
provider snapshot. Real provider reasoning/search support, production
reviewer/tool evidence and release readiness remain partial under Specs 60–63.
