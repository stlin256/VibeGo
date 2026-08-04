import type { AuditEvent } from '@ready4vibe/contracts';
import {
  AuditApplicationAdapter,
  type AuditApplicationAdapterOptions,
  type AuditEventInput,
  type AuditEventWriter,
  type AuditRecordResult,
} from './audit-adapter.js';

type Action =
  | 'settings.updated'
  | 'settings.probed'
  | 'approval.requested'
  | 'approval.decided'
  | 'sandbox.configured'
  | 'model.configured'
  | 'provider.degraded'
  | 'usage.exported'
  | 'audit.verified';

type TargetKind = AuditEvent['targetKind'];

export type AuditApplicationActionInput = Omit<AuditEventInput, 'action' | 'targetKind'> & {
  readonly action: Action;
  readonly targetKind: TargetKind;
};

const ACTION_TARGETS: Readonly<Record<Action, readonly TargetKind[]>> = Object.freeze({
  'settings.updated': ['settings'],
  'settings.probed': ['settings'],
  'approval.requested': ['run', 'tool', 'sandbox'],
  'approval.decided': ['run', 'tool', 'sandbox'],
  'sandbox.configured': ['sandbox'],
  'model.configured': ['model'],
  'provider.degraded': ['model'],
  'usage.exported': ['export'],
  'audit.verified': ['audit'],
});

/**
 * Application vocabulary for security-relevant changes. It is intentionally
 * a thin allowlist over AuditApplicationAdapter: the ledger/hash chain remains
 * the only durable authority and all details still pass the existing privacy
 * and bounded-field contract.
 */
export class ObservabilityAuditApplicationService {
  private readonly adapter: AuditApplicationAdapter;

  constructor(adapterOrWriter: AuditApplicationAdapter | AuditEventWriter, options: AuditApplicationAdapterOptions = {}) {
    this.adapter = adapterOrWriter instanceof AuditApplicationAdapter ? adapterOrWriter : new AuditApplicationAdapter(adapterOrWriter, options);
  }

  record(input: AuditApplicationActionInput): Promise<AuditRecordResult> {
    if (!isAllowedActionTarget(input.action, input.targetKind)) {
      return Promise.resolve({ status: 'rejected', errorCode: 'OBSERVABILITY_AUDIT_INVALID' });
    }
    return this.adapter.record(input);
  }

  settings(input: Omit<AuditApplicationActionInput, 'action' | 'targetKind'> & { readonly action?: 'settings.updated' | 'settings.probed' }): Promise<AuditRecordResult> {
    return this.record({ ...input, action: input.action ?? 'settings.updated', targetKind: 'settings' });
  }

  approval(input: Omit<AuditApplicationActionInput, 'action'> & { readonly action: 'approval.requested' | 'approval.decided' }): Promise<AuditRecordResult> {
    if (!['run', 'tool', 'sandbox'].includes(input.targetKind)) return Promise.resolve({ status: 'rejected', errorCode: 'OBSERVABILITY_AUDIT_INVALID' });
    return this.record(input);
  }

  sandbox(input: Omit<AuditApplicationActionInput, 'action' | 'targetKind'> & { readonly action?: 'sandbox.configured' }): Promise<AuditRecordResult> {
    return this.record({ ...input, action: input.action ?? 'sandbox.configured', targetKind: 'sandbox' });
  }

  provider(input: Omit<AuditApplicationActionInput, 'action' | 'targetKind'> & { readonly action: 'model.configured' | 'provider.degraded' }): Promise<AuditRecordResult> {
    return this.record({ ...input, targetKind: 'model' });
  }

  exportCompleted(input: Omit<AuditApplicationActionInput, 'action' | 'targetKind'>): Promise<AuditRecordResult> {
    return this.record({ ...input, action: 'usage.exported', targetKind: 'export' });
  }

  verificationCompleted(input: Omit<AuditApplicationActionInput, 'action' | 'targetKind'>): Promise<AuditRecordResult> {
    return this.record({ ...input, action: 'audit.verified', targetKind: 'audit' });
  }
}

function isAllowedActionTarget(action: Action, targetKind: TargetKind): boolean {
  return ACTION_TARGETS[action]?.includes(targetKind) ?? false;
}
