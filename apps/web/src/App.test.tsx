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

  it('renders run metrics and output without exposing an absolute workspace path', () => {
    const html = renderToStaticMarkup(<App health={{ status: 'ok', service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } }} run={{ version: 1, runId: 'run_1', status: 'executing', config: {} as never, lastEventSeq: 2, output: 'hello', scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'read' } }} />);
    expect(html).toContain('hello');
    expect(html).toContain('active');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders an explicit approval card with allow and deny controls', () => {
    const html = renderToStaticMarkup(<App health={{ status: 'ok', service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } }} run={{ version: 1, runId: 'run_approval', status: 'waiting-approval', config: {} as never, lastEventSeq: 4, output: '', approvals: [{ approvalId: 'ap_1', runId: 'run_approval', turnId: 'turn_1', callId: 'call_1', toolId: 'filesystem.write', toolVersion: '1.0.0', risk: 'write', argumentBytes: 12, createdAt: 1_000, expiresAt: 2_000 }], scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'write' } }} onApprove={() => undefined} />);
    expect(html).toContain('APPROVAL REQUIRED');
    expect(html).toContain('Allow');
    expect(html).toContain('Deny');
  });
});
