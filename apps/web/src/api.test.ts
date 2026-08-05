import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, DEFAULT_RUN_PROFILE, loadRunProfile, parseSseFrame, resetRunProfile, RUN_PROFILE_STORAGE_KEY, saveRunProfile, type FetchLike, type RunProfile, type RunProfileStorage } from './api.js';

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function memoryStorage(initial?: string): RunProfileStorage {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => { value = next; },
    removeItem: () => { value = null; },
  };
}

describe('ApiClient', () => {
  it('round-trips a validated non-secret run profile through controlled storage', () => {
    const storage = memoryStorage();
    const profile: RunProfile = {
      ...DEFAULT_RUN_PROFILE,
      workspaceId: 'repo-a',
      model: { provider: 'deepseek', name: 'deepseek-v4-flash' },
      sandbox: { mode: 'workspace-write', network: 'restricted', writableRoots: ['.'] },
    };
    saveRunProfile(profile, storage);
    expect(storage.getItem(RUN_PROFILE_STORAGE_KEY)).not.toContain('apiKey');
    expect(loadRunProfile(storage)).toEqual(profile);
    resetRunProfile(storage);
    expect(loadRunProfile(storage)).toEqual(DEFAULT_RUN_PROFILE);
  });

  it('falls back to conservative defaults for malformed or secret-shaped profiles', () => {
    const malformed = memoryStorage('{"workspaceId":"repo","model":{}}');
    expect(loadRunProfile(malformed)).toEqual(DEFAULT_RUN_PROFILE);
    const secretShaped = memoryStorage(JSON.stringify({ ...DEFAULT_RUN_PROFILE, apiKey: 'do-not-store' }));
    expect(loadRunProfile(secretShaped)).toEqual(DEFAULT_RUN_PROFILE);
  });

  it('does not let unavailable browser storage interrupt the UI', () => {
    const failing: RunProfileStorage = {
      getItem: () => { throw new Error('disabled'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('disabled'); },
    };
    expect(loadRunProfile(failing)).toEqual(DEFAULT_RUN_PROFILE);
    expect(() => saveRunProfile(DEFAULT_RUN_PROFILE, failing)).not.toThrow();
    expect(() => resetRunProfile(failing)).not.toThrow();
  });

  it('keeps pairing credentials in memory and sends Bearer/CSRF headers', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      return response({ runId: 'run_1', status: 'queued' });
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    await client.createRun({} as never);
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
    expect(calls[0]?.input).toBe('http://daemon/api/v1/pairing/complete');
    expect(calls[1]?.input).toBe('http://daemon/api/v1/runs');
    expect(calls[1]?.init?.body).not.toContain('access');
    client.clearSession();
    expect(client.hasSession()).toBe(false);
  });

  it('reads the bounded Goal projection with the existing authenticated headers', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      return response({ schemaVersion: 'ready4vibe_goal_api_v0', goals: [] });
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    await expect(client.listGoals()).resolves.toEqual({ schemaVersion: 'ready4vibe_goal_api_v0', goals: [] });
    expect(calls[1]?.input).toBe('http://daemon/api/v1/goals');
    expect(calls[1]?.init?.method).toBe('GET');
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
    expect(calls[1]?.input).not.toContain('token');
  });

  it('uses authenticated bounded Goal mutations and read-only preflight without browser secrets', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      if (input.endsWith('/preflight')) return response({ schemaVersion: 'ready4vibe_goal_preflight_v1', decision: { status: 'eligible' }, checks: [] });
      return response({ schemaVersion: 'ready4vibe_goal_write_api_v0', eventId: 'gevt_test', controlRevision: 1, projection: {} });
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    await client.createGoal({ title: 'Goal', objective: 'Bounded objective.' });
    await client.addGoalTodo('goal_12345678', { expectedRevision: 1, title: 'Todo' });
    await client.openGoalGate('goal_12345678', { expectedRevision: 2, question: 'Approve?' });
    await client.resolveGoalGate('goal_12345678', 'gate_12345678', { expectedRevision: 3, status: 'approved' });
    await client.attachGoalEvidence('goal_12345678', { expectedRevision: 4, summary: 'Observed.' });
    await client.preflightGoal('goal_12345678', {
      runMode: 'governed', expectedControlRevision: 5, agentId: 'agent_12345678',
      turnKey: 'turn_goal_12345678', requestId: 'request_12345678', workspaceId: 'default', userMessage: 'Preview',
      model: { provider: 'fake', name: 'deterministic' }, taskTrust: 'trusted-workspace', sandbox: { mode: 'read-only', network: 'restricted' },
      approval: 'on-request', limits: DEFAULT_RUN_PROFILE.limits, createdBySessionId: 'session_12345678', clientRequestId: 'client_12345678',
    });
    expect(calls.map((call) => call.input)).toEqual([
      'http://daemon/api/v1/pairing/complete',
      'http://daemon/api/v1/goals',
      'http://daemon/api/v1/goals/goal_12345678/todos',
      'http://daemon/api/v1/goals/goal_12345678/gates',
      'http://daemon/api/v1/goals/goal_12345678/gates/gate_12345678/resolve',
      'http://daemon/api/v1/goals/goal_12345678/evidence',
      'http://daemon/api/v1/goals/goal_12345678/preflight',
    ]);
    for (const call of calls.slice(1)) {
      expect(call.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
      expect(String(call.init?.body ?? '')).not.toMatch(/api[_-]?key|private[_-]?key|secret|C:\\Users/iu);
    }
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({ title: 'Goal', objective: 'Bounded objective.' });
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toMatchObject({ goalId: 'goal_12345678', runMode: 'governed' });
  });

  it('uses bounded usage and audit projections without placing credentials in URLs', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      return response({ schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: '2026-08-04T00:00:00.000Z', range: '24h', from: '2026-08-03T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z', modelAttempts: 0, modelRequests: 0, toolCalls: 0, tokens: { input: { total: null, knownRecords: 0, unknownRecords: 0 }, output: { total: null, knownRecords: 0, unknownRecords: 0 }, cachedInput: { total: null, knownRecords: 0, unknownRecords: 0 }, reasoning: { total: null, knownRecords: 0, unknownRecords: 0 } }, resources: { sampleCount: 0, droppedSampleCount: 0 }, cost: { currency: null, amountMicros: null, accuracy: 'not-applicable' }, events: [], after: 0, nextAfter: null, rules: [] });
    });
    await client.usageSummary('7d');
    await client.usageTimeseries('tokens', '24h');
    await client.runUsage('run_usage_01');
    await client.auditEvents(42, { action: 'run.completed', outcome: 'succeeded' });
    await client.pricing();
    await client.rebuildUsage();
    await client.verifyAudit();
    expect(calls.map((call) => call.input)).toEqual([
      '/api/v1/usage/summary?range=7d',
      '/api/v1/usage/timeseries?metric=tokens&range=24h',
      '/api/v1/runs/run_usage_01/usage',
      '/api/v1/audit/events?after=42&action=run.completed&outcome=succeeded',
      '/api/v1/usage/pricing',
      '/api/v1/usage/rebuild',
      '/api/v1/audit/verify',
    ]);
    expect(calls[5]?.init?.method).toBe('POST');
    expect(calls.map((call) => call.input).join('')).not.toMatch(/access|secret|api[_-]?key/iu);
  });

  it('posts approval decisions in the body without putting credentials in the URL', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      return response({ runId: 'run_1', approvalId: 'ap_1', status: 'accepted' }, 202);
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    await expect(client.approveRun('run_1', 'ap_1', 'allow')).resolves.toMatchObject({ status: 'accepted' });
    expect(calls[1]?.input).toBe('http://daemon/api/v1/runs/run_1/approve');
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ approvalId: 'ap_1', decision: 'allow' }));
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
    expect(calls[1]?.input).not.toContain('access');
  });

  it('posts explicit recovery retry confirmation without URL secrets', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('/daemon', async (input, init) => {
      calls.push({ input, init });
      return response({ runId: 'run_new', status: 'queued', retryOf: 'run_old' }, 202);
    });
    await client.retryRun('run_old');
    expect(calls[0]?.input).toBe('/daemon/api/v1/runs/run_old/retry');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ confirmation: 'retry-as-new-run' }));
    expect(calls[0]?.input).not.toContain('token');
  });

  it('reads certificate status through the authenticated API path', async () => {
    const calls: string[] = [];
    const client = new ApiClient('', async (input) => {
      calls.push(input);
      return response({ subject: 'CN=dev.example.test', issuer: 'CN=Test CA', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2030-01-01T00:00:00.000Z', daysRemaining: 1000, fingerprint256: 'AA:BB:CC', subjectAltNames: ['dev.example.test'] });
    });
    await expect(client.certificateStatus()).resolves.toMatchObject({ subject: 'CN=dev.example.test', daysRemaining: 1000 });
    expect(calls).toEqual(['/api/v1/certificates/status']);
  });

  it('reads bounded deployment readiness without exposing transport secrets', async () => {
    const calls: string[] = [];
    const client = new ApiClient('', async (input) => {
      calls.push(input);
      return response({ schemaVersion: 'ready4vibe_deployment_readiness_v1', mode: 'lan', status: 'blocked', reasonCode: 'certificate-required', nextStep: 'configure-certificate', affectsInteractiveRun: true, evaluatedAt: '2026-08-05T00:00:00.000Z' });
    });
    await expect(client.deploymentReadiness()).resolves.toMatchObject({ mode: 'lan', status: 'blocked', reasonCode: 'certificate-required' });
    expect(calls).toEqual(['/api/v1/deployment/readiness']);
    expect(calls.join('')).not.toMatch(/token|secret|api[_-]?key/iu);
  });

  it('configures model access through an authenticated body and exposes only safe status', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      if (init?.method === 'POST') return response({ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'web-memory', credentialState: 'available' });
      return response({ configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured', credentialState: 'none' });
    });
    await expect(client.configureModel({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' })).resolves.toMatchObject({ configured: true });
    await client.modelSettings();
    await client.clearModelSettings();
    expect(calls[0]?.input).toBe('/api/v1/settings/model');
    expect(calls[0]?.init?.body).toContain('test-secret');
    expect(calls[0]?.input).not.toContain('test-secret');
    expect(calls[1]?.init?.method).toBe('GET');
    expect(calls[2]?.init?.method).toBe('DELETE');
  });

  it('uses the authenticated capability-profile settings projection with revision fencing', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const status = {
      schemaVersion: 'ready4vibe_capability_profile_settings_status_v1',
      settings: { schemaVersion: 'ready4vibe_capability_profile_settings_v1', profile: { schemaVersion: 'ready4vibe_capability_profile_v1', profileId: 'preview', transportMode: 'loopback', modelMode: 'fake', filesystemMode: 'off', shellMode: 'off', networkMode: 'off', mcpSkillMode: 'off', approvalMode: 'none', policyRevision: 'policy-1', requiresAcknowledgement: false, updatedAt: '2026-08-05T00:00:00.000Z' }, profileRevision: 'profile-1', updatedAt: '2026-08-05T00:00:00.000Z' },
      resolution: { schemaVersion: 'ready4vibe_capability_profile_resolution_v1', status: 'ready', reasonCode: 'PROFILE_READY', requestedProfile: {}, effectiveProfile: {}, policyRevision: 'policy-1', evaluatedAt: '2026-08-05T00:00:00.000Z' },
      currentRevision: 'profile-1', previousRevision: null,
    } as const;
    const client = new ApiClient('', async (input, init) => { calls.push({ input, init }); return response(status); });
    await client.capabilityProfileSettings();
    await client.patchCapabilityProfileSettings({ profile: status.settings.profile, expectedRevision: 'profile-1' });
    await client.resetCapabilityProfileSettings('profile-2');
    expect(calls.map((call) => call.input)).toEqual(['/api/v1/settings/capability-profile', '/api/v1/settings/capability-profile', '/api/v1/settings/capability-profile/reset']);
    expect(calls[1]?.init?.method).toBe('PATCH');
    expect(calls[1]?.init?.body).toContain('profile-1');
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ expectedRevision: 'profile-2' }));
    expect(calls.map((call) => JSON.stringify(call.init?.body ?? '')).join('')).not.toMatch(/api[_-]?key|private[_-]?key|C:\\Users/iu);
  });

  it('uses daemon-owned permission settings and injects session identity only inside confirm/revoke requests', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const profile = {
      schemaVersion: 'ready4vibe_permission_profile_v1',
      profileId: 'full-host',
      filesystemScope: 'host',
      processScope: 'host',
      networkMode: 'off',
      mcpSkillMode: 'off',
      approvalPosture: 'session-auto',
      taskTrust: 'trusted-user',
      policyRevision: 'policy-1',
      profileRevision: 'profile-1',
      requiresConfirmation: true,
      updatedAt: '2026-08-05T00:00:00.000Z',
    } as const;
    const permissionStatus = {
      schemaVersion: 'ready4vibe_permission_status_v1',
      status: 'ready',
      reasonCode: 'PROFILE_READY',
      currentRevision: 'profile-1',
      requestedProfile: profile,
      effectiveProfile: profile,
      effectiveScope: {
        kind: 'run', profileId: 'full-host', filesystemScope: 'host', processScope: 'host',
        networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'session-auto', taskTrust: 'trusted-user',
        confirmationRef: 'confirmation-1',
      },
      grant: {
        schemaVersion: 'ready4vibe_permission_session_grant_v1', grantId: 'grant-1', sessionId: 'session', userId: 'local-user',
        scope: { kind: 'session', profileId: 'full-host', filesystemScope: 'host', processScope: 'host', networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'session-auto', taskTrust: 'trusted-user', confirmationRef: 'confirmation-1' },
        policyRevision: 'policy-1', profileRevision: 'profile-1', issuedAt: '2026-08-05T00:00:00.000Z', expiresAt: '2026-08-05T01:00:00.000Z',
        maxUses: 2, usedUses: 0, status: 'active', revokedAt: null, auditRef: 'audit-1',
      },
      grantExpiresAt: '2026-08-05T01:00:00.000Z',
      evaluatedAt: '2026-08-05T00:00:00.000Z',
      nextStep: 'continue',
    } as const;
    const settingsStatus = {
      schemaVersion: 'ready4vibe_permission_profile_settings_status_v1',
      settings: { schemaVersion: 'ready4vibe_permission_profile_settings_v1', profile, currentRevision: 'profile-1', previousRevision: null, updatedAt: '2026-08-05T00:00:00.000Z' },
      resolution: { schemaVersion: 'ready4vibe_permission_profile_resolution_v1', status: 'ready', reasonCode: 'PROFILE_READY', requestedProfile: profile, effectiveProfile: profile, policyRevision: 'policy-1', evaluatedAt: '2026-08-05T00:00:00.000Z', nextStep: 'continue' },
      currentRevision: 'profile-1', previousRevision: null,
    } as const;
    const revokeResult = {
      schemaVersion: 'ready4vibe_permission_revoke_result_v1', requestId: 'gevt_revoke', grantId: 'grant-1', status: 'revoked',
      currentRevision: 'profile-1', revokedAt: '2026-08-05T00:30:00.000Z', auditRef: 'audit-1',
    } as const;
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      if (input.endsWith('/permissions/revoke')) return response(revokeResult);
      if (input.endsWith('/permissions/status') || input.endsWith('/confirm-full-host')) return response(permissionStatus);
      return response(settingsStatus);
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    await client.permissionSettings();
    await client.patchPermissionSettings({ profile, expectedRevision: 'profile-1' });
    const status = await client.permissionStatus();
    const confirmed = await client.confirmFullHost({ requestedProfile: profile, expectedProfileRevision: 'profile-1' });
    await client.revokePermission({ grantId: 'grant-1', expectedRevision: 'profile-1', reason: 'user-requested' });

    expect(calls.map((call) => call.input)).toEqual([
      'http://daemon/api/v1/pairing/complete',
      'http://daemon/api/v1/settings/permissions',
      'http://daemon/api/v1/settings/permissions',
      'http://daemon/api/v1/settings/permissions/status',
      'http://daemon/api/v1/settings/permissions/confirm-full-host',
      'http://daemon/api/v1/settings/permissions/revoke',
    ]);
    for (const call of calls.slice(1)) expect(call.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
    expect(calls[1]?.init?.method).toBe('GET');
    expect(calls[2]?.init?.method).toBe('PATCH');
    expect(calls[2]?.init?.body).toBe(JSON.stringify({ profile, expectedRevision: 'profile-1' }));
    const confirmation = JSON.parse(String(calls[4]?.init?.body));
    expect(confirmation).toMatchObject({ schemaVersion: 'ready4vibe_permission_confirmation_request_v1', sessionId: 'session', userId: 'local-user', requestedProfile: profile, expectedProfileRevision: 'profile-1', acknowledged: true });
    expect(confirmation.requestId).toMatch(/^gevt_/u);
    expect(confirmation.requestedAt).toMatch(/T/u);
    const revoke = JSON.parse(String(calls[5]?.init?.body));
    expect(revoke).toMatchObject({ schemaVersion: 'ready4vibe_permission_revoke_request_v1', sessionId: 'session', userId: 'local-user', grantId: 'grant-1', expectedRevision: 'profile-1', reason: 'user-requested' });
    expect(revoke.requestId).toMatch(/^gevt_/u);
    expect(JSON.stringify(status)).not.toContain('sessionId');
    expect(JSON.stringify(status)).not.toContain('userId');
    expect(JSON.stringify(confirmed)).not.toContain('sessionId');
    expect(JSON.stringify(confirmed)).not.toContain('userId');
    expect(calls.map((call) => call.input).join('')).not.toMatch(/access|csrf|session/iu);
  });

  it('fails closed before a network call when full-host confirmation or revoke lacks a paired session', async () => {
    const calls: string[] = [];
    const client = new ApiClient('', async (input) => { calls.push(input); return response({}); });
    const profile = {
      schemaVersion: 'ready4vibe_permission_profile_v1', profileId: 'full-host', filesystemScope: 'host', processScope: 'host',
      networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'session-auto', taskTrust: 'trusted-user',
      policyRevision: 'policy-1', profileRevision: 'profile-1', requiresConfirmation: true, updatedAt: '2026-08-05T00:00:00.000Z',
    } as const;
    await expect(client.confirmFullHost({ requestedProfile: profile, expectedProfileRevision: 'profile-1' })).rejects.toEqual(new ApiError(401, 'AUTH_REQUIRED', 'Authentication required.'));
    await expect(client.revokePermission({ expectedRevision: 'profile-1', reason: 'user-requested' })).rejects.toEqual(new ApiError(401, 'AUTH_REQUIRED', 'Authentication required.'));
    expect(calls).toEqual([]);
  });

  it('uses the explicit model probe endpoint without accepting browser credentials', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      return response({ schemaVersion: 'ready4vibe_model_probe_result_v1', status: 'ready', checkedAt: '2026-08-05T00:00:00.000Z', latencyMs: 7, revision: 'probe-v1', errorCode: null, capabilities: { schemaVersion: 'ready4vibe_model_capability_snapshot_v1', providerId: 'openai-compatible', modelId: 'deepseek-v4-flash', descriptorRevision: 'probe-v1', capturedAt: '2026-08-05T00:00:00.000Z', streaming: 'unknown', toolCalls: 'unknown', vision: 'unknown', embeddings: 'unknown', contextLimit: 'unknown', outputLimit: 'unknown' } });
    });
    await expect(client.probeModel('https://api.deepseek.com/models')).resolves.toMatchObject({ status: 'ready' });
    expect(calls[0]?.input).toBe('/api/v1/settings/model/probe');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ endpoint: 'https://api.deepseek.com/models', timeoutMs: 5000 }));
    expect(String(calls[0]?.init?.body)).not.toContain('apiKey');
  });

  it('uses the authenticated agent-memory settings/probe/update/rollback endpoints without secrets', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const status = { schemaVersion: 'ready4vibe_agent_memory_settings_status_v0', settings: { schemaVersion: 'ready4vibe_agent_memory_settings_v1', enabled: false, mode: 'off', teamId: 'vibego', agentId: 'vibego-local-agent', userId: 'local-user', upstreamRepo: 'https://github.com/TencentCloud/TencentDB-Agent-Memory', upstreamRef: 'feat/server_team', autoUpdate: true, updateIntervalMinutes: 60, fallbackToDirectProvider: true }, status: { schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: false, mode: 'off', available: false, degraded: false, revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null, updateState: 'disabled', lastErrorCode: null, capabilities: [] }, currentRevision: null, previousRevision: null };
    const client = new ApiClient('', async (input, init) => { calls.push({ input, init }); return response(status); });
    await client.agentMemorySettings();
    await client.patchAgentMemorySettings({ enabled: true });
    await client.probeAgentMemory();
    await client.updateAgentMemory();
    await client.rollbackAgentMemory();
    expect(calls.map((call) => call.input)).toEqual(['/api/v1/settings/agent-memory', '/api/v1/settings/agent-memory', '/api/v1/settings/agent-memory/probe', '/api/v1/settings/agent-memory/update', '/api/v1/settings/agent-memory/rollback']);
    expect(calls[1]?.init?.method).toBe('PATCH');
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ enabled: true }));
    expect(calls.map((call) => call.input).join('')).not.toContain('apiKey');
  });

  it('loads the bounded agent-memory operations projection without exposing secrets', async () => {
    const operations = {
      schemaVersion: 'ready4vibe_agent_memory_operations_v1', currentRevision: 'a'.repeat(40), previousRevision: null,
      healthLatencyMs: 4, recall: { hits: 2, misses: 1, lastAt: null },
      writeQueue: { pending: 0, inFlight: false, accepted: 2, failed: 0, lastAttemptAt: null, lastErrorCode: null }, updates: [],
    };
    const calls: Array<{ input: string }> = [];
    const client = new ApiClient('', async (input) => { calls.push({ input: String(input) }); return response(operations); });
    await expect(client.agentMemoryOperations()).resolves.toEqual(operations);
    expect(calls).toEqual([{ input: '/api/v1/settings/agent-memory/updates' }]);
    expect(JSON.stringify(operations)).not.toMatch(/api[_-]?key|secret|C:\\private/iu);
  });

  it('uses the independent bounded knowledge settings and probe endpoints', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const status = { schemaVersion: 'ready4vibe_agent_memory_knowledge_settings_status_v0', settings: { schemaVersion: 'ready4vibe_agent_memory_knowledge_settings_v1', enabled: false, knowledgeId: 'wiki_demo', autoRetrieve: false, maxItems: 8, maxBytes: 8192, timeoutMs: 750 }, available: false, degraded: false, resourceType: null, resourceName: null, sourceRevision: null, tools: [], lastHealthAt: null, lastErrorCode: null };
    const client = new ApiClient('', async (input, init) => { calls.push({ input, init }); return response(status); });
    await client.agentMemoryKnowledgeSettings();
    await client.patchAgentMemoryKnowledgeSettings({ enabled: true, autoRetrieve: true, knowledgeId: 'wiki_demo' });
    await client.probeAgentMemoryKnowledge();
    expect(calls.map((call) => call.input)).toEqual(['/api/v1/settings/agent-memory/knowledge', '/api/v1/settings/agent-memory/knowledge', '/api/v1/settings/agent-memory/knowledge/probe']);
    expect(calls[1]?.init?.method).toBe('PATCH');
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ enabled: true, autoRetrieve: true, knowledgeId: 'wiki_demo' }));
    expect(calls.map((call) => call.input).join('')).not.toMatch(/endpoint|api[_-]?key/iu);
  });

  it('uses the authenticated MCP settings and explicit probe endpoints without raw transport data', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const status = {
      schemaVersion: 'ready4vibe_mcp_settings_status_v0',
      settings: { schemaVersion: 'ready4vibe_mcp_settings_v1', enabled: false, serverId: 'local-mcp', serverVersion: '1.0.0', transport: 'stdio', endpointLabel: 'Local MCP server', manifestRevision: 'unconfigured', capabilityAllowlist: [] },
      status: 'disabled', health: null, available: false, degraded: false, currentRevision: null, previousRevision: null, capabilityCount: 0, lastHealthAt: null, lastErrorCode: 'disabled', nextAction: 'enable',
    };
    const client = new ApiClient('', async (input, init) => { calls.push({ input, init }); return response(status); });
    await client.mcpSettings();
    await client.patchMcpSettings({ enabled: true });
    await client.probeMcp();
    expect(calls.map((call) => call.input)).toEqual(['/api/v1/settings/mcp', '/api/v1/settings/mcp', '/api/v1/settings/mcp/probe']);
    expect(calls[1]?.init?.method).toBe('PATCH');
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ enabled: true }));
    expect(calls.map((call) => call.input).join('')).not.toMatch(/api[_-]?key|token|secret|C:\\private/iu);
  });

  it('toggles filesystem tools through the authenticated settings endpoint', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      return response({ filesystemEnabled: init?.method === 'POST', workspaceLabel: 'workspace', availableTools: init?.method === 'POST' ? ['filesystem.read@1.0.0'] : [] });
    });
    await expect(client.toolSettings()).resolves.toMatchObject({ filesystemEnabled: false, workspaceLabel: 'workspace' });
    await expect(client.setFilesystemToolsEnabled(true)).resolves.toMatchObject({ filesystemEnabled: true });
    expect(calls.map((call) => call.input)).toEqual(['/api/v1/settings/tools', '/api/v1/settings/tools']);
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ filesystemEnabled: true }));
  });

  it('toggles Git read-only tools through the authenticated settings endpoint', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      return response({ enabled: init?.method === 'POST', workspaceLabel: 'workspace', availableTools: init?.method === 'POST' ? ['git.status@1.0.0', 'git.diff@1.0.0', 'git.log@1.0.0'] : [] });
    });
    await expect(client.gitSettings()).resolves.toMatchObject({ enabled: false, availableTools: [] });
    await expect(client.setGitToolsEnabled(true)).resolves.toMatchObject({ enabled: true, availableTools: ['git.status@1.0.0', 'git.diff@1.0.0', 'git.log@1.0.0'] });
    expect(calls.map((call) => call.input)).toEqual(['/api/v1/settings/git', '/api/v1/settings/git']);
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ enabled: true }));
  });

  it('uses guided workspace endpoints and never stores the daemon path', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      return response({ workspaces: [{ id: 'default', label: 'workspace', isDefault: true, canRemove: false, capabilities: { filesystem: true, externalSandbox: true } }] });
    });
    await client.workspaces();
    await client.addWorkspace({ id: 'repo-a', path: 'C:\\work\\repo-a', label: 'Repo A' });
    await client.removeWorkspace('repo-a');
    expect(calls[0]?.input).toBe('/api/v1/workspaces');
    expect(calls[1]?.init?.body).toContain('C:\\\\work\\\\repo-a');
    expect(calls[1]?.input).not.toContain('C:\\work\\repo-a');
    expect(calls[2]?.input).toBe('/api/v1/workspaces/repo-a');
  });

  it('probes and configures external sandbox settings through guided endpoints', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      return response({ provider: 'docker', detected: true, healthy: true, enabled: init?.method === 'POST' && input.endsWith('/sandbox'), imageDigest: null, network: 'restricted', resources: { maxMemoryBytes: 1, maxCpuMillis: 1, maxPids: 1, timeoutMs: 1, maxOutputBytes: 1 }, capabilities: null });
    });
    await expect(client.sandboxSettings()).resolves.toMatchObject({ enabled: false });
    await expect(client.probeSandbox('docker')).resolves.toMatchObject({ healthy: true });
    await expect(client.setSandboxSettings({ provider: 'docker', imageDigest: `ghcr.io/example@sha256:${'a'.repeat(64)}`, network: 'restricted', resources: {}, enabled: true })).resolves.toMatchObject({ provider: 'docker' });
    expect(calls.map((call) => call.input)).toEqual(['/api/v1/settings/sandbox', '/api/v1/settings/sandbox/probe', '/api/v1/settings/sandbox']);
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ provider: 'docker' }));
  });

  it('parses SSE frames, ignores heartbeat/invalid data and stops at terminal event', async () => {
    expect(parseSseFrame(': heartbeat')).toBeUndefined();
    expect(parseSseFrame('id: 4\nevent: model.delta\ndata: {"version":1,"id":"e4","seq":4,"runId":"run_1","type":"model.delta","at":"now","payload":{}}')).toMatchObject({ seq: 4, type: 'model.delta' });
    const createSseStream = () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('id: 1\nevent: model.delta\ndata: {"version":1,"id":"e1","seq":1,"runId":"run_1","type":"model.delta","at":"now","payload":{}}\n\n'));
        controller.enqueue(new TextEncoder().encode('id: 2\nevent: run.completed\ndata: {"version":1,"id":"e2","seq":2,"runId":"run_1","type":"run.completed","at":"now","payload":{}}\n\n'));
        controller.close();
      },
    });
    const fetcher: FetchLike = async (input) => {
      if (input.endsWith('/pairing/complete')) {
        return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      }
      return new Response(createSseStream(), { status: 200 });
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    const events: number[] = [];
    for await (const event of client.streamEvents('run_1')) events.push(event.seq);
    expect(events).toEqual([1, 2]);
  });

  it('projects safe API errors without exposing response internals', async () => {
    const client = new ApiClient('', async () => response({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' } }, 401));
    await expect(client.health()).rejects.toEqual(new ApiError(401, 'AUTH_REQUIRED', 'Authentication required.'));
  });
});
