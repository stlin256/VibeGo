import type { CertificateStatus, TlsCredentials } from './index.js';

export type CertificateRotationStatus = 'ready' | 'degraded' | 'blocked';
export type CertificateRotationOperation = 'idle' | 'rotate' | 'rollback';
export type CertificateRotationProbePhase = 'candidate' | 'active' | 'rollback';
export type CertificateRotationErrorCode =
  | 'CERTIFICATE_ROTATION_CANDIDATE_INVALID'
  | 'CERTIFICATE_ROTATION_STALE_REVISION'
  | 'CERTIFICATE_ROTATION_PREPARE_FAILED'
  | 'CERTIFICATE_ROTATION_PROBE_FAILED'
  | 'CERTIFICATE_ROTATION_SWITCH_FAILED'
  | 'CERTIFICATE_ROTATION_POST_PROBE_FAILED'
  | 'CERTIFICATE_ROTATION_ROLLBACK_FAILED'
  | 'CERTIFICATE_ROTATION_NO_PREVIOUS'
  | 'CERTIFICATE_ROTATION_ABORTED'
  | 'CERTIFICATE_ROTATION_CLEANUP_FAILED';

export interface CertificateRotationCandidate {
  readonly revision: string;
  /** Material is passed to the adapter and is never retained in the projection. */
  readonly credentials: TlsCredentials;
  readonly status: CertificateStatus;
}

export interface CertificateRotationAdapter {
  /** Copy/prepare candidate material into an adapter-owned immutable location. */
  prepare(candidate: CertificateRotationCandidate, signal: AbortSignal): Promise<void>;
  /** Probe the candidate, active or rollback target without returning raw details. */
  probe(revision: string, phase: CertificateRotationProbePhase, signal: AbortSignal): Promise<void>;
  /** Atomically switch the serving material to an opaque revision. */
  switchTo(revision: string, signal: AbortSignal): Promise<void>;
  /** Remove an adapter-owned candidate that was not activated. */
  discard(revision: string, signal: AbortSignal): Promise<void>;
}

export interface CertificateRotationProjection {
  readonly schemaVersion: 'ready4vibe_certificate_rotation_v1';
  readonly status: CertificateRotationStatus;
  readonly operation: CertificateRotationOperation;
  readonly currentRevision: string | null;
  readonly previousRevision: string | null;
  readonly candidateRevision: string | null;
  readonly lastErrorCode: CertificateRotationErrorCode | null;
  readonly updatedAt: string;
}

export interface CertificateRotationControllerOptions {
  readonly currentRevision?: string | null;
  readonly previousRevision?: string | null;
  readonly now?: () => string;
}

export interface CertificateRotationRequestOptions {
  readonly expectedCurrentRevision?: string | null;
  readonly signal?: AbortSignal;
}

/**
 * Serializes certificate material transitions without owning a listener,
 * filesystem, ACME client or daemon transport. The adapter is the only place
 * where private material can exist; all returned state is safe to serialize.
 */
export class CertificateRotationController {
  private currentRevision: string | null;
  private previousRevision: string | null;
  private candidateRevision: string | null = null;
  private status: CertificateRotationStatus = 'ready';
  private operation: CertificateRotationOperation = 'idle';
  private lastErrorCode: CertificateRotationErrorCode | null = null;
  private updatedAt: string;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;

  constructor(private readonly adapter: CertificateRotationAdapter, options: CertificateRotationControllerOptions = {}) {
    if (!isSafeRevision(options.currentRevision) || !isSafeRevision(options.previousRevision)) {
      throw new Error('certificate rotation revision is invalid');
    }
    this.currentRevision = options.currentRevision ?? null;
    this.previousRevision = options.previousRevision ?? null;
    this.now = options.now ?? (() => new Date().toISOString());
    this.updatedAt = this.readNow();
  }

  getProjection(): CertificateRotationProjection {
    return this.projection();
  }

  rotate(candidate: CertificateRotationCandidate, options: CertificateRotationRequestOptions = {}): Promise<CertificateRotationProjection> {
    return this.enqueue(() => this.rotateInternal(candidate, options));
  }

  rollback(options: CertificateRotationRequestOptions = {}): Promise<CertificateRotationProjection> {
    return this.enqueue(() => this.rollbackInternal(options));
  }

