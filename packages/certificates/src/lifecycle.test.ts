import { describe, expect, it } from 'vitest';
import type { CertificateStatus, TlsCredentials } from './index.js';
import { CertificateRotationController, type CertificateRotationAdapter, type CertificateRotationCandidate } from './lifecycle.js';

const certificateStatus: CertificateStatus = {
  subject: 'CN=dev.example.test',
  issuer: 'CN=Test CA',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2030-01-01T00:00:00.000Z',
  daysRemaining: 1_000,
  fingerprint256: 'AA:BB:CC',
  subjectAltNames: ['dev.example.test'],
};

function candidate(revision: string): CertificateRotationCandidate {
  const credentials: TlsCredentials = { cert: Buffer.from('CERTIFICATE'), key: Buffer.from('PRIVATE KEY') };
  return { revision, credentials, status: certificateStatus };
}

function adapterFixture() {
  const calls: string[] = [];
  const prepareFailures = new Set<string>();
  const probeFailures = new Set<string>();
  const switchFailures = new Set<string>();
  const adapter: CertificateRotationAdapter = {
    async prepare(input) {
      calls.push(`prepare:${input.revision}`);
      if (prepareFailures.has(input.revision)) throw new Error('private adapter details');
    },
    async probe(revision, phase) {
      calls.push(`probe:${phase}:${revision}`);
      if (probeFailures.has(`${phase}:${revision}`)) throw new Error('C:\\private\\certificate');
    },
    async switchTo(revision) {
      calls.push(`switch:${revision}`);
      if (switchFailures.has(revision)) throw new Error('secret switch detail');
    },
    async discard(revision) {
      calls.push(`discard:${revision}`);
    },
  };
  return { adapter, calls, prepareFailures, probeFailures, switchFailures };
}

