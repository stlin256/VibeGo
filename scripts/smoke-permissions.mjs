import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const USAGE = 'usage: pnpm smoke:permissions -- [--mode <workspace-coding|full-host|both>] [--timeout-ms <100..30000>]';
const DEFAULT_TIMEOUT_MS = 10_000;
const WORKSPACE_ID = 'permission_smoke_workspace';
const POLICY_REVISION = 'permission-smoke-policy-1';
const ENV_MODE = 'VIBEGO_PERMISSION_SMOKE_MODE';
const ENV_TIMEOUT = 'VIBEGO_PERMISSION_SMOKE_TIMEOUT_MS';

export function parsePermissionSmokeArgs(argv, environment = process.env) {
  let mode = environment[ENV_MODE] ?? 'both';
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--mode' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--mode') mode = value;
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }
  if (mode !== 'workspace-coding' && mode !== 'full-host' && mode !== 'both') throw new Error('mode must be workspace-coding, full-host or both');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('timeout is invalid');
  return Object.freeze({ mode, timeoutMs });
}

export function exitCodeForPermissionSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'blocked') return 2;
  if (status === 'timeout') return 3;
  return 1;
}

export function safePermissionSmokeErrorCode(error, fallback = 'PERMISSION_SMOKE_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(code) ? code : fallback;
}

/**
 * Execute the explicit permission fixture. Dependencies are injectable so
 * unit tests never load dist packages, spawn a process or touch the network.
 */
export async function runPermissionSmoke(options, dependencies = {}) {
  const startedAt = Date.now();
  let runtime;
  try {
    runtime = dependencies.runtimeFactory
      ? await dependencies.runtimeFactory(options)
      : await createDefaultRuntime(options);
    const outcome = await withTimeout(runtime.run(options.mode, options.timeoutMs), options.timeoutMs);
    return report(options, outcome, Date.now() - startedAt);
  } catch (error) {
    if (error?.code === 'PERMISSION_SMOKE_TIMEOUT') return report(options, { status: 'timeout', errorCode: 'PERMISSION_SMOKE_TIMEOUT' }, Date.now() - startedAt);
    return report(options, { status: 'failed', errorCode: safePermissionSmokeErrorCode(error) }, Date.now() - startedAt);
  } finally {
    try { await runtime?.close?.(); } catch { /* cleanup is best effort and never leaks raw errors */ }
  }
}

function report(options, outcome, elapsedMs) {
  const safeOutcome = outcome && typeof outcome === 'object' ? outcome : {};
  const modeResults = safeModeResults(safeOutcome.modeResults);
  const status = normalizeOverallStatus(safeOutcome.status, modeResults);
  const result = {
    schemaVersion: 'permission-smoke/v1',
    mode: options.mode,
    status,
    elapsedMs: Math.max(0, Math.min(120_000, Math.trunc(elapsedMs))),
    ...(modeResults ? { modes: modeResults } : {}),
  };
  const errorCode = safeCode(safeOutcome.errorCode);
  if (errorCode) result.errorCode = errorCode;
  if (safeOutcome.platform === 'win32' || safeOutcome.platform === 'linux' || safeOutcome.platform === 'darwin') result.platform = safeOutcome.platform;
  return Object.freeze(result);
}

function safeModeResults(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output = {};
  for (const key of ['workspaceCoding', 'fullHost']) {
    const item = value[key];
    if (!item || typeof item !== 'object') continue;
    const entry = {
      status: safeStatus(item.status),
      ...(safeCode(item.reasonCode) ? { reasonCode: safeCode(item.reasonCode) } : {}),
      ...(safeCode(item.errorCode) ? { errorCode: safeCode(item.errorCode) } : {}),
    };
    if (Number.isSafeInteger(item.processExitCode) && item.processExitCode >= -1 && item.processExitCode <= 255) entry.processExitCode = item.processExitCode;
    if (item.cancelled === true) entry.cancelled = true;
    if (item.expired === true) entry.expired = true;
    if (item.revoked === true) entry.revoked = true;
    output[key] = Object.freeze(entry);
  }
  return Object.keys(output).length > 0 ? Object.freeze(output) : undefined;
}