  private async rotateInternal(candidate: CertificateRotationCandidate, options: CertificateRotationRequestOptions): Promise<CertificateRotationProjection> {
    if (!isSafeRevision(candidate?.revision)) return this.fail('CERTIFICATE_ROTATION_CANDIDATE_INVALID');
    if (!this.matchesExpected(options.expectedCurrentRevision)) return this.fail('CERTIFICATE_ROTATION_STALE_REVISION');
    if (candidate.revision === this.currentRevision) {
      this.status = 'ready';
      this.lastErrorCode = null;
      this.touch();
      return this.projection();
    }

    const revision = candidate.revision;
    const oldCurrent = this.currentRevision;
    const oldPrevious = this.previousRevision;
    this.operation = 'rotate';
    this.candidateRevision = revision;
    this.lastErrorCode = null;
    this.touch();
    let phase: 'prepare' | 'candidate-probe' | 'switch' = 'prepare';
    try {
      this.throwIfAborted(options.signal);
      await this.adapter.prepare(candidate, options.signal ?? new AbortController().signal);
      phase = 'candidate-probe';
      this.throwIfAborted(options.signal);
      await this.adapter.probe(revision, 'candidate', options.signal ?? new AbortController().signal);
      phase = 'switch';
      this.throwIfAborted(options.signal);
      await this.adapter.switchTo(revision, options.signal ?? new AbortController().signal);
      this.currentRevision = revision;
      this.previousRevision = oldCurrent;
      try {
        this.throwIfAborted(options.signal);
        await this.adapter.probe(revision, 'active', options.signal ?? new AbortController().signal);
      } catch (error) {
        const postProbeCode = isAborted(error, options.signal) ? 'CERTIFICATE_ROTATION_ABORTED' : 'CERTIFICATE_ROTATION_POST_PROBE_FAILED';
        let rolledBack = false;
        if (oldCurrent) {
          try {
            this.throwIfAborted(options.signal);
            await this.adapter.switchTo(oldCurrent, options.signal ?? new AbortController().signal);
            await this.adapter.probe(oldCurrent, 'rollback', options.signal ?? new AbortController().signal);
            this.currentRevision = oldCurrent;
            this.previousRevision = oldPrevious;
            rolledBack = true;
            this.status = postProbeCode === 'CERTIFICATE_ROTATION_ABORTED' ? 'blocked' : 'degraded';
            this.lastErrorCode = postProbeCode;
          } catch {
            this.status = 'blocked';
            this.lastErrorCode = 'CERTIFICATE_ROTATION_ROLLBACK_FAILED';
          }
        } else {
          this.status = 'blocked';
          this.lastErrorCode = postProbeCode;
        }
        if (rolledBack) await this.discardCandidate(revision);
        return this.finish();
      }
      this.status = 'ready';
      this.lastErrorCode = null;
      this.candidateRevision = null;
      this.operation = 'idle';
      this.touch();
      return this.projection();
    } catch (error) {
      this.status = 'blocked';
      this.lastErrorCode = isAborted(error, options.signal)
        ? 'CERTIFICATE_ROTATION_ABORTED'
        : phase === 'prepare'
          ? 'CERTIFICATE_ROTATION_PREPARE_FAILED'
          : phase === 'candidate-probe'
            ? 'CERTIFICATE_ROTATION_PROBE_FAILED'
            : 'CERTIFICATE_ROTATION_SWITCH_FAILED';
      if (phase === 'switch') {
        // An atomic adapter must not report a switch failure as detached
        // material: the outcome may be unknown, so retain the revision for
        // explicit recovery instead of deleting a possibly active keypair.
        this.candidateRevision = revision;
        this.operation = 'idle';
        this.touch();
        return this.projection();
      }
      await this.discardCandidate(revision);
      return this.finish();
    }
  }

  private async rollbackInternal(options: CertificateRotationRequestOptions): Promise<CertificateRotationProjection> {
    if (!this.matchesExpected(options.expectedCurrentRevision)) return this.fail('CERTIFICATE_ROTATION_STALE_REVISION');
    const target = this.previousRevision;
    if (!target) return this.fail('CERTIFICATE_ROTATION_NO_PREVIOUS');
    const oldCurrent = this.currentRevision;
    this.operation = 'rollback';
    this.lastErrorCode = null;
    this.touch();
    try {
      this.throwIfAborted(options.signal);
      await this.adapter.switchTo(target, options.signal ?? new AbortController().signal);
      await this.adapter.probe(target, 'rollback', options.signal ?? new AbortController().signal);
      this.currentRevision = target;
      this.previousRevision = oldCurrent;
      this.status = 'ready';
      this.lastErrorCode = null;
    } catch (error) {
      this.status = 'blocked';
      this.lastErrorCode = isAborted(error, options.signal) ? 'CERTIFICATE_ROTATION_ABORTED' : 'CERTIFICATE_ROTATION_ROLLBACK_FAILED';
    }
    return this.finish();
  }

  private async discardCandidate(revision: string): Promise<void> {
    try {
      await this.adapter.discard(revision, new AbortController().signal);
      this.candidateRevision = null;
    } catch {
      this.status = 'blocked';
      this.lastErrorCode = 'CERTIFICATE_ROTATION_CLEANUP_FAILED';
      this.candidateRevision = revision;
    }
  }

  private finish(): CertificateRotationProjection {
    this.operation = 'idle';
    this.candidateRevision = null;
    this.touch();
    return this.projection();
  }

  private fail(code: CertificateRotationErrorCode): CertificateRotationProjection {
    this.status = 'blocked';
    this.operation = 'idle';
    this.candidateRevision = null;
    this.lastErrorCode = code;
    this.touch();
    return this.projection();
  }

  private matchesExpected(expected: string | null | undefined): boolean {
    return expected === undefined || expected === this.currentRevision;
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  }

  private readNow(): string {
    const value = this.now();
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : new Date(0).toISOString();
  }

  private touch(): void {
    this.updatedAt = this.readNow();
  }

  private projection(): CertificateRotationProjection {
    return Object.freeze({
      schemaVersion: 'ready4vibe_certificate_rotation_v1',
      status: this.status,
      operation: this.operation,
      currentRevision: this.currentRevision,
      previousRevision: this.previousRevision,
      candidateRevision: this.candidateRevision,
      lastErrorCode: this.lastErrorCode,
      updatedAt: this.updatedAt,
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

function isSafeRevision(value: string | null | undefined): boolean {
  return value === null || value === undefined || (
    typeof value === 'string'
    && value.length > 0
    && value.length <= 64
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    && !/(?:api[_-]?key|token|secret|password|private|credential|sk-)/iu.test(value)
  );
}

function isAborted(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');
}
