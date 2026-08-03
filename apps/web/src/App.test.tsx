import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('web console shell', () => {
  it('renders a pairing-first surface with responsive semantic controls', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('输入一次性配对码');
    expect(html).toContain('pairing-code');
    expect(html).toContain('连接你的本地工作区');
    expect(html).toContain('VibeGo');
    expect(html).toContain('不可信任务强制 external sandbox');
  });

  it('renders the non-secret run settings onboarding surface', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Run profile');
    expect(html).toContain('Workspace id');
    expect(html).toContain('Model provider');
    expect(html).toContain('Reset conservative defaults');
    expect(html).toContain('Max context bytes');
    expect(html).not.toContain('api_key');
    expect(html).not.toContain('privatekey');
  });

  it('renders model setup guidance without rendering the provider key', () => {
    const html = renderToStaticMarkup(<App modelSettings={{ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'web-memory' }} />);
    expect(html).toContain('MODEL ACCESS');
    expect(html).toContain('Configured via web-memory');
    expect(html).toContain('Save provider');
    expect(html).not.toContain('test-secret');
  });

  it('renders an explicit guarded filesystem toggle without an absolute path', () => {
    const html = renderToStaticMarkup(<App toolSettings={{ filesystemEnabled: false, workspaceLabel: 'workspace', availableTools: [] }} onSetFilesystemToolsEnabled={() => undefined} />);
    expect(html).toContain('Enable guarded filesystem tools');
    expect(html).toContain('writes still require approval');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders guided external sandbox setup without exposing host paths', () => {
    const html = renderToStaticMarkup(<App sandboxSettings={{ provider: 'docker', detected: true, healthy: true, enabled: false, imageDigest: null, network: 'restricted', resources: { maxMemoryBytes: 1, maxCpuMillis: 1, maxPids: 1, timeoutMs: 1, maxOutputBytes: 1 }, capabilities: { version: 'test', networkModes: ['restricted'], maxMemoryBytes: 1, maxCpuMillis: 1 } }} onProbeSandbox={() => undefined} onSetSandboxSettings={() => undefined} />);
    expect(html).toContain('Probe runtime');
    expect(html).toContain('Enable external shell');
    expect(html).toContain('no host shell fallback');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders safe sandbox metadata on an approval card', () => {
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } };
    const html = renderToStaticMarkup(<App health={health} run={{ version: 1, runId: 'run_approval', status: 'waiting-approval', config: { sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' } } as never, lastEventSeq: 1, output: '', approvals: [{ approvalId: 'ap_12345678', runId: 'run_approval', turnId: 'turn', callId: 'call', toolId: 'shell.exec', toolVersion: '1.0.0', risk: 'destructive', argumentBytes: 24, createdAt: 1, expiresAt: Date.now() + 1_000, details: { sandboxProvider: 'docker', sandboxImageDigest: `ghcr.io/example@sha256:${'a'.repeat(64)}`, network: 'restricted' } }], scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'write' } }} />);
    expect(html).toContain('ghcr.io/example@sha256:');
    expect(html).toContain('network: restricted');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders run metrics and output without exposing an absolute workspace path', () => {
    const html = renderToStaticMarkup(<App health={{ status: 'ok', service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } }} run={{ version: 1, runId: 'run_1', status: 'executing', config: {} as never, lastEventSeq: 2, output: 'hello', scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'read' } }} />);
    expect(html).toContain('hello');
    expect(html).toContain('active');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders certificate metadata and safe missing-TLS guidance', () => {
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'https-lan', tlsRequired: true, boundAddresses: ['0.0.0.0'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } };
    const withStatus = renderToStaticMarkup(<App health={health} certificateStatus={{ subject: 'CN=dev.example.test', issuer: 'CN=Test CA', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2030-01-01T00:00:00.000Z', daysRemaining: 1000, fingerprint256: 'AA:BB:CC', subjectAltNames: ['dev.example.test'] }} />);
    expect(withStatus).toContain('CN=dev.example.test');
    expect(withStatus).toContain('dev.example.test');
    expect(withStatus).not.toContain('PRIVATE KEY');
    const missing = renderToStaticMarkup(<App health={health} certificateStatusUnavailable />);
    expect(missing).toContain('Certificate setup is required');
    expect(missing).not.toContain('.pem');
  });

  it('renders an explicit approval card with allow and deny controls', () => {
    const html = renderToStaticMarkup(<App health={{ status: 'ok', service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } }} run={{ version: 1, runId: 'run_approval', status: 'waiting-approval', config: {} as never, lastEventSeq: 4, output: '', approvals: [{ approvalId: 'ap_1', runId: 'run_approval', turnId: 'turn_1', callId: 'call_1', toolId: 'filesystem.write', toolVersion: '1.0.0', risk: 'write', argumentBytes: 12, createdAt: 1_000, expiresAt: 2_000 }], scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'write' } }} onApprove={() => undefined} />);
    expect(html).toContain('APPROVAL REQUIRED');
    expect(html).toContain('Allow');
    expect(html).toContain('Deny');
  });

  it('renders a safe explicit retry action for recovered runs', () => {
    const html = renderToStaticMarkup(<App health={{ status: 'ok', service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } }} run={{ version: 1, runId: 'run_recovered', status: 'needs-recovery', config: {} as never, lastEventSeq: 3, output: '', approvals: [{ approvalId: 'ap_old', runId: 'run_recovered', turnId: 'turn_1', callId: 'call_1', toolId: 'filesystem.write', toolVersion: '1.0.0', risk: 'write', argumentBytes: 20, createdAt: 1_000, expiresAt: 2_000 }], final: { summary: 'Run requires recovery after daemon restart.', exitReason: 'daemon-restarted' }, scheduler: { queuePosition: null, activeRunCount: 0, workspaceLease: null } }} onRetry={() => undefined} />);
    expect(html).toContain('RECOVERY REQUIRED');
    expect(html).toContain('Retry as new run');
    expect(html).not.toContain('APPROVAL REQUIRED');
    expect(html).not.toContain('C:\\Users');
  });
});