function normalizeOverallStatus(status, modeResults) {
  if (status === 'healthy' || status === 'blocked' || status === 'timeout' || status === 'failed') return status;
  const values = Object.values(modeResults ?? {});
  if (values.some((item) => item.status === 'failed')) return 'failed';
  if (values.some((item) => item.status === 'timeout')) return 'timeout';
  if (values.some((item) => item.status === 'blocked')) return 'blocked';
  return values.length > 0 && values.every((item) => item.status === 'healthy') ? 'healthy' : 'failed';
}

function safeStatus(value) {
  return value === 'healthy' || value === 'blocked' || value === 'timeout' || value === 'failed' ? value : 'failed';
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value) ? value : undefined;
}

async function createDefaultRuntime(options) {
  const [auth, storage, daemon, permissionSettings, sandboxRuntime] = await Promise.all([
    import('../packages/auth/dist/index.js'),
    import('../packages/storage/dist/index.js'),
    import('../apps/daemon/dist/server.js'),
    import('../apps/daemon/dist/permission-profile-settings.js'),
    import('../packages/sandbox-runtime/dist/index.js'),
  ]);
  const root = await mkdtemp(join(tmpdir(), 'vibego-permission-smoke-'));
  const workspaceRoot = join(root, 'workspace');
  await mkdir(workspaceRoot);
  let now = Date.now();
  const settings = new storage.InMemorySettingsStore();
  const policyState = createPolicy();
  const manager = new permissionSettings.DurablePermissionProfileSettingsManager({
    settings,
    policy: () => policyState,
    workspaceExists: (workspaceId) => workspaceId === WORKSPACE_ID,
    defaultWorkspaceId: WORKSPACE_ID,
    sessionGrantTtlMs: 2_000,
    sessionGrantMaxUses: 8,
    clock: () => new Date(now),
  });
  const authGate = new auth.AuthGate({ mode: 'lan', authRequired: true, tlsRequired: false, randomBytes: deterministicRandomBytes });
  const server = daemon.createDaemonServer({ host: '127.0.0.1', transportMode: 'lan', authGate, permissionProfileSettings: manager });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('PERMISSION_SMOKE_DAEMON_UNREADY');
  const base = `http://127.0.0.1:${address.port}`;
  let session;
  const hostRunner = new sandboxRuntime.HostRestrictedProcessRunner();

  async function run(mode) {
    const result = {};
    session = await pair(base);
    const headers = { authorization: `Bearer ${session.accessToken}` };
    const initial = await requestJson(`${base}/api/v1/settings/permissions`, { headers });
    if (initial.status !== 200) throw new Error('PERMISSION_SMOKE_SETTINGS_UNREADY');
    const workspaceSnapshot = manager.snapshotForRun(workspaceConfig(session.sessionId), session.sessionId);
    const workspaceSnapshotFingerprint = JSON.stringify(workspaceSnapshot);
    if (mode === 'workspace-coding' || mode === 'both') {
      result.workspaceCoding = workspaceSnapshot.status === 'ready'
        && workspaceSnapshot.effectiveProfile?.profileId === 'workspace-coding'
        && workspaceSnapshot.effectiveProfile.filesystemScope === 'workspace-only'
        && workspaceSnapshot.effectiveProfile.processScope === 'none'
        && workspaceSnapshot.effectiveProfile.networkMode === 'off'
        ? { status: 'healthy', reasonCode: 'PROFILE_READY' }
        : { status: 'failed', errorCode: 'WORKSPACE_PROFILE_INVALID' };
    }
    if (mode === 'workspace-coding') return { status: result.workspaceCoding.status, modeResults: result, platform: process.platform };

    const profile = fullHostProfile(initial.body?.settings?.profile);
    const patched = await requestJson(`${base}/api/v1/settings/permissions`, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ profile, expectedRevision: initial.body?.currentRevision }),
    });
    if (patched.status !== 200) throw new Error('PERMISSION_SMOKE_FULL_HOST_PATCH_FAILED');
    const requestedProfile = patched.body.settings.profile;
    const confirmationBody = {
      schemaVersion: 'ready4vibe_permission_confirmation_request_v1',
      requestId: 'permission-smoke-confirm-1',
      sessionId: session.sessionId,
      userId: 'local-user',
      requestedProfile,
      expectedProfileRevision: patched.body.currentRevision,
      acknowledged: true,
      requestedAt: new Date(now).toISOString(),
    };
    const wrong = await requestJson(`${base}/api/v1/settings/permissions/confirm-full-host`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ...confirmationBody, requestId: 'permission-smoke-wrong', sessionId: 'session_wrong' }),
    });
    if (wrong.status !== 401 || wrong.body?.error?.code !== 'AUTHENTICATION_REQUIRED') throw new Error('PERMISSION_SMOKE_SESSION_BINDING_FAILED');
    const confirmed = await requestJson(`${base}/api/v1/settings/permissions/confirm-full-host`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(confirmationBody),
    });
    if (confirmed.status !== 200 || confirmed.body?.status !== 'ready') throw new Error('PERMISSION_SMOKE_FULL_HOST_CONFIRM_FAILED');
    const hostConfig = fullHostRunConfig(session.sessionId);
    const hostSnapshot = manager.snapshotForRun(hostConfig, session.sessionId);
    const hostOutput = await hostRunner.run({
      workspaceRoot,
      command: [process.execPath, '-p', '\"ready4vibe-permission-smoke\"'],
      limits: { timeoutMs: Math.min(options.timeoutMs, 5_000), maxOutputBytes: 256 },
    });
    const controller = new AbortController();
    const cancelledPromise = hostRunner.run({
      workspaceRoot,
      command: process.platform === 'win32' ? ['ping', '127.0.0.1', '-n', '20'] : ['sleep', '10'],
      limits: { timeoutMs: Math.min(options.timeoutMs, 5_000), maxOutputBytes: 256 },
    }, controller.signal);
    await delay(25);
    controller.abort();
    const cancelled = await cancelledPromise;
    const isolation = manager.snapshotForRun({ ...hostConfig, createdBySessionId: 'session_other' }, 'session_other');
    now += 2_001;
    const expiredStatus = manager.permissionStatus(session.sessionId);
    const revoked = await requestJson(`${base}/api/v1/settings/permissions/revoke`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 'ready4vibe_permission_revoke_request_v1', requestId: 'permission-smoke-revoke-1', sessionId: session.sessionId, userId: 'local-user', grantId: confirmed.body?.grant?.grantId, expectedRevision: patched.body.currentRevision, reason: 'user-requested', requestedAt: new Date(now).toISOString() }),
    });
    const revokedSnapshot = manager.snapshotForRun(hostConfig, session.sessionId);
    const untrusted = manager.snapshotForRun({ ...hostConfig, taskTrust: 'untrusted-content' }, session.sessionId);
    const unavailableManager = new permissionSettings.DurablePermissionProfileSettingsManager({
      settings,
      policy: () => ({ ...policyState, hostRunnerHealth: 'missing' }),
      workspaceExists: (workspaceId) => workspaceId === WORKSPACE_ID,
      defaultWorkspaceId: WORKSPACE_ID,
      clock: () => new Date(now),
    });
    const unavailable = unavailableManager.snapshotForRun(hostConfig, session.sessionId);
    const immutable = JSON.stringify(workspaceSnapshot) === workspaceSnapshotFingerprint;
    const fullHealthy = hostSnapshot.status === 'ready' && hostSnapshot.effectiveProfile?.networkMode === 'off'
      && hostOutput.exitCode === 0 && hostOutput.stdout.trim() === 'ready4vibe-permission-smoke'
      && cancelled.cancelled === true && isolation.status === 'blocked'
      && revoked.status === 200 && revokedSnapshot.reasonCode === 'SESSION_GRANT_REVOKED'
      && untrusted.reasonCode === 'UNTRUSTED_CONTENT' && expiredStatus.status === 'expired'
      && unavailable.reasonCode === 'CAPABILITY_UNAVAILABLE' && immutable;
    result.fullHost = fullHealthy
      ? { status: 'healthy', reasonCode: 'PROFILE_READY', processExitCode: hostOutput.exitCode, cancelled: true, revoked: true, expired: true }
      : { status: 'failed', errorCode: 'FULL_HOST_SMOKE_ASSERTION_FAILED', processExitCode: hostOutput.exitCode, cancelled: cancelled.cancelled, revoked: revokedSnapshot.reasonCode === 'SESSION_GRANT_REVOKED', expired: expiredStatus.status === 'expired' };
    return { status: fullHealthy && (!result.workspaceCoding || result.workspaceCoding.status === 'healthy') ? 'healthy' : 'failed', modeResults: result, platform: process.platform };
  }

  return {
    run,
    close: async () => {
      if (server.listening) await new Promise((resolveClose) => server.close(() => resolveClose()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

function createPolicy() {
  return {
    policyRevision: POLICY_REVISION,
    transportModes: ['loopback', 'lan-tls', 'tailscale', 'ssh'],
    modelModes: ['off', 'fake', 'configured'],
    filesystemModes: ['off', 'workspace-read', 'workspace-write'],
    shellModes: ['off', 'external-sandbox', 'host-restricted'],
    networkModes: ['off', 'restricted', 'enabled'],
    mcpSkillModes: ['off', 'configured'],
    approvalModes: ['none', 'on-request', 'bounded-auto', 'explicit'],
    transportHealth: { loopback: 'ready', 'lan-tls': 'ready', tailscale: 'missing', ssh: 'missing' },
    workspaceHealth: 'ready',
    modelHealth: 'ready',
    filesystemHealth: 'ready',
    externalSandboxHealth: 'ready',
    hostRunnerHealth: 'ready',
    networkHealth: 'enabled',
    mcpSkillHealth: 'ready',
  };
}

function workspaceConfig(sessionId) {
  return baseConfig(sessionId, { taskTrust: 'trusted-workspace', sandbox: { mode: 'read-only', network: 'restricted' } });
}

function fullHostRunConfig(sessionId) {
  return baseConfig(sessionId, { taskTrust: 'trusted-workspace', sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } });
}

function baseConfig(sessionId, overrides) {
  return {
    workspaceId: WORKSPACE_ID,
    userMessage: 'permission smoke fixture',
    model: { provider: 'fake', name: 'permission-smoke' },
    taskTrust: 'trusted-workspace',
    sandbox: { mode: 'read-only', network: 'restricted' },
    approval: 'on-request',
    limits: { maxTurns: 1, maxWallTimeMs: 5_000, maxModelInputTokens: 64, maxModelOutputTokens: 64, maxToolCalls: 1, maxOutputBytes: 1_024, maxContextBytes: 4_096 },
    createdBySessionId: sessionId,
    clientRequestId: 'permission-smoke-client',
    ...overrides,
  };
}

function fullHostProfile(value) {
  if (!value || typeof value !== 'object') throw new Error('PERMISSION_SMOKE_PROFILE_MISSING');
  const { workspaceId: _workspaceId, ...base } = value;
  return {
    ...base,
    profileId: 'full-host',
    filesystemScope: 'host',
    processScope: 'host',
    approvalPosture: 'session-auto',
    taskTrust: 'trusted-user',
    requiresConfirmation: true,
  };
}

async function pair(base) {
  const start = await requestJson(`${base}/api/v1/pairing/start`, { method: 'POST' });
  if (start.status !== 200 || typeof start.body?.code !== 'string') throw new Error('PERMISSION_SMOKE_PAIRING_START_FAILED');
  const complete = await requestJson(`${base}/api/v1/pairing/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: start.body.code }) });
  if (complete.status !== 200 || typeof complete.body?.accessToken !== 'string' || typeof complete.body?.sessionId !== 'string') throw new Error('PERMISSION_SMOKE_PAIRING_COMPLETE_FAILED');
  return complete.body;
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  let body;
  try { body = await response.json(); } catch { body = undefined; }
  return { status: response.status, body };
}

function deterministicRandomBytes(size) {
  const output = new Uint8Array(size);
  for (let index = 0; index < output.length; index += 1) output[index] = (index + 17) % 251;
  return output;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('permission smoke timed out'), { code: 'PERMISSION_SMOKE_TIMEOUT' })), timeoutMs);
  });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parsePermissionSmokeArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${USAGE}\n`);
    else {
      const result = await runPermissionSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForPermissionSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
