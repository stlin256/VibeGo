import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App.js';
import { DEFAULT_RUN_PROFILE } from './api.js';

describe('web console shell', () => {
  it('renders a pairing-first surface with responsive semantic controls', () => {
    const html = renderToStaticMarkup(<App locale="zh-CN" />);
    expect(html).toContain('配对码');
    expect(html).toContain('pairing-code');
    expect(html).toContain('连接你的本地工作区');
    expect(html).toContain('VibeGo');
    expect(html).toContain('不可信任务强制使用外部沙箱');
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

  it('renders daemon-owned capability profile cards and bounded resolution guidance', () => {
    const profile = { schemaVersion: 'ready4vibe_capability_profile_v1', profileId: 'preview', transportMode: 'loopback', modelMode: 'fake', filesystemMode: 'off', shellMode: 'off', networkMode: 'off', mcpSkillMode: 'off', approvalMode: 'none', policyRevision: 'policy-1', requiresAcknowledgement: false, updatedAt: '2026-08-05T00:00:00.000Z' } as const;
    const status = { schemaVersion: 'ready4vibe_capability_profile_settings_status_v1', settings: { schemaVersion: 'ready4vibe_capability_profile_settings_v1', profile, profileRevision: 'profile-1', updatedAt: '2026-08-05T00:00:00.000Z' }, resolution: { schemaVersion: 'ready4vibe_capability_profile_resolution_v1', status: 'degraded', reasonCode: 'CAPABILITY_NARROWED', requestedProfile: profile, effectiveProfile: profile, policyRevision: 'policy-1', evaluatedAt: '2026-08-05T00:00:00.000Z' }, currentRevision: 'profile-1', previousRevision: null } as const;
    const html = renderToStaticMarkup(<App capabilityProfileSettings={status} onPatchCapabilityProfileSettings={() => undefined} onResetCapabilityProfileSettings={() => undefined} />);
    expect(html).toContain('Capability profile');
    expect(html).toContain('Workspace coding');
    expect(html).toContain('Advanced local');
    expect(html).toContain('Save capability profile');
    expect(html).toContain('Effective: preview');
    expect(html).toContain('reason: CAPABILITY_NARROWED');
    expect(html).toContain('revision: profile-1');
    expect(html).not.toMatch(/api[_-]?key|private[_-]?key|C:\\Users/iu);
  });

  it('keeps the interactive composer available beside a read-only Goal projection', () => {
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback' as const, tlsRequired: false, boundAddresses: ['127.0.0.1' as const] }, auth: { pairingRequired: false }, storage: { kind: 'memory' as const, status: 'ready' as const }, sandbox: { availableModes: ['read-only' as const], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow' as const, 'prompt' as const, 'forbidden' as const] } };
    const projection = { schemaVersion: 'ready4vibe_goal_api_v0', goals: [{ goal: { goalId: 'goal_12345678', title: 'Goal', objective: 'Objective', status: 'active', controlRevision: 0, createdAt: '2026-08-03T00:00:00.000Z', updatedAt: '2026-08-03T00:00:00.000Z', schemaVersion: 1 }, todos: [], gates: [], evidence: [], handoffs: [], quota: { spentTurnKeys: [], totalSpent: 0 }, lastEventId: null, lastAppendSequence: 0, sourceEventCount: 0, sourceChecksum: 'a'.repeat(64), controlRevision: 0 }] } as never;
    const html = renderToStaticMarkup(<App health={health} goalProjection={projection} onRefreshGoalProjection={() => undefined} />);
    expect(html).toContain('Conversation stream');
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
    expect(html).toContain('rail-new-button');
    expect(html).toContain('aria-label="Task input"');
    expect(html).toContain('Conversation stream');
    expect(html.indexOf('conversation-stream')).toBeLessThan(html.indexOf('composer-panel'));
    expect(html).toContain('Start run');
  });

  it('renders model setup guidance without rendering the provider key', () => {
    const html = renderToStaticMarkup(<App modelSettings={{ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'web-memory', credentialState: 'available' }} />);
    expect(html).toContain('MODEL ACCESS');
    expect(html).toContain('Configured via web-memory');
    expect(html).toContain('Save provider');
    expect(html).not.toContain('test-secret');
  });

  it('explains that a restored endpoint needs a credential without rendering a secret', () => {
    const html = renderToStaticMarkup(<App modelSettings={{ configured: false, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'durable-profile', credentialState: 'required' }} />);
    expect(html).toContain('Saved endpoint restored');
    expect(html).toContain('https://api.deepseek.com');
    expect(html).not.toMatch(/api[_-]?key\s*[:=]/iu);
  });

  it('renders the first-class DeepSeek settings card without exposing the key or raw response', () => {
    const html = renderToStaticMarkup(<App deepSeekSettings={{ schemaVersion: 'ready4vibe_deepseek_settings_status_v1', configured: true, providerId: 'deepseek', source: 'web-memory', credentialState: 'available', profile: { schemaVersion: 'ready4vibe_deepseek_settings_profile_v1', providerId: 'deepseek', endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off', timeoutMs: 30_000, maxRetries: 2, maxOutputTokens: 4_096, profileRevision: 'deepseek-settings-1', updatedAt: '2026-08-05T00:00:00.000Z' }, capability: null, lastProbe: { schemaVersion: 'deepseek-provider-probe/v1', status: 'ready', checkedAt: '2026-08-05T00:00:00.000Z', latencyMs: 42, errorCode: null, capabilities: null } }} onConfigureDeepSeek={() => undefined} onProbeDeepSeek={() => undefined} />);
    expect(html).toContain('DeepSeek (deep adaptation)');
    expect(html).toContain('Save DeepSeek');
    expect(html).toContain('Paste once; never displayed');
    expect(html).not.toContain('test-secret');
    expect(html).not.toContain('Authorization');
    expect(html).not.toContain('C:\\Users');
  });

  it('renders bounded approval-review settings and a frozen reviewer timeline without secrets', () => {
    const settings = { schemaVersion: 'llm-approval/v1' as const, enabled: true, reviewerSource: 'same-as-run' as const, dedicatedProfileId: null, posture: 'advisory-low-risk' as const, status: 'ready' as const, reviewerRevision: 'reviewer-2', policyRevision: 'policy-1', limits: { maxLatencyMs: 1_500, maxRequestBytes: 16_384, maxResponseBytes: 8_192, cacheTtlMs: 0 }, lastLatencyMs: 42, lastErrorCode: null, lastHealthAt: '2026-08-05T00:00:00.000Z', nextStep: 'Only exact, deterministic low-risk approval keys may be reviewed.', updatedAt: '2026-08-05T00:00:00.000Z' } as const;
    const health = { status: 'ok' as const, service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'http-loopback', tlsRequired: false, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } };
    const html = renderToStaticMarkup(<App health={health} approvalReviewSettings={settings} onPatchApprovalReviewSettings={() => undefined} onProbeApprovalReview={() => undefined} run={{ version: 1, runId: 'run_review', status: 'waiting-approval', config: { sandbox: { mode: 'workspace-write', network: 'restricted' } } as never, approvalReviewerSnapshot: { schemaVersion: 'llm-approval/v1', reviewerSource: 'same-as-run', dedicatedProfileId: null, providerId: 'deepseek', modelId: 'deepseek-v4-flash', descriptorRevision: 'model-1', policyRevision: 'policy-1', reviewerRevision: 'reviewer-2', posture: 'advisory-low-risk', limits: settings.limits, status: 'ready', capturedAt: '2026-08-05T00:00:00.000Z' }, lastEventSeq: 2, output: '', approvals: [{ approvalId: 'ap_review', runId: 'run_review', turnId: 'turn_review', callId: 'call_review', toolId: 'filesystem.write', toolVersion: '1.0.0', risk: 'write', argumentBytes: 24, createdAt: 1, expiresAt: 2 }], scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'write' } }} events={[{ version: 1, id: 'event-review', seq: 1, runId: 'run_review', type: 'review.completed', at: '2026-08-05T00:00:01.000Z', payload: { correlationId: 'call_review', decision: 'allow', reasonCode: 'eligible', latencyMs: 42 } }]} />);
    expect(html).toContain('Approval review');
    expect(html).toContain('Use current run model');
    expect(html).toContain('APPROVAL REVIEW SNAPSHOT');
    expect(html).toContain('REVIEWED');
    expect(html).toContain('Allow once');
    expect(html).toContain('Session-wide grants are managed in Permission settings.');
    expect(html).not.toMatch(/api[_-]?key|Authorization|private[_-]?key|C:\\Users\\|\/home\//iu);
  });

  it('renders the functional agent-memory settings card without secrets or paths', () => {
    const html = renderToStaticMarkup(<App agentMemorySettings={{ schemaVersion: 'ready4vibe_agent_memory_settings_status_v0', settings: { schemaVersion: 'ready4vibe_agent_memory_settings_v1', enabled: false, mode: 'off', teamId: 'vibego', agentId: 'vibego-local-agent', userId: 'local-user', upstreamRepo: 'https://github.com/TencentCloud/TencentDB-Agent-Memory', upstreamRef: 'feat/server_team', autoUpdate: true, updateIntervalMinutes: 60, fallbackToDirectProvider: true }, status: { schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: false, mode: 'off', available: false, degraded: false, revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null, updateState: 'disabled', lastErrorCode: null, capabilities: [] }, currentRevision: null, previousRevision: null }} agentMemoryOperations={{ schemaVersion: 'ready4vibe_agent_memory_operations_v1', currentRevision: null, previousRevision: null, healthLatencyMs: 3, recall: { hits: 2, misses: 1, lastAt: null }, writeQueue: { pending: 0, inFlight: false, accepted: 2, failed: 0, lastAttemptAt: null, lastErrorCode: null }, updates: [] }} onPatchAgentMemorySettings={() => undefined} onProbeAgentMemory={() => undefined} onUpdateAgentMemory={() => undefined} onRollbackAgentMemory={() => undefined} />);
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
    const knowledgeStart = html.indexOf('knowledge-setup');
    const mcpStart = html.indexOf('mcp-setup');
    const knowledgeHtml = html.slice(knowledgeStart, mcpStart);
    expect(knowledgeHtml).not.toMatch(/https?:\/\//iu);
    expect(knowledgeHtml).not.toMatch(/api[_-]?key|Authorization|raw upstream/iu);
    expect(knowledgeHtml).not.toContain('C:\\Users');
  });

  it('renders the optional MCP status card without endpoint URLs, commands, or secrets', () => {
    const html = renderToStaticMarkup(<App mcpSettings={{
      schemaVersion: 'ready4vibe_mcp_settings_status_v0',
      settings: { schemaVersion: 'ready4vibe_mcp_settings_v1', enabled: false, serverId: 'local-mcp', serverVersion: '1.0.0', transport: 'stdio', endpointLabel: 'Local MCP server', manifestRevision: 'unconfigured', capabilityAllowlist: [] },
      status: 'disabled', health: null, available: false, degraded: false, currentRevision: null, previousRevision: null, capabilityCount: 0, lastHealthAt: null, lastErrorCode: 'disabled', nextAction: 'enable',
    }} onPatchMcpSettings={() => undefined} onProbeMcp={() => undefined} />);
    expect(html).toContain('MCP / SKILL');
    expect(html).toContain('Enable optional MCP integration');
    expect(html).toContain('Save MCP settings');
    expect(html).toContain('Probe MCP');
    expect(html).not.toContain('apiKey');
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
    const blocked = renderToStaticMarkup(<App health={health} deploymentReadiness={{ schemaVersion: 'ready4vibe_deployment_readiness_v1', mode: 'lan', status: 'blocked', reasonCode: 'certificate-required', nextStep: 'configure-certificate', affectsInteractiveRun: true, evaluatedAt: '2026-08-05T00:00:00.000Z' }} />);
    expect(blocked).toContain('DEPLOYMENT STATUS');
    expect(blocked).toContain('blocked · lan');
    expect(blocked).toContain('configure-certificate');
    expect(blocked).not.toContain('C:\\Users');
  });

  it('renders bounded model probe status without any credential or raw response', () => {
    const html = renderToStaticMarkup(<App modelProbe={{ schemaVersion: 'ready4vibe_model_probe_result_v1', status: 'ready', checkedAt: '2026-08-05T00:00:00.000Z', latencyMs: 7, revision: 'probe-v1', errorCode: null, capabilities: { schemaVersion: 'ready4vibe_model_capability_snapshot_v1', providerId: 'openai-compatible', modelId: 'deepseek-v4-flash', descriptorRevision: 'probe-v1', capturedAt: '2026-08-05T00:00:00.000Z', streaming: 'unknown', toolCalls: 'unknown', vision: 'unknown', embeddings: 'unknown', contextLimit: 'unknown', outputLimit: 'unknown' } }} onProbeModel={() => undefined} />);
    expect(html).toContain('Model list endpoint');
    expect(html).toContain('Probe models');
    expect(html).toContain('deepseek-v4-flash');
    expect(html).not.toMatch(/api[_-]?key|Authorization|raw upstream/iu);
  });

  it('renders the explicit locale control and bounded live status in Chinese', () => {
    const html = renderToStaticMarkup(<App locale="zh-CN" onLocaleChange={() => undefined} />);
    expect(html).toContain('＋ 新任务');
    expect(html).toContain('语言');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="实时状态"');
    expect(html).toContain('等待配对');
    expect(html).not.toContain('vibego.locale.v1');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users/iu);
  });

  it('exposes a modal settings relationship and keyboard shortcut without secrets', () => {
    const html = renderToStaticMarkup(<App locale="en-US" />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-controls="settings-drawer"');
    expect(html).toContain('aria-keyshortcuts="Control+N Meta+N"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="settings-drawer-title"');
    expect(html).toContain('Max context bytes');
    expect(html).toContain('Untrusted tasks require an external sandbox');
    expect(html).not.toMatch(/api[_-]?key=[^"& ]+|Authorization:|C:\\Users\\[A-Za-z0-9._-]+/iu);
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
