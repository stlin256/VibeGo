import { describe, expect, it } from 'vitest';
import { ApprovalPolicy, SessionApprovalCache, createApprovalCacheKey, type ToolIntent } from './index.js';
import { ToolRegistry } from '@ready4vibe/tools';

const intent = (overrides: Partial<ToolIntent> = {}): ToolIntent => ({
  workspaceId: 'workspace-1',
  toolId: 'filesystem.write',
  toolVersion: '1.0.0',
  risk: 'write',
  taskTrust: 'trusted-workspace',
  sandboxMode: 'workspace-write',
  networkAccess: 'restricted',
  approvalPolicy: 'on-request',
  policyRevision: 'policy-1',
  sessionId: 'session-1',
  ...overrides,
});

function registry(): ToolRegistry {
  const value = new ToolRegistry();
  value.register({ id: 'filesystem.read', version: '1.0.0', risk: 'read', summary: 'read', supportedSandboxModes: ['read-only', 'workspace-write'] });
  value.register({ id: 'filesystem.write', version: '1.0.0', risk: 'write', summary: 'write', supportedSandboxModes: ['workspace-write', 'external-sandbox'] });
  value.register({ id: 'shell.exec', version: '1.0.0', risk: 'destructive', summary: 'execute', supportedSandboxModes: ['external-sandbox', 'workspace-write', 'danger-full-access'] });
  value.register({ id: 'wipe.disk', version: '1.0.0', risk: 'destructive', summary: 'wipe', supportedSandboxModes: ['read-only', 'workspace-write'] });
  value.register({ id: 'network.fetch', version: '1.0.0', risk: 'network', summary: 'fetch', supportedSandboxModes: ['external-sandbox'] });
  return value;
}

describe('ApprovalPolicy', () => {
  it('allows reads, prompts writes, and forbids destructive work', () => {
    const policy = new ApprovalPolicy(registry());
    expect(policy.evaluate(intent({ toolId: 'filesystem.read', risk: 'read', sandboxMode: 'workspace-write' })).decision).toBe('allow');
    expect(policy.evaluate(intent()).decision).toBe('prompt');
    expect(policy.evaluate(intent({ toolId: 'shell.exec', risk: 'destructive', sandboxMode: 'external-sandbox' })).decision).toBe('forbidden');
    expect(policy.evaluate(intent({ toolId: 'shell.exec', risk: 'destructive', sandboxMode: 'external-sandbox', sandboxProvider: 'docker' })).decision).toBe('prompt');
  });

  it('prompts destructive work on host-restricted modes but keeps read-only forbidden', () => {
    const policy = new ApprovalPolicy(registry());
    expect(policy.evaluate(intent({ toolId: 'shell.exec', risk: 'destructive', sandboxMode: 'workspace-write' })).decision).toBe('prompt');
    expect(policy.evaluate(intent({ toolId: 'shell.exec', risk: 'destructive', sandboxMode: 'danger-full-access' })).decision).toBe('prompt');
    expect(policy.evaluate(intent({ toolId: 'wipe.disk', risk: 'destructive', sandboxMode: 'read-only' })).reasonCode).toBe('DESTRUCTIVE_OPERATION');
    expect(policy.evaluate(intent({ toolId: 'shell.exec', risk: 'destructive', sandboxMode: 'workspace-write', approvalPolicy: 'never' })).reasonCode).toBe('APPROVAL_DISABLED');
  });

  it('requires external sandbox for untrusted content before other policy checks', () => {
    const policy = new ApprovalPolicy(registry());
    expect(policy.evaluate(intent({ taskTrust: 'untrusted-content' })).reasonCode).toBe('UNTRUSTED_REQUIRES_EXTERNAL_SANDBOX');
    expect(policy.evaluate(intent({ taskTrust: 'untrusted-content', sandboxMode: 'external-sandbox' })).decision).toBe('prompt');
  });

  it('forbids network tools when network access is restricted', () => {
    const policy = new ApprovalPolicy(registry());
    expect(policy.evaluate(intent({ toolId: 'network.fetch', risk: 'network', sandboxMode: 'external-sandbox', networkTarget: 'api.example.com' })).reasonCode).toBe('NETWORK_DISABLED');
    expect(policy.evaluate(intent({ toolId: 'network.fetch', risk: 'network', sandboxMode: 'external-sandbox', networkAccess: 'enabled', networkTarget: 'api.example.com' })).decision).toBe('prompt');
  });

  it('requires an explicit permissionRequest switch in granular policies', () => {
    const policy = new ApprovalPolicy(registry());
    expect(policy.evaluate(intent({ approvalPolicy: { granular: { sandboxApproval: true, ruleApproval: true, skillApproval: true, permissionRequest: false, mcpElicitation: true } } })).reasonCode).toBe('PERMISSION_REQUEST_DISABLED');
  });

  it('caches exact session approvals and invalidates changed fields or expiry', () => {
    const cache = new SessionApprovalCache();
    const value = intent();
    const key = createApprovalCacheKey(value);
    cache.grant(value, 100, 1_000);
    expect(cache.has(value, 1_050)).toBe(true);
    expect(cache.has({ ...value, path: 'other.txt' }, 1_050)).toBe(false);
    expect(cache.has(value, 1_100)).toBe(false);
    expect(key).toContain('workspace-1');
  });

  it('consumes alwaysPrompt grants on first use so every call prompts again', () => {
    const cache = new SessionApprovalCache();
    const value = intent({ alwaysPrompt: true });
    cache.grant(value, 100, 1_000);
    expect(cache.has(value, 150)).toBe(true);
    expect(cache.has(value, 160)).toBe(false);
    const reusable = intent();
    cache.grant(reusable, 100, 1_000);
    expect(cache.has(reusable, 150)).toBe(true);
    expect(cache.has(reusable, 160)).toBe(true);
  });

  it('turns a prompt into a session allow and can revoke it', () => {
    const policy = new ApprovalPolicy(registry());
    const value = intent();
    expect(policy.approve(value, 1_000, 500).decision).toBe('allow');
    expect(policy.evaluate(value, 600).reasonCode).toBe('SESSION_APPROVAL');
    policy.revoke(value);
    expect(policy.evaluate(value).decision).toBe('prompt');
  });

  it('forbids unknown tools and risk mismatches', () => {
    const policy = new ApprovalPolicy(registry());
    expect(policy.evaluate(intent({ toolId: 'unknown.tool' })).reasonCode).toBe('UNKNOWN_TOOL');
    expect(policy.evaluate(intent({ risk: 'read' })).reasonCode).toBe('RISK_MISMATCH');
  });
});
