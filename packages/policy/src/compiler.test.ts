import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDescriptor } from '@ready4vibe/tools';
import {
  BoundedApprovalGrantStore,
  compilePolicy,
  createPolicyApprovalKey,
  type PolicyCompileInput,
} from './compiler.js';

const fingerprint = 'a'.repeat(64);

function descriptor(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return {
    id: 'filesystem.read',
    version: '1.0.0',
    risk: 'read',
    summary: 'Read a bounded workspace file.',
    supportedSandboxModes: ['read-only', 'workspace-write'],
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    ...overrides,
  };
}

function registry(...descriptors: ToolDescriptor[]): ToolRegistry {
  const value = new ToolRegistry();
  for (const item of descriptors) value.register(item);
  return value;
}

function input(overrides: Partial<PolicyCompileInput> = {}): PolicyCompileInput {
  return {
    registry: registry(descriptor()),
    workspaceId: 'workspace-1',
    toolId: 'filesystem.read',
    toolVersion: '1.0.0',
    risk: 'read',
    taskTrust: 'trusted-workspace',
    sandboxMode: 'read-only',
    networkAccess: 'restricted',
    policyRevision: 'policy-1',
    currentPolicyRevision: 'policy-1',
    sessionId: 'session-1',
    argumentsFingerprint: fingerprint,
    ...overrides,
  };
}

