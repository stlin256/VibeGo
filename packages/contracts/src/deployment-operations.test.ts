import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPLOYMENT_PROFILE,
  DEPLOYMENT_PROFILE_SCHEMA_VERSION,
  DEPLOYMENT_READINESS_SCHEMA_VERSION,
  DeploymentProfileSchema,
  buildDeploymentReadiness,
  createDeploymentProfile,
  parseDeploymentProfile,
  parseDeploymentReadiness,
} from './deployment-operations.js';

describe('deployment profile/readiness contract', () => {
  it('keeps loopback default and explicit LAN secure by default', () => {
    expect(DEFAULT_DEPLOYMENT_PROFILE).toMatchObject({ schemaVersion: DEPLOYMENT_PROFILE_SCHEMA_VERSION, mode: 'loopback', tlsRequired: false, allowInsecureLan: false });
    expect(createDeploymentProfile('lan')).toMatchObject({ mode: 'lan', tlsRequired: true, allowInsecureLan: false });
    expect(createDeploymentProfile('tailscale')).toMatchObject({ mode: 'tailscale', tlsRequired: true });
    expect(createDeploymentProfile('ssh')).toMatchObject({ mode: 'ssh', tlsRequired: true });
    expect(createDeploymentProfile('public-proxy')).toMatchObject({ mode: 'public-proxy', tlsRequired: true, certificateSource: 'reverse-proxy' });
  });

  it('rejects unknown fields, secrets, paths and invalid cross-mode settings', () => {
    const profile = createDeploymentProfile('lan');
    expect(() => parseDeploymentProfile({ ...profile, unknown: true })).toThrow();
    expect(() => parseDeploymentProfile({ ...profile, publicHostname: 'apiKey=sk-' + 'x'.repeat(24) })).toThrow(/secret/iu);
    expect(() => parseDeploymentProfile({ ...profile, publicHostname: 'C:\\private\\host' })).toThrow(/absolute|hostname/iu);
    expect(() => parseDeploymentProfile({ ...profile, trustedProxyCidrs: ['C:\\private\\proxy'] })).toThrow(/absolute|CIDR/iu);
    expect(() => parseDeploymentProfile({ ...profile, allowInsecureLan: true, mode: 'loopback' })).toThrow(/insecure/iu);
    expect(() => parseDeploymentProfile({ ...profile, certificateChallenge: 'dns-01', certificateSource: 'file' })).toThrow(/ACME/iu);
    expect(() => parseDeploymentProfile({ ...profile, mode: 'public-direct', certificateSource: 'reverse-proxy' })).toThrow(/reverse-proxy/iu);
  });

  it('fails closed for LAN/public modes and never silently falls back', () => {
    const lan = createDeploymentProfile('lan');
    expect(buildDeploymentReadiness(lan, {}, '2026-08-05T00:00:00.000Z')).toMatchObject({ status: 'blocked', reasonCode: 'certificate-required', affectsInteractiveRun: true });
    expect(buildDeploymentReadiness({ ...lan, tlsRequired: false, allowInsecureLan: true }, {}, '2026-08-05T00:00:00.000Z')).toMatchObject({ status: 'blocked', reasonCode: 'insecure-transport-disabled' });
    const direct = { ...createDeploymentProfile('public-direct'), publicHostname: 'vibego.example.com' };
    expect(buildDeploymentReadiness(direct, { certificate: 'ready' }, '2026-08-05T00:00:00.000Z')).toMatchObject({ status: 'ready', reasonCode: 'deployment-ready', mode: 'public-direct' });
    expect(buildDeploymentReadiness({ ...direct, publicHostname: null }, { certificate: 'ready' }, '2026-08-05T00:00:00.000Z')).toMatchObject({ status: 'blocked', reasonCode: 'hostname-required' });
  });

  it('keeps future Tailscale/SSH adapters bounded until health evidence exists', () => {
    const tailscale = createDeploymentProfile('tailscale');
    const ssh = createDeploymentProfile('ssh');
    expect(buildDeploymentReadiness(tailscale, {}, '2026-08-05T00:00:00.000Z')).toMatchObject({ status: 'unknown', reasonCode: 'adapter-health-unknown', nextStep: 'check-adapter' });
    expect(buildDeploymentReadiness(ssh, { adapter: 'blocked' }, '2026-08-05T00:00:00.000Z')).toMatchObject({ status: 'blocked', reasonCode: 'adapter-unavailable', affectsInteractiveRun: true });
  });

  it('validates and serializes only versioned bounded readiness metadata', () => {
    const profile = parseDeploymentProfile({ ...createDeploymentProfile('public-proxy'), trustedProxyCidrs: ['192.168.1.0/24'] });
    const readiness = buildDeploymentReadiness(profile, { proxyTrust: 'ready' }, '2026-08-05T00:00:00.000Z');
    expect(readiness).toMatchObject({ schemaVersion: DEPLOYMENT_READINESS_SCHEMA_VERSION, status: 'ready', nextStep: 'none' });
    expect(parseDeploymentReadiness(readiness)).toEqual(readiness);
    expect(JSON.stringify(readiness)).not.toMatch(/api[_-]?key|secret|token|C:\\\\|\/var\//iu);
    expect(() => DeploymentProfileSchema.parse({ ...profile, requestsPerMinute: 6_001 })).toThrow();
  });
});
