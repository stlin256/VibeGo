import { DatabaseSync } from 'node:sqlite';
import {
  AuditEventSchema,
  ModelUsageRecordSchema,
  ResourceSampleSchema,
  ToolUsageRecordSchema,
  UsageRollupSchema,
  type AuditEvent,
  type ModelUsageRecord,
  type ResourceSample,
  type ToolUsageRecord,
  type UsageRollup,
} from '@ready4vibe/contracts';
import {
  buildUsageRollups,
  canonicalObservabilityJson,
  fingerprintAuditContent,
  fingerprintAuditEvent,
  fingerprintResourceSample,
  fingerprintToolUsageRecord,
  fingerprintUsageRecord,
  sealAuditEvent,
  verifyAuditChain,
  type AuditEventDraft,
} from '@ready4vibe/observability';

export class ObservabilityLedgerConflictError extends Error {
  readonly code = 'OBSERVABILITY_LEDGER_CONFLICT';

  constructor(readonly entryId: string) {
    super('An observability entry id was already used with different content.');
    this.name = 'ObservabilityLedgerConflictError';
  }
}

export class ObservabilityLedgerError extends Error {
  constructor(readonly code: 'OBSERVABILITY_LEDGER_CLOSED' | 'OBSERVABILITY_LEDGER_STORAGE' | 'OBSERVABILITY_AUDIT_CHAIN', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ObservabilityLedgerError';
  }
}

export interface ObservabilityBatch {
  readonly resourceSamples?: readonly ResourceSample[];
  readonly modelUsages?: readonly ModelUsageRecord[];
  readonly toolUsages?: readonly ToolUsageRecord[];
  readonly auditEvents?: readonly AuditEventDraft[];
}

export interface ObservabilityBatchResult {
  readonly resourceSamples: readonly ResourceSample[];
  readonly modelUsages: readonly ModelUsageRecord[];
  readonly toolUsages: readonly ToolUsageRecord[];
  readonly auditEvents: readonly AuditEvent[];
}

export interface ObservabilityCleanupCutoffs {
  readonly samplesBefore?: string;
  readonly rollupsBefore?: string;
}

export interface ObservabilityCleanupResult {
  readonly resourceSamples: number;
  readonly rollups: number;
}

export interface ObservabilityLedger {
  appendBatch(batch: ObservabilityBatch): Promise<ObservabilityBatchResult>;
  listResourceSamples(): Promise<readonly ResourceSample[]>;
  listModelUsage(): Promise<readonly ModelUsageRecord[]>;
  listToolUsage(): Promise<readonly ToolUsageRecord[]>;
  listAuditEvents(): Promise<readonly AuditEvent[]>;
  listRollups(): Promise<readonly UsageRollup[]>;
  rebuildRollups(): Promise<readonly UsageRollup[]>;
  cleanup(cutoffs: ObservabilityCleanupCutoffs): Promise<ObservabilityCleanupResult>;
  close(): Promise<void>;
}

type StoredResource = { value: ResourceSample; fingerprint: string };
type StoredModel = { value: ModelUsageRecord; fingerprint: string };
type StoredTool = { value: ToolUsageRecord; fingerprint: string };
type StoredAudit = { value: AuditEvent; contentFingerprint: string };
type StoredRollup = { value: UsageRollup; fingerprint: string };

/** Deterministic adapter used before any SQLite or collector integration. */
export class InMemoryObservabilityLedger implements ObservabilityLedger {
  private readonly resources = new Map<string, StoredResource>();
  private readonly models = new Map<string, StoredModel>();
  private readonly tools = new Map<string, StoredTool>();
  private readonly audits = new Map<string, StoredAudit>();
  private readonly rollups = new Map<string, StoredRollup>();
  private closed = false;

