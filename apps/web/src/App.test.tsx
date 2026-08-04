import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import { DEFAULT_RUN_PROFILE } from './api.js';

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
    expect(html).toContain('WORKSPACES');
    expect(html).toContain('Model provider');
    expect(html).toContain('Reset conservative defaults');
    expect(html).toContain('Max context bytes');
    expect(html).not.toContain('api_key');
    expect(html).not.toContain('privatekey');
  });

  it('keeps the interactive composer available beside a read-only Goal projection', () => {
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback' as const, tlsRequired: false, boundAddresses: ['127.0.0.1' as const] }, auth: { pairingRequired: false }, storage: { kind: 'memory' as const, status: 'ready' as const }, sandbox: { availableModes: ['read-only' as const], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow' as const, 'prompt' as const, 'forbidden' as const] } };
    const projection = { schemaVersion: 'ready4vibe_goal_api_v0', goals: [{ goal: { goalId: 'goal_12345678', title: 'Goal', objective: 'Objective', status: 'active', controlRevision: 0, createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', schemaVersion: 1 }, todos: [], gates: [], evidence: [], handoffs: [], quota: { spentTurnKeys: [], totalSpent: 0 }, lastEventId: null, lastAppendSequence: 0, sourceEventCount: 0, sourceChecksum: 'a'.repeat(64), controlRevision: 0 }] } as never;
    const html = renderToStaticMarkup(<App health={health} goalProjection={projection} onRefreshGoalProjection={() => undefined} />);
    expect(html).toContain('CONVERSATION');
    expect(html).toContain('GOAL CONTROL · READ ONLY');
    expect(html).not.toContain('Claim');
    expect(html).not.toContain('Resolve gate');
  });

  it('renders Codex-like workspace, conversation, context and settings landmarks', () => {
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback' as const, tlsRequired: false, boundAddresses: ['127.0.0.1' as const] }, auth: { pairingRequired: false }, storage: { kind: 'memory' as const, status: 'ready' as const }, sandbox: { availableModes: ['read-only' as const], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow' as const, 'prompt' as const, 'forbidden' as const] } };
    const html = renderToStaticMarkup(<App health={health} />);
    expect(html).toContain('Workspace navigation');
    expect(html).toContain('Conversation and run timeline');
    expect(html).toContain('Run context');
    expect(html).toContain('aria-controls="settings-drawer"');
    expect(html).toContain('Close settings');
    expect(html).toContain('primary-task-button');
    expect(html).toContain('aria-label="Task input"');
    expect(html).toContain('Conversation stream');
    expect(html).toContain('NEW MESSAGE');
    expect(html.indexOf('conversation-stream')).toBeLessThan(html.indexOf('composer-panel'));
    expect(html).toContain('Start run');
  });

  it('renders model setup guidance without rendering the provider key', () => {
    const html = renderToStaticMarkup(<App modelSettings={{ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'web-memory' }} />);
    expect(html).toContain('MODEL ACCESS');
    expect(html).toContain('Configured via web-memory');
    expect(html).toContain('Save provider');
    expect(html).not.toContain('test-secret');
  });

  it('renders the functional agent-memory settings card without secrets or paths', () => {
    const html = renderToStaticMarkup(<App agentMemorySettings={{ schemaVersion: 'ready4vibe_agent_memory_settings_status_v0', settings: { schemaVersion: 'ready4vibe_agent_memory_settings_v1', enabled: false, mode: 'memory-core', teamId: 'vibego', agentId: 'vibego-local-agent', userId: 'local-user', upstreamRepo: 'https://github.com/TencentCloud/TencentDB-Agent-Memory', upstreamRef: 'feat/server_team', autoUpdate: true, updateIntervalMinutes: 60, fallbackToDirectProvider: true }, status: { schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: false, mode: 'off', available: false, degraded: false, revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null, updateState: 'disabled', lastErrorCode: null, capabilities: [] }, currentRevision: null, previousRevision: null }} agentMemoryOperations={{ schemaVersion: 'ready4vibe_agent_memory_operations_v1', currentRevision: null, previousRevision: null, healthLatencyMs: 3, recall: { hits: 2, misses: 1, lastAt: null }, writeQueue: { pending: 0, inFlight: false, accepted: 2, failed: 0, lastAttemptAt: null, lastErrorCode: null }, updates: [] }} onPatchAgentMemorySettings={() => undefined} onProbeAgentMemory={() => undefined} onUpdateAgentMemory={() => undefined} onRollbackAgentMemory={() => undefined} />);
    expect(html).toContain('AGENT MEMORY');
    expect(html).toContain('Enable optional long-term memory');
    expect(html).toContain('Save memory settings');
    expect(html).toContain('Probe');
    expect(html).toContain('Roll back');
    expect(html).toContain('recall hits 2 / misses 1');
    expect(html).toContain('Lock ref to an immutable commit SHA');
    expect(html).not.toContain('apiKey');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders the optional knowledge settings card with bounded controls', () => {
    const html = renderToStaticMarkup(<App agentMemoryKnowledgeSettings={{ schemaVersion: 'ready4vibe_agent_memory_knowledge_settings_status_v0', settings: { schemaVersion: 'ready4vibe_agent_memory_knowledge_settings_v1', enabled: false, knowledgeId: 'wiki_demo', autoRetrieve: false, maxItems: 8, maxBytes: 8192, timeoutMs: 750 }, available: false, degraded: false, resourceType: null, resourceName: null, sourceRevision: null, tools: [], lastHealthAt: null, lastErrorCode: null }} onPatchAgentMemoryKnowledgeSettings={() => undefined} onProbeAgentMemoryKnowledge={() => undefined} />);
    expect(html).toContain('KNOWLEDGE RETRIEVAL');
    expect(html).toContain('Enable optional knowledge resource');
    expect(html).toContain('Resource ID');
    expect(html).toContain('Retrieve once for each new run');
    expect(html).toContain('Save knowledge settings');
    expect(html).toContain('Probe knowledge');
    expect(html).not.toContain('endpoint');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders an explicit guarded filesystem toggle without an absolute path', () => {
    const html = renderToStaticMarkup(<App toolSettings={{ filesystemEnabled: false, workspaceLabel: 'workspace', availableTools: [] }} onSetFilesystemToolsEnabled={() => undefined} />);
    expect(html).toContain('Enable guarded filesystem tools');
    expect(html).toContain('writes still require approval');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders the guided Git read-only tools toggle without an absolute path', () => {
    const html = renderToStaticMarkup(<App gitSettings={{ enabled: false, workspaceLabel: 'workspace', availableTools: [] }} onSetGitToolsEnabled={() => undefined} />);
    expect(html).toContain('GIT READ-ONLY TOOLS');
    expect(html).toContain('Enable Git read-only tools');
    expect(html).toContain('commits, checkout, reset');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders guided external sandbox setup without exposing host paths', () => {
    const html = renderToStaticMarkup(<App sandboxSettings={{ provider: 'docker', detected: true, healthy: true, enabled: false, imageDigest: null, network: 'restricted', resources: { maxMemoryBytes: 1, maxCpuMillis: 1, maxPids: 1, timeoutMs: 1, maxOutputBytes: 1 }, capabilities: { version: 'test', networkModes: ['restricted'], maxMemoryBytes: 1, maxCpuMillis: 1 } }} onProbeSandbox={() => undefined} onSetSandboxSettings={() => undefined} />);
    expect(html).toContain('Probe runtime');
    expect(html).toContain('Enable external shell');
    expect(html).toContain('no host shell fallback');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders a guided workspace selector and add/remove controls without echoing paths', () => {
    const html = renderToStaticMarkup(<App profile={{ ...DEFAULT_RUN_PROFILE, workspaceId: 'repo-a' }} workspaces={{ workspaces: [{ id: 'default', label: 'ready4vibe', isDefault: true, canRemove: false, capabilities: { filesystem: true, externalSandbox: true } }, { id: 'repo-a', label: 'Project A', isDefault: false, canRemove: true, capabilities: { filesystem: true, externalSandbox: true } }] }} onAddWorkspace={() => undefined} onRemoveWorkspace={() => undefined} />);
    expect(html).toContain('Workspace<select');
    expect(html).toContain('Add workspace');
    expect(html).toContain('Remove');
    expect(html).toContain('Added paths are on the daemon machine');
    expect(html).not.toContain('C:\\work\\project-a');
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

  it('renders bounded Git tool output as safe text without exposing an absolute path', () => {
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } };
    const root = 'C:\\private\\workspace';
    const events = [
      { version: 1 as const, id: 'e1', seq: 1, runId: 'run_git', type: 'tool.requested', at: '2026-08-03T00:00:00.000Z', payload: { callId: 'call_git', toolId: 'git.diff' } },
      { version: 1 as const, id: 'e2', seq: 2, runId: 'run_git', type: 'tool.output', at: '2026-08-03T00:00:01.000Z', payload: { callId: 'call_git', bytes: 24, truncated: false, content: JSON.stringify({ exitCode: 0, stdout: `changed [workspace]`, stderr: '' }) } },
    ];
    const html = renderToStaticMarkup(<App health={health} run={{ version: 1, runId: 'run_git', status: 'executing', config: {} as never, lastEventSeq: 2, output: '', scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'read' } }} events={events} />);
    expect(html).toContain('TOOL OUTPUTS');
    expect(html).toContain('git.diff');
    expect(html).toContain('changed [workspace]');
    expect(html).not.toContain(root);
  });

  it('ignores malformed tool events and caps the rendered output cards', () => {
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } };
    const events = Array.from({ length: 30 }, (_, index) => ({ version: 1 as const, id: `e${index}`, seq: index + 1, runId: 'run_git', type: 'tool.output', at: '2026-08-03T00:00:00.000Z', payload: index === 29 ? { callId: 'bad', content: '<img src=x onerror=alert(1)>' } : { callId: `call-${index}`, bytes: 4, content: 'safe' } }));
    const html = renderToStaticMarkup(<App health={health} run={{ version: 1, runId: 'run_git', status: 'executing', config: {} as never, lastEventSeq: 30, output: '', scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'read' } }} events={events} />);
    expect(html.match(/class="tool-output-card"/gu)?.length).toBe(24);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
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
