import type { ApprovalPolicy as ApprovalPolicyConfig, TaskTrust } from '@ready4vibe/contracts';
import { ToolRegistry, type ToolDescriptor, type ToolRisk, type ToolSandboxMode } from '@ready4vibe/tools';

export * from './compiler.js';
export * from './capability-profile.js';
export * from './permission-profile.js';

export type PolicyDecision = 'allow' | 'prompt' | 'forbidden';

export interface ToolIntent {
  workspaceId: string;
  toolId: string;
  toolVersion: string;
  risk: ToolRisk;
  commandPrefix?: string;
  path?: string;
  networkTarget?: string;
  taskTrust: TaskTrust;
  sandboxMode: ToolSandboxMode;
  sandboxProvider?: 'docker' | 'podman' | 'vm';
  networkAccess: 'restricted' | 'enabled';
  approvalPolicy: ApprovalPolicyConfig;
  policyRevision: string;
  sessionId: string;
  /** If true, session approval grants are consumed on first use so every call prompts. */
  alwaysPrompt?: boolean;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reasonCode: string;
  cacheKey: string;
}

export class SessionApprovalCache {
  private readonly entries = new Map<string, number>();

  grant(intent: ToolIntent, ttlMs: number, now = Date.now()): string {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error('approval ttl must be a positive safe integer');
    const key = createApprovalCacheKey(intent);
    this.entries.set(key, now + ttlMs);
    return key;
  }

  has(intent: ToolIntent, now = Date.now()): boolean {
    const key = createApprovalCacheKey(intent);
    const expiresAt = this.entries.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.entries.delete(key);
      return false;
    }
    // One-shot grants for alwaysPrompt tools are consumed immediately so the
    // next call requires a fresh approval prompt.
    if (intent.alwaysPrompt) {
      this.entries.delete(key);
    }
    return true;
  }

  revoke(intent: ToolIntent): void {
    this.entries.delete(createApprovalCacheKey(intent));
  }

  clear(): void {
    this.entries.clear();
  }
}

export function createApprovalCacheKey(intent: ToolIntent): string {
  return JSON.stringify({
    workspaceId: intent.workspaceId,
    toolId: intent.toolId,
    toolVersion: intent.toolVersion,
    commandPrefix: intent.commandPrefix ?? null,
    path: intent.path ?? null,
    networkTarget: intent.networkTarget ?? null,
    sandboxMode: intent.sandboxMode,
    sandboxProvider: intent.sandboxProvider ?? null,
    policyRevision: intent.policyRevision,
  });
}

export class ApprovalPolicy {
  constructor(private readonly registry: ToolRegistry, private readonly cache = new SessionApprovalCache()) {}

  evaluate(intent: ToolIntent, now = Date.now()): PolicyEvaluation {
    const cacheKey = createApprovalCacheKey(intent);
    const descriptor = this.registry.get(intent.toolId, intent.toolVersion);
    if (!descriptor) return this.result('forbidden', 'UNKNOWN_TOOL', cacheKey);
    if (descriptor.risk !== intent.risk) return this.result('forbidden', 'RISK_MISMATCH', cacheKey);
    if (!descriptor.supportedSandboxModes.includes(intent.sandboxMode)) return this.result('forbidden', 'SANDBOX_UNSUPPORTED', cacheKey);
    if (intent.taskTrust === 'untrusted-content' && intent.sandboxMode !== 'external-sandbox') {
      return this.result('forbidden', 'UNTRUSTED_REQUIRES_EXTERNAL_SANDBOX', cacheKey);
    }
    if (intent.taskTrust === 'untrusted-content' && intent.sandboxMode === 'danger-full-access') {
      return this.result('forbidden', 'DANGER_FULL_ACCESS_FORBIDDEN', cacheKey);
    }
    if (intent.risk === 'network' && intent.networkAccess !== 'enabled') return this.result('forbidden', 'NETWORK_DISABLED', cacheKey);
    if (this.cache.has(intent, now)) return this.result('allow', 'SESSION_APPROVAL', cacheKey);
    return this.decisionForPolicy(intent, cacheKey);
  }

  approve(intent: ToolIntent, ttlMs: number, now = Date.now()): PolicyEvaluation {
    const evaluation = this.evaluate(intent);
    if (evaluation.decision !== 'prompt') throw new Error(`only prompt decisions may be approved: ${evaluation.reasonCode}`);
    this.cache.grant(intent, ttlMs, now);
    return this.result('allow', 'SESSION_APPROVAL_GRANTED', evaluation.cacheKey);
  }

  revoke(intent: ToolIntent): void {
    this.cache.revoke(intent);
  }

  private decisionForPolicy(intent: ToolIntent, cacheKey: string): PolicyEvaluation {
    if (intent.risk === 'read') return this.result('allow', 'READ_ONLY', cacheKey);
    if (intent.risk === 'destructive') {
      // Host-restricted shell runs under workspace-write / danger-full-access
      // and is approval-gated below instead of being hard-forbidden.
      const hostRestricted = intent.sandboxMode === 'workspace-write' || intent.sandboxMode === 'danger-full-access';
      if (!hostRestricted && (intent.sandboxMode !== 'external-sandbox' || !intent.sandboxProvider)) {
        return this.result('forbidden', 'DESTRUCTIVE_OPERATION', cacheKey);
      }
    }
    if (intent.approvalPolicy === 'never') return this.result('forbidden', 'APPROVAL_DISABLED', cacheKey);
    if (typeof intent.approvalPolicy === 'object' && !intent.approvalPolicy.granular.permissionRequest) {
      return this.result('forbidden', 'PERMISSION_REQUEST_DISABLED', cacheKey);
    }
    return this.result('prompt', 'USER_APPROVAL_REQUIRED', cacheKey);
  }

  private result(decision: PolicyDecision, reasonCode: string, cacheKey: string): PolicyEvaluation {
    return { decision, reasonCode, cacheKey };
  }
}

export type { ToolDescriptor };