  async appendBatch(batch: ObservabilityBatch): Promise<ObservabilityBatchResult> {
    this.ensureOpen();
    if (!verifyAuditChain(await this.listAuditEvents())) throw new ObservabilityLedgerError('OBSERVABILITY_AUDIT_CHAIN', 'Stored audit chain failed verification.');
    const resources = (batch.resourceSamples ?? []).map((value) => ResourceSampleSchema.parse(value));
    const models = (batch.modelUsages ?? []).map((value) => ModelUsageRecordSchema.parse(value));
    const tools = (batch.toolUsages ?? []).map((value) => ToolUsageRecordSchema.parse(value));
    const auditDrafts = (batch.auditEvents ?? []).map((value) => validateAuditDraft(value));

    const resourceResult: ResourceSample[] = [];
    const modelResult: ModelUsageRecord[] = [];
    const toolResult: ToolUsageRecord[] = [];
    const auditResult: AuditEvent[] = [];
    const plannedResources = new Map(this.resources);
    const plannedModels = new Map(this.models);
    const plannedTools = new Map(this.tools);
    const plannedAudits = new Map(this.audits);
    let nextAuditSequence = (this.latestAudit()?.value.appendSequence ?? 0) + 1;
    let previousAuditHash = this.latestAudit()?.value.eventHash ?? null;

    for (const value of resources) {
      const fingerprint = fingerprintResourceSample(value);
      const existing = plannedResources.get(value.sampleId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ObservabilityLedgerConflictError(value.sampleId);
        resourceResult.push(existing.value);
        continue;
      }
      plannedResources.set(value.sampleId, { value, fingerprint });
      resourceResult.push(value);
    }
    for (const value of models) {
      const fingerprint = fingerprintUsageRecord(value);
      const existing = plannedModels.get(value.usageId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ObservabilityLedgerConflictError(value.usageId);
        modelResult.push(existing.value);
        continue;
      }
      plannedModels.set(value.usageId, { value, fingerprint });
      modelResult.push(value);
    }
    for (const value of tools) {
      const fingerprint = fingerprintToolUsageRecord(value);
      const existing = plannedTools.get(value.usageId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ObservabilityLedgerConflictError(value.usageId);
        toolResult.push(existing.value);
        continue;
      }
      plannedTools.set(value.usageId, { value, fingerprint });
      toolResult.push(value);
    }
    for (const draft of auditDrafts) {
      const candidate = sealAuditEvent(draft, nextAuditSequence, previousAuditHash);
      const contentFingerprint = fingerprintAuditContent(candidate);
      const existing = plannedAudits.get(draft.eventId);
      if (existing) {
        if (existing.contentFingerprint !== contentFingerprint) throw new ObservabilityLedgerConflictError(draft.eventId);
        auditResult.push(existing.value);
        continue;
      }
      plannedAudits.set(draft.eventId, { value: candidate, contentFingerprint });
      auditResult.push(candidate);
      nextAuditSequence += 1;
      previousAuditHash = candidate.eventHash;
    }

    this.resources.clear();
    for (const [key, value] of plannedResources) this.resources.set(key, value);
    this.models.clear();
    for (const [key, value] of plannedModels) this.models.set(key, value);
    this.tools.clear();
    for (const [key, value] of plannedTools) this.tools.set(key, value);
    this.audits.clear();
    for (const [key, value] of plannedAudits) this.audits.set(key, value);

    return freezeBatchResult({ resourceSamples: resourceResult, modelUsages: modelResult, toolUsages: toolResult, auditEvents: auditResult });
  }

  async listResourceSamples(): Promise<readonly ResourceSample[]> {
    this.ensureOpen();
    return Object.freeze([...this.resources.values()].map((entry) => entry.value));
  }

  async listModelUsage(): Promise<readonly ModelUsageRecord[]> {
    this.ensureOpen();
    return Object.freeze([...this.models.values()].map((entry) => entry.value));
  }

  async listToolUsage(): Promise<readonly ToolUsageRecord[]> {
    this.ensureOpen();
    return Object.freeze([...this.tools.values()].map((entry) => entry.value));
  }

  async listAuditEvents(): Promise<readonly AuditEvent[]> {
    this.ensureOpen();
    return Object.freeze([...this.audits.values()].map((entry) => entry.value).sort((left, right) => left.appendSequence - right.appendSequence));
  }

