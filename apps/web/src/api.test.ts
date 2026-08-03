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

  it('configures model access through an authenticated body and exposes only safe status', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('', async (input, init) => {
      calls.push({ input, init });
      if (init?.method === 'POST') return response({ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'web-memory' });
      return response({ configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured' });
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