describe('CertificateRotationController', () => {
  it('rotates candidate to current and retains the old current as previous', async () => {
    const fixture = adapterFixture();
    const controller = new CertificateRotationController(fixture.adapter, {
      currentRevision: 'r1',
      previousRevision: 'r0',
      now: () => '2026-08-05T00:00:00.000Z',
    });

    const projection = await controller.rotate(candidate('r2'), { expectedCurrentRevision: 'r1' });

    expect(projection).toMatchObject({
      schemaVersion: 'ready4vibe_certificate_rotation_v1',
      status: 'ready',
      operation: 'idle',
      currentRevision: 'r2',
      previousRevision: 'r1',
      candidateRevision: null,
      lastErrorCode: null,
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(fixture.calls).toEqual(['prepare:r2', 'probe:candidate:r2', 'switch:r2', 'probe:active:r2']);
    expect(JSON.stringify(projection)).not.toMatch(/PRIVATE KEY|C:\\private|secret/iu);
  });

  it('keeps current when candidate preparation fails and cleans the candidate', async () => {
    const fixture = adapterFixture();
    fixture.prepareFailures.add('r2');
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r1', previousRevision: 'r0' });

    const projection = await controller.rotate(candidate('r2'));

    expect(projection).toMatchObject({ status: 'blocked', currentRevision: 'r1', previousRevision: 'r0', candidateRevision: null, lastErrorCode: 'CERTIFICATE_ROTATION_PREPARE_FAILED' });
    expect(fixture.calls).toEqual(['prepare:r2', 'discard:r2']);
  });

  it('rolls back after a post-switch health failure and preserves the old pair', async () => {
    const fixture = adapterFixture();
    fixture.probeFailures.add('active:r2');
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r1', previousRevision: 'r0' });

    const projection = await controller.rotate(candidate('r2'));

    expect(projection).toMatchObject({ status: 'degraded', currentRevision: 'r1', previousRevision: 'r0', candidateRevision: null, lastErrorCode: 'CERTIFICATE_ROTATION_POST_PROBE_FAILED' });
    expect(fixture.calls).toEqual(['prepare:r2', 'probe:candidate:r2', 'switch:r2', 'probe:active:r2', 'switch:r1', 'probe:rollback:r1', 'discard:r2']);
  });

  it('fails closed when rollback cannot be proven healthy', async () => {
    const fixture = adapterFixture();
    fixture.probeFailures.add('active:r2');
    fixture.switchFailures.add('r1');
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r1', previousRevision: 'r0' });

    const projection = await controller.rotate(candidate('r2'));

    expect(projection).toMatchObject({ status: 'blocked', currentRevision: 'r2', previousRevision: 'r1', candidateRevision: null, lastErrorCode: 'CERTIFICATE_ROTATION_ROLLBACK_FAILED' });
    expect(fixture.calls).toEqual(['prepare:r2', 'probe:candidate:r2', 'switch:r2', 'probe:active:r2', 'switch:r1']);
  });

  it('retains an opaque candidate when the atomic switch outcome is not proven', async () => {
    const fixture = adapterFixture();
    fixture.switchFailures.add('r2');
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r1' });

    const projection = await controller.rotate(candidate('r2'));

    expect(projection).toMatchObject({ status: 'blocked', currentRevision: 'r1', previousRevision: null, candidateRevision: 'r2', lastErrorCode: 'CERTIFICATE_ROTATION_SWITCH_FAILED' });
    expect(fixture.calls).toEqual(['prepare:r2', 'probe:candidate:r2', 'switch:r2']);
  });

  it('rejects stale expected-current revisions without touching the adapter', async () => {
    const fixture = adapterFixture();
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r2' });

    const projection = await controller.rotate(candidate('r3'), { expectedCurrentRevision: 'r1' });

    expect(projection).toMatchObject({ status: 'blocked', currentRevision: 'r2', candidateRevision: null, lastErrorCode: 'CERTIFICATE_ROTATION_STALE_REVISION' });
    expect(fixture.calls).toEqual([]);
  });

  it('rolls back current to previous through the same bounded probe path', async () => {
    const fixture = adapterFixture();
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r2', previousRevision: 'r1' });

    const projection = await controller.rollback({ expectedCurrentRevision: 'r2' });

    expect(projection).toMatchObject({ status: 'ready', currentRevision: 'r1', previousRevision: 'r2', candidateRevision: null, lastErrorCode: null });
    expect(fixture.calls).toEqual(['switch:r1', 'probe:rollback:r1']);
  });

  it('serializes concurrent rotations and makes the second stale instead of racing switches', async () => {
    const fixture = adapterFixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalPrepare = fixture.adapter.prepare;
    fixture.adapter.prepare = async (input) => {
      await originalPrepare(input, new AbortController().signal);
      if (input.revision === 'r2') await gate;
    };
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r1' });

    const first = controller.rotate(candidate('r2'), { expectedCurrentRevision: 'r1' });
    const second = controller.rotate(candidate('r3'), { expectedCurrentRevision: 'r1' });
    await Promise.resolve();
    expect(fixture.calls).toEqual(['prepare:r2']);
    release();

    const [firstProjection, secondProjection] = await Promise.all([first, second]);
    expect(firstProjection.status).toBe('ready');
    expect(secondProjection).toMatchObject({ status: 'blocked', currentRevision: 'r2', lastErrorCode: 'CERTIFICATE_ROTATION_STALE_REVISION' });
    expect(fixture.calls).not.toContain('prepare:r3');
  });

  it('rejects unsafe candidate revision identifiers without exposing input', async () => {
    const fixture = adapterFixture();
    const controller = new CertificateRotationController(fixture.adapter, { currentRevision: 'r1' });

    const projection = await controller.rotate(candidate('C:\\private\\sk-secret'));

    expect(projection).toMatchObject({ status: 'blocked', currentRevision: 'r1', lastErrorCode: 'CERTIFICATE_ROTATION_CANDIDATE_INVALID' });
    expect(JSON.stringify(projection)).not.toMatch(/C:\\private|sk-secret/iu);
    expect(fixture.calls).toEqual([]);
  });
});