  async listRollups(): Promise<readonly UsageRollup[]> {
    this.ensureOpen();
    return Object.freeze([...this.rollups.values()].map((entry) => entry.value).sort((left, right) => left.periodStart.localeCompare(right.periodStart)));
  }

  async rebuildRollups(): Promise<readonly UsageRollup[]> {
    this.ensureOpen();
    const values = buildUsageRollups(await this.listModelUsage(), await this.listResourceSamples(), await this.listAuditEvents());
    this.rollups.clear();
    for (const value of values) this.rollups.set(value.rollupId, { value, fingerprint: fingerprintRollup(value) });
    return values;
  }

  async cleanup(cutoffs: ObservabilityCleanupCutoffs): Promise<ObservabilityCleanupResult> {
    this.ensureOpen();
    const samplesBefore = validateCutoff(cutoffs.samplesBefore);
    const rollupsBefore = validateCutoff(cutoffs.rollupsBefore);
    let resourceSamples = 0;
    let rollups = 0;
    if (samplesBefore) {
      for (const [key, entry] of this.resources) {
        if (Date.parse(entry.value.sampledAt) < samplesBefore) {
          this.resources.delete(key);
          resourceSamples += 1;
        }
      }
    }
    if (rollupsBefore) {
      for (const [key, entry] of this.rollups) {
        if (Date.parse(entry.value.periodEnd) < rollupsBefore) {
          this.rollups.delete(key);
          rollups += 1;
        }
      }
    }
    return { resourceSamples, rollups };
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private latestAudit(): StoredAudit | undefined {
    return [...this.audits.values()].sort((left, right) => right.value.appendSequence - left.value.appendSequence)[0];
  }

  private ensureOpen(): void {
    if (this.closed) throw new ObservabilityLedgerError('OBSERVABILITY_LEDGER_CLOSED', 'Observability ledger is closed.');
  }
}

type ResourceRow = { sample_id: string; fingerprint: string; payload_json: string };
type UsageRow = { usage_id: string; kind: 'model' | 'tool'; fingerprint: string; payload_json: string };
type AuditRow = { event_id: string; append_sequence: number; content_fingerprint: string; payload_json: string };
type RollupRow = { rollup_id: string; fingerprint: string; payload_json: string };

/** Durable adapter. It owns four observability tables and never alters run_events. */
export class SqliteObservabilityLedger implements ObservabilityLedger {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string | URL) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS resource_samples (
        sample_id TEXT PRIMARY KEY,
        sampled_at TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS resource_samples_sampled_at_idx ON resource_samples (sampled_at);
      CREATE TABLE IF NOT EXISTS usage_ledger (
        usage_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('model', 'tool')),
        run_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_ledger_run_started_idx ON usage_ledger (run_id, started_at);
      CREATE TABLE IF NOT EXISTS audit_events (
        event_id TEXT PRIMARY KEY,
        append_sequence INTEGER NOT NULL UNIQUE,
        at TEXT NOT NULL,
        content_fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_events_sequence_idx ON audit_events (append_sequence);
      CREATE TABLE IF NOT EXISTS usage_rollups (
        rollup_id TEXT PRIMARY KEY,
        period_start TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS usage_rollups_period_start_idx ON usage_rollups (period_start);
    `);
  }

  async appendBatch(batch: ObservabilityBatch): Promise<ObservabilityBatchResult> {
    this.ensureOpen();
    const resources = (batch.resourceSamples ?? []).map((value) => ResourceSampleSchema.parse(value));
    const models = (batch.modelUsages ?? []).map((value) => ModelUsageRecordSchema.parse(value));
    const tools = (batch.toolUsages ?? []).map((value) => ToolUsageRecordSchema.parse(value));
    const auditDrafts = (batch.auditEvents ?? []).map((value) => validateAuditDraft(value));
    if (resources.length + models.length + tools.length + auditDrafts.length === 0) return freezeBatchResult({ resourceSamples: [], modelUsages: [], toolUsages: [], auditEvents: [] });

    return this.transaction(() => {
      const currentAudits = this.readAuditRows().map((row) => parseAuditRow(row));
      if (!verifyAuditChain(currentAudits)) throw new ObservabilityLedgerError('OBSERVABILITY_AUDIT_CHAIN', 'Stored audit chain failed verification.');
      const resourceResult: ResourceSample[] = [];
      const modelResult: ModelUsageRecord[] = [];
      const toolResult: ToolUsageRecord[] = [];
      const auditResult: AuditEvent[] = [];
      const plannedResources = new Map<string, StoredResource>();
      const plannedModels = new Map<string, StoredModel>();
      const plannedTools = new Map<string, StoredTool>();
      const plannedAudits = new Map<string, StoredAudit>();
      let nextAuditSequence = (currentAudits.at(-1)?.appendSequence ?? 0) + 1;
      let previousAuditHash = currentAudits.at(-1)?.eventHash ?? null;

      for (const value of resources) {
        const fingerprint = fingerprintResourceSample(value);
        const existing = plannedResources.get(value.sampleId) ?? this.findResource(value.sampleId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new ObservabilityLedgerConflictError(value.sampleId);
          resourceResult.push(existing.value);
          continue;
        }
        plannedResources.set(value.sampleId, { value, fingerprint });
        resourceResult.push(value);
      }
      for (const value of models) {
        const fingerprint = fingerprintUsageRecord(value);
        const existing = plannedModels.get(value.usageId) ?? this.findModel(value.usageId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new ObservabilityLedgerConflictError(value.usageId);
          modelResult.push(existing.value);
          continue;
        }
        plannedModels.set(value.usageId, { value, fingerprint });
        modelResult.push(value);
      }
      for (const value of tools) {
        const fingerprint = fingerprintToolUsageRecord(value);
        const existing = plannedTools.get(value.usageId) ?? this.findTool(value.usageId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new ObservabilityLedgerConflictError(value.usageId);
          toolResult.push(existing.value);
          continue;
        }
        plannedTools.set(value.usageId, { value, fingerprint });
        toolResult.push(value);
      }
      for (const draft of auditDrafts) {
        const candidate = sealAuditEvent(draft, nextAuditSequence, previousAuditHash);
        const contentFingerprint = fingerprintAuditContent(candidate);
        const existing = plannedAudits.get(draft.eventId) ?? this.findAudit(draft.eventId);
        if (existing) {
          if (existing.contentFingerprint !== contentFingerprint) throw new ObservabilityLedgerConflictError(draft.eventId);
          auditResult.push(existing.value);
          continue;
        }
        plannedAudits.set(draft.eventId, { value: candidate, contentFingerprint });
        auditResult.push(candidate);
        nextAuditSequence += 1;
        previousAuditHash = candidate.eventHash;
      }

      for (const { value, fingerprint } of plannedResources.values()) this.insertResource(value, fingerprint);
      for (const { value, fingerprint } of plannedModels.values()) this.insertUsage(value, 'model', fingerprint);
      for (const { value, fingerprint } of plannedTools.values()) this.insertUsage(value, 'tool', fingerprint);
      for (const { value, contentFingerprint } of plannedAudits.values()) this.insertAudit(value, contentFingerprint);
      return freezeBatchResult({ resourceSamples: resourceResult, modelUsages: modelResult, toolUsages: toolResult, auditEvents: auditResult });
    });
  }

  async listResourceSamples(): Promise<readonly ResourceSample[]> {
    this.ensureOpen();
    const rows = this.database.prepare('SELECT sample_id, fingerprint, payload_json FROM resource_samples ORDER BY sampled_at ASC, sample_id ASC').all() as unknown as ResourceRow[];
    return Object.freeze(rows.map((row) => ResourceSampleSchema.parse(parseJson(row.payload_json, 'resource sample'))));
  }

  async listModelUsage(): Promise<readonly ModelUsageRecord[]> {
    this.ensureOpen();
    const rows = this.database.prepare("SELECT usage_id, kind, fingerprint, payload_json FROM usage_ledger WHERE kind = 'model' ORDER BY started_at ASC, usage_id ASC").all() as unknown as UsageRow[];
    return Object.freeze(rows.map((row) => ModelUsageRecordSchema.parse(parseJson(row.payload_json, 'model usage'))));
  }

  async listToolUsage(): Promise<readonly ToolUsageRecord[]> {
    this.ensureOpen();
    const rows = this.database.prepare("SELECT usage_id, kind, fingerprint, payload_json FROM usage_ledger WHERE kind = 'tool' ORDER BY started_at ASC, usage_id ASC").all() as unknown as UsageRow[];
    return Object.freeze(rows.map((row) => ToolUsageRecordSchema.parse(parseJson(row.payload_json, 'tool usage'))));
  }

  async listAuditEvents(): Promise<readonly AuditEvent[]> {
    this.ensureOpen();
    return Object.freeze(this.readAuditRows().map((row) => parseAuditRow(row)));
  }

  async listRollups(): Promise<readonly UsageRollup[]> {
    this.ensureOpen();
    const rows = this.database.prepare('SELECT rollup_id, fingerprint, payload_json FROM usage_rollups ORDER BY period_start ASC, rollup_id ASC').all() as unknown as RollupRow[];
    return Object.freeze(rows.map((row) => UsageRollupSchema.parse(parseJson(row.payload_json, 'usage rollup'))));
  }

  async rebuildRollups(): Promise<readonly UsageRollup[]> {
    this.ensureOpen();
    const values = buildUsageRollups(await this.listModelUsage(), await this.listResourceSamples(), await this.listAuditEvents());
    await this.replaceRollups(values);
    return values;
  }

  async cleanup(cutoffs: ObservabilityCleanupCutoffs): Promise<ObservabilityCleanupResult> {
    this.ensureOpen();
    const samplesBefore = validateCutoff(cutoffs.samplesBefore);
    const rollupsBefore = validateCutoff(cutoffs.rollupsBefore);
    return this.transaction(() => {
      let resourceSamples = 0;
      let rollups = 0;
      if (samplesBefore) resourceSamples = Number(this.database.prepare('DELETE FROM resource_samples WHERE sampled_at < ?').run(new Date(samplesBefore).toISOString()).changes);
      if (rollupsBefore) rollups = Number(this.database.prepare('DELETE FROM usage_rollups WHERE period_start < ?').run(new Date(rollupsBefore).toISOString()).changes);
      return { resourceSamples, rollups };
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private async replaceRollups(values: readonly UsageRollup[]): Promise<void> {
    this.ensureOpen();
    const parsed = values.map((value) => UsageRollupSchema.parse(value));
    const byId = new Map<string, UsageRollup>();
    for (const value of parsed) {
      const existing = byId.get(value.rollupId);
      if (existing && fingerprintRollup(existing) !== fingerprintRollup(value)) throw new ObservabilityLedgerConflictError(value.rollupId);
      byId.set(value.rollupId, value);
    }
    this.transaction(() => {
      this.database.exec('DELETE FROM usage_rollups');
      for (const value of byId.values()) this.insertRollup(value, fingerprintRollup(value));
    });
  }

  private findResource(sampleId: string): StoredResource | undefined {
    const row = this.database.prepare('SELECT sample_id, fingerprint, payload_json FROM resource_samples WHERE sample_id = ?').get(sampleId) as unknown as ResourceRow | undefined;
    if (!row) return undefined;
    return { value: ResourceSampleSchema.parse(parseJson(row.payload_json, 'resource sample')), fingerprint: row.fingerprint };
  }

  private findModel(usageId: string): StoredModel | undefined {
    const row = this.database.prepare("SELECT usage_id, kind, fingerprint, payload_json FROM usage_ledger WHERE usage_id = ? AND kind = 'model'").get(usageId) as unknown as UsageRow | undefined;
    if (!row) return undefined;
    return { value: ModelUsageRecordSchema.parse(parseJson(row.payload_json, 'model usage')), fingerprint: row.fingerprint };
  }

  private findTool(usageId: string): StoredTool | undefined {
    const row = this.database.prepare("SELECT usage_id, kind, fingerprint, payload_json FROM usage_ledger WHERE usage_id = ? AND kind = 'tool'").get(usageId) as unknown as UsageRow | undefined;
    if (!row) return undefined;
    return { value: ToolUsageRecordSchema.parse(parseJson(row.payload_json, 'tool usage')), fingerprint: row.fingerprint };
  }

  private findAudit(eventId: string): StoredAudit | undefined {
    const row = this.database.prepare('SELECT event_id, append_sequence, content_fingerprint, payload_json FROM audit_events WHERE event_id = ?').get(eventId) as unknown as AuditRow | undefined;
    if (!row) return undefined;
    const value = parseAuditRow(row);
    return { value, contentFingerprint: row.content_fingerprint };
  }

  private readAuditRows(): AuditRow[] {
    return this.database.prepare('SELECT event_id, append_sequence, content_fingerprint, payload_json FROM audit_events ORDER BY append_sequence ASC').all() as unknown as AuditRow[];
  }

  private insertResource(value: ResourceSample, fingerprint: string): void {
    this.database.prepare('INSERT INTO resource_samples (sample_id, sampled_at, fingerprint, payload_json) VALUES (?, ?, ?, ?)').run(value.sampleId, value.sampledAt, fingerprint, encodeJson(value));
  }

  private insertUsage(value: ModelUsageRecord | ToolUsageRecord, kind: 'model' | 'tool', fingerprint: string): void {
    this.database.prepare('INSERT INTO usage_ledger (usage_id, kind, run_id, started_at, fingerprint, payload_json) VALUES (?, ?, ?, ?, ?, ?)').run(value.usageId, kind, value.runId, value.startedAt, fingerprint, encodeJson(value));
  }

  private insertAudit(value: AuditEvent, contentFingerprint: string): void {
    this.database.prepare('INSERT INTO audit_events (event_id, append_sequence, at, content_fingerprint, payload_json) VALUES (?, ?, ?, ?, ?)').run(value.eventId, value.appendSequence, value.at, contentFingerprint, encodeJson(value));
  }

  private insertRollup(value: UsageRollup, fingerprint: string): void {
    this.database.prepare('INSERT INTO usage_rollups (rollup_id, period_start, fingerprint, payload_json) VALUES (?, ?, ?, ?)').run(value.rollupId, value.periodStart, fingerprint, encodeJson(value));
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new ObservabilityLedgerError('OBSERVABILITY_LEDGER_CLOSED', 'Observability ledger is closed.');
  }
}

function validateAuditDraft(value: AuditEventDraft): AuditEventDraft {
  // Build a throwaway sealed event so all Zod bounds/privacy rules run before
  // any transaction mutates state. Sequence/hash fields are replaced later.
  const checked = sealAuditEvent(value, 1, null);
  const { appendSequence: _appendSequence, previousHash: _previousHash, eventHash: _eventHash, ...draft } = checked;
  return draft;
}

function freezeBatchResult(value: ObservabilityBatchResult): ObservabilityBatchResult {
  return Object.freeze({
    resourceSamples: Object.freeze([...value.resourceSamples]),
    modelUsages: Object.freeze([...value.modelUsages]),
    toolUsages: Object.freeze([...value.toolUsages]),
    auditEvents: Object.freeze([...value.auditEvents]),
  });
}

function fingerprintRollup(value: UsageRollup): string {
  return canonicalObservabilityJson(value);
}

function validateCutoff(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new ObservabilityLedgerError('OBSERVABILITY_LEDGER_STORAGE', 'Cleanup cutoff must be an ISO timestamp.');
  return parsed;
}

function encodeJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new ObservabilityLedgerError('OBSERVABILITY_LEDGER_STORAGE', 'Observability value must be JSON serializable.');
  return encoded;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new ObservabilityLedgerError('OBSERVABILITY_LEDGER_STORAGE', `Stored ${label} is not valid JSON.`, { cause: error });
  }
}

function parseAuditRow(row: AuditRow): AuditEvent {
  try {
    return AuditEventSchema.parse(parseJson(row.payload_json, 'audit event'));
  } catch (error) {
    throw new ObservabilityLedgerError('OBSERVABILITY_LEDGER_STORAGE', 'Stored audit event failed contract validation.', { cause: error });
  }
}