describe('compilePolicy', () => {
  it('returns deterministic allow metadata for a bounded read', () => {
    const first = compilePolicy(input());
    const second = compilePolicy(input());

    expect(first).toEqual(second);
    expect(first.decision).toBe('allow');
    expect(first.reasonCode).toBe('READ_ONLY');
    expect(first.effective).toEqual({ sandboxMode: 'read-only', networkAccess: 'restricted' });
    expect(first.approvalKey).toMatch(/^approval\.v1\.[a-f0-9]{64}$/u);
    expect(first.audit).toMatchObject({
      schemaVersion: 'ready4vibe_policy_audit_v1',
      toolId: 'filesystem.read',
      workspaceId: 'workspace-1',
      argumentFingerprint: fingerprint,
    });
    expect(JSON.stringify(first)).not.toContain('arguments');
    expect(JSON.stringify(first)).not.toContain('workspaceRoot');
  });

  it('binds approval keys to every security-relevant dimension', () => {
    const baseline = createPolicyApprovalKey(input());
    expect(createPolicyApprovalKey(input({ argumentsFingerprint: 'b'.repeat(64) }))).not.toBe(baseline);
    expect(createPolicyApprovalKey(input({ workspaceId: 'workspace-2' }))).not.toBe(baseline);
    expect(createPolicyApprovalKey(input({ sandboxMode: 'workspace-write' }))).not.toBe(baseline);
    expect(createPolicyApprovalKey(input({ networkAccess: 'enabled' }))).not.toBe(baseline);
    expect(createPolicyApprovalKey(input({ policyRevision: 'policy-2', currentPolicyRevision: 'policy-2' }))).not.toBe(baseline);
  });

  it('fails closed for unknown tools, missing schemas, mismatched risk and sandbox', () => {
    const cases: Array<[string, Partial<PolicyCompileInput>, string]> = [
      ['unknown tool', { toolId: 'missing.tool' }, 'UNKNOWN_TOOL'],
      ['missing schema', { registry: missingSchemaRegistry() }, 'SCHEMA_UNAVAILABLE'],
      ['risk mismatch', { risk: 'write' }, 'RISK_MISMATCH'],
      ['unsupported sandbox', { sandboxMode: 'external-sandbox', sandboxProvider: 'docker' }, 'SANDBOX_UNSUPPORTED'],
      ['untrusted host execution', { taskTrust: 'untrusted-content' }, 'UNTRUSTED_REQUIRES_EXTERNAL_SANDBOX'],
      ['missing external provider', { registry: registry(descriptor({ supportedSandboxModes: ['external-sandbox'] })), sandboxMode: 'external-sandbox' }, 'SANDBOX_PROVIDER_REQUIRED'],
      ['privilege request', { privilegeRequested: true }, 'PRIVILEGE_FORBIDDEN'],
      ['workspace escape', { registry: registry(descriptor({ risk: 'write', supportedSandboxModes: ['workspace-write'], inputSchema: { type: 'object' } })), risk: 'write', sandboxMode: 'workspace-write', writeScope: 'outside-workspace' }, 'WORKSPACE_SCOPE_FORBIDDEN'],
    ];

    for (const [label, overrides, reasonCode] of cases) {
      const result = compilePolicy(input(overrides));
      expect(result.decision, label).toBe('deny');
      expect(result.reasonCode, label).toBe(reasonCode);
    }
  });

  it('rejects secret-shaped and absolute-path schema metadata', () => {
    const secretSchema = compilePolicy(input({
      registry: registry(descriptor({ inputSchema: { type: 'object', properties: { api_key: { type: 'string' } } } })),
    }));
    expect(secretSchema).toMatchObject({ decision: 'deny', reasonCode: 'SCHEMA_UNSAFE' });

    const pathSchema = compilePolicy(input({
      registry: registry(descriptor({ inputSchema: { type: 'object', description: 'C:\\workspace\\input' } })),
    }));
    expect(pathSchema).toMatchObject({ decision: 'deny', reasonCode: 'SCHEMA_UNSAFE' });
  });

  it('requires explicit network amendment and never auto-allows network', () => {
    const restricted = compilePolicy(input({
      registry: registry(descriptor({ id: 'network.fetch', risk: 'network', supportedSandboxModes: ['external-sandbox'] })),
      toolId: 'network.fetch',
      risk: 'network',
      sandboxMode: 'external-sandbox',
      sandboxProvider: 'docker',
    }));
    expect(restricted).toMatchObject({ decision: 'deny', reasonCode: 'NETWORK_DISABLED' });

    const missingAmendment = compilePolicy(input({
      registry: registry(descriptor({ id: 'network.fetch', risk: 'network', supportedSandboxModes: ['external-sandbox'] })),
      toolId: 'network.fetch',
      risk: 'network',
      sandboxMode: 'external-sandbox',
      sandboxProvider: 'docker',
      networkAccess: 'enabled',
    }));
    expect(missingAmendment).toMatchObject({ decision: 'ask', reasonCode: 'NETWORK_APPROVAL_REQUIRED' });

    const untrusted = compilePolicy(input({
      registry: registry(descriptor({ id: 'network.fetch', risk: 'network', supportedSandboxModes: ['external-sandbox'] })),
      toolId: 'network.fetch',
      risk: 'network',
      taskTrust: 'untrusted-content',
      sandboxMode: 'external-sandbox',
      sandboxProvider: 'docker',
      networkAccess: 'enabled',
      networkApproval: 'explicit',
    }));
    expect(untrusted).toMatchObject({ decision: 'deny', reasonCode: 'UNTRUSTED_NETWORK_FORBIDDEN' });
  });

  it('allows only stricter client decisions', () => {
    expect(compilePolicy(input({ clientRequestedDecision: 'ask' })).reasonCode).toBe('CLIENT_REQUESTED_APPROVAL');
    expect(compilePolicy(input({ clientRequestedDecision: 'deny' }))).toMatchObject({ decision: 'deny', reasonCode: 'CLIENT_DENIED' });

    const write = compilePolicy(input({
      registry: registry(descriptor({ id: 'filesystem.write', risk: 'write', supportedSandboxModes: ['workspace-write'], inputSchema: { type: 'object' } })),
      toolId: 'filesystem.write',
      risk: 'write',
      sandboxMode: 'workspace-write',
      clientRequestedDecision: 'allow',
    }));
    expect(write.decision).toBe('ask');
    expect(write.reasonCode).toBe('USER_APPROVAL_REQUIRED');
  });

  it('accepts an active exact grant but rejects stale, exhausted and expired state', () => {
    const store = new BoundedApprovalGrantStore();
    const writeInput = input({
      registry: registry(descriptor({ id: 'filesystem.write', risk: 'write', supportedSandboxModes: ['workspace-write'], inputSchema: { type: 'object' } })),
      toolId: 'filesystem.write',
      risk: 'write',
      sandboxMode: 'workspace-write',
      now: 1_050,
    });
    const key = createPolicyApprovalKey(writeInput);
    const grant = store.issue(key, 'policy-1', { ttlMs: 100, maxUses: 2, reason: 'Allow bounded workspace writes', now: 1_000 });

    expect(store.inspect(key, 'policy-1', 1_050)).toMatchObject({ state: 'active', grant: { remainingUses: 2 } });
    const activeGrant = store.inspect(key, 'policy-1', 1_050).grant;
    expect(activeGrant).toBeDefined();
    if (!activeGrant) throw new Error('test grant was not created');
    expect(compilePolicy({ ...writeInput, grant: activeGrant })).toMatchObject({ decision: 'allow', reasonCode: 'SESSION_GRANT' });
    expect(store.consume(key, 'policy-1', 1_050)).toBe(true);
    expect(store.consume(key, 'policy-1', 1_051)).toBe(true);
    expect(store.consume(key, 'policy-1', 1_052)).toBe(false);
    expect(store.inspect(key, 'policy-1', 1_052).state).toBe('exhausted');
    const exhaustedGrant = store.inspect(key, 'policy-1', 1_052).grant;
    expect(exhaustedGrant).toBeDefined();
    if (!exhaustedGrant) throw new Error('test exhausted grant was not retained');
    expect(compilePolicy({ ...writeInput, grant: exhaustedGrant })).toMatchObject({ decision: 'ask', reasonCode: 'GRANT_EXHAUSTED' });

    const stale = store.issue(key, 'policy-1', { ttlMs: 100, maxUses: 1, reason: 'stale', now: 1_000 });
    expect(compilePolicy({ ...writeInput, grant: { ...stale, policyRevision: 'policy-1' }, currentPolicyRevision: 'policy-2' })).toMatchObject({ decision: 'deny', reasonCode: 'STALE_POLICY_REVISION' });
    expect(store.inspect(key, 'policy-1', 1_101).state).toBe('expired');
    expect(grant.reason).toBe('Allow bounded workspace writes');
  });

  it('never uses a write grant to auto-approve shell or network risk', () => {
    const shellInput = input({
      registry: registry(descriptor({ id: 'shell.exec', risk: 'destructive', supportedSandboxModes: ['external-sandbox'], inputSchema: { type: 'object' } })),
      toolId: 'shell.exec',
      risk: 'destructive',
      sandboxMode: 'external-sandbox',
      sandboxProvider: 'docker',
    });
    const key = createPolicyApprovalKey(shellInput);
    const store = new BoundedApprovalGrantStore();
    const grant = store.issue(key, 'policy-1', { ttlMs: 100, maxUses: 2, reason: 'shell must not be auto-approved', now: 1_000 });
    expect(compilePolicy({ ...shellInput, now: 1_010, grant })).toMatchObject({ decision: 'deny', reasonCode: 'GRANT_NOT_ELIGIBLE' });

    const networkInput = input({
      registry: registry(descriptor({ id: 'network.fetch', risk: 'network', supportedSandboxModes: ['external-sandbox'], inputSchema: { type: 'object' } })),
      toolId: 'network.fetch',
      risk: 'network',
      sandboxMode: 'external-sandbox',
      sandboxProvider: 'docker',
      networkAccess: 'enabled',
      networkApproval: 'explicit',
    });
    const networkKey = createPolicyApprovalKey(networkInput);
    const networkGrant = store.issue(networkKey, 'policy-1', { ttlMs: 100, maxUses: 2, reason: 'network must not be auto-approved', now: 1_000 });
    expect(compilePolicy({ ...networkInput, now: 1_010, grant: networkGrant })).toMatchObject({ decision: 'deny', reasonCode: 'GRANT_NOT_ELIGIBLE' });
  });

  it('rejects malformed fingerprints without echoing unsafe input', () => {
    const result = compilePolicy(input({ argumentsFingerprint: 'api_key=sk-' + 'x'.repeat(24) }));
    expect(result).toMatchObject({ decision: 'deny', reasonCode: 'INVALID_ARGUMENT_FINGERPRINT', approvalKey: 'approval.v1.invalid' });
    expect(JSON.stringify(result)).not.toContain('sk-');
  });
});

function missingSchemaRegistry(): ToolRegistry {
  const value = descriptor();
  delete value.inputSchema;
  return registry(value);
}

describe('BoundedApprovalGrantStore', () => {
  it('rejects unbounded grant options', () => {
    const store = new BoundedApprovalGrantStore();
    expect(() => store.issue('approval.v1.' + 'a'.repeat(64), 'policy-1', { ttlMs: 0, maxUses: 1, reason: 'x', now: 1 })).toThrow();
    expect(() => store.issue('approval.v1.' + 'a'.repeat(64), 'policy-1', { ttlMs: 1, maxUses: 0, reason: 'x', now: 1 })).toThrow();
    expect(() => store.issue('approval.v1.' + 'a'.repeat(64), 'policy-1', { ttlMs: 1, maxUses: 1, reason: 'x'.repeat(257), now: 1 })).toThrow();
  });
});
