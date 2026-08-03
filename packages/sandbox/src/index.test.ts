import { describe, expect, it, vi } from 'vitest';
import { SandboxResolver, SandboxUnavailableError, type SandboxProviderStatus, type SandboxProviderVerifier } from './index.js';

const externalPolicy = (provider: 'docker' | 'podman' | 'vm' = 'docker') => ({
  mode: 'external-sandbox' as const,
  provider,
  network: 'restricted' as const,
});

const healthyProvider = (overrides: Partial<SandboxProviderVerifier> = {}): SandboxProviderVerifier => ({
  runtime: 'docker',
  verify: vi.fn(async () => ({
    healthy: true,
    capabilities: {
      runtime: 'docker' as const,
      version: '27.0',
      isolation: 'container' as const,
      networkModes: ['restricted' as const, 'enabled' as const],
      maxMemoryBytes: 1024 * 1024 * 1024,
      maxCpuMillis: 4_000,
    },
  })),
  ...overrides,
});

describe('SandboxResolver', () => {
  it('resolves trusted host-restricted modes without a provider', async () => {
    const resolver = new SandboxResolver();
    await expect(resolver.resolve({
      taskTrust: 'trusted-workspace',
      policy: { mode: 'read-only', network: 'restricted' },
    })).resolves.toEqual({ mode: 'read-only', network: 'restricted' });
  });

  it('never falls back to a host mode for untrusted content', async () => {
    const resolver = new SandboxResolver();
    await expect(resolver.resolve({
      taskTrust: 'untrusted-content',
      policy: { mode: 'workspace-write', writableRoots: ['.'], network: 'restricted' },
    })).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE', reason: 'untrusted-host-fallback' });
  });

  it('fails closed when an external provider is missing or unhealthy', async () => {
    const missing = new SandboxResolver();
    await expect(missing.resolve({ taskTrust: 'untrusted-content', policy: externalPolicy() }))
      .rejects.toBeInstanceOf(SandboxUnavailableError);

    const unhealthy = healthyProvider({ verify: vi.fn(async () => ({ healthy: false })) });
    await expect(new SandboxResolver([unhealthy]).resolve({
      taskTrust: 'untrusted-content',
      policy: externalPolicy(),
    })).rejects.toMatchObject({ reason: 'provider-unhealthy' });

    const malformed = healthyProvider({ verify: vi.fn(async () => ({ healthy: true, capabilities: undefined } as unknown as SandboxProviderStatus)) });
    await expect(new SandboxResolver([malformed]).resolve({
      taskTrust: 'untrusted-content',
      policy: externalPolicy(),
    })).rejects.toMatchObject({ reason: 'provider-unhealthy' });
  });

  it('rejects capability mismatches and preserves the provider boundary', async () => {
    const provider = healthyProvider({
      verify: vi.fn(async () => ({
        healthy: true,
        capabilities: {
          runtime: 'docker' as const,
          version: '27.0',
          isolation: 'container' as const,
          networkModes: ['restricted' as const],
          maxMemoryBytes: 128,
          maxCpuMillis: 100,
        },
      })),
    });
    await expect(new SandboxResolver([provider]).resolve({
      taskTrust: 'untrusted-content',
      policy: externalPolicy(),
      resources: { maxMemoryBytes: 256 },
    })).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE', reason: 'capability-mismatch' });
  });

  it('requires an explicit confirmation for danger-full-access', async () => {
    const resolver = new SandboxResolver();
    const policy = { mode: 'danger-full-access' as const, enabledBy: 'explicit-user-only' as const };
    await expect(resolver.resolve({ taskTrust: 'trusted-workspace', policy }))
      .rejects.toMatchObject({ reason: 'danger-full-access-not-explicit' });
    await expect(resolver.resolve({ taskTrust: 'untrusted-content', policy, explicitDangerFullAccess: true }))
      .rejects.toMatchObject({ reason: 'danger-full-access-untrusted' });
    await expect(resolver.resolve({ taskTrust: 'trusted-workspace', policy, explicitDangerFullAccess: true }))
      .resolves.toEqual({ mode: 'danger-full-access', network: undefined });
  });

  it('returns a defensive capabilities snapshot for a healthy provider', async () => {
    const provider = healthyProvider();
    const result = await new SandboxResolver([provider]).resolve({
      taskTrust: 'untrusted-content',
      policy: externalPolicy(),
    });
    expect(result.provider).toBe('docker');
    expect(result.capabilities?.networkModes).toEqual(['restricted', 'enabled']);
    expect(result.capabilities).not.toBe((await provider.verify()).capabilities);
  });
});
