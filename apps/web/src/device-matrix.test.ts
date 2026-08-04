import { describe, expect, it } from 'vitest';
import {
  WEB_COMPATIBILITY_REPORT_SCHEMA_VERSION,
  WEB_DEVICE_FIXTURE_SCHEMA_VERSION,
  WEB_DEVICE_FIXTURES,
  createUnverifiedCompatibilityReport,
  getWebDeviceFixture,
  parseWebCompatibilityReport,
  parseWebDeviceFixture,
} from './device-matrix.js';

describe('Spec 56c Web device matrix contract', () => {
  it('keeps all eight ratio-oriented fixtures stable and bounded', () => {
    expect(WEB_DEVICE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      'desktop-wide', 'desktop-portrait', 'phone', 'fold-cover',
      'fold-unfolded', 'fold-wide', 'tri-fold', 'tablet',
    ]);
    for (const fixture of WEB_DEVICE_FIXTURES) {
      expect(parseWebDeviceFixture(fixture)).toEqual(fixture);
      expect(fixture.width).toBeGreaterThanOrEqual(320);
      expect(fixture.height).toBeLessThanOrEqual(4096);
    }
    expect(getWebDeviceFixture('phone')).toMatchObject({ inputMode: 'touch', foldProfile: 'none' });
    expect(getWebDeviceFixture('tri-fold')).toMatchObject({ segmentCount: 3, foldProfile: 'three-segment' });
  });

  it('creates an unverified report without pretending to have device evidence', () => {
    const report = createUnverifiedCompatibilityReport('fold-unfolded', '2026-08-05T00:00:00.000Z');
    expect(report).toMatchObject({ schemaVersion: WEB_COMPATIBILITY_REPORT_SCHEMA_VERSION, result: 'unverified', buildRevision: null, issueCodes: [], evidenceRefs: [] });
    expect(report.checks).toEqual({ viewport: 'unverified', orientation: 'unverified', input: 'unverified', safeArea: 'unverified' });
    expect(parseWebCompatibilityReport(report)).toEqual(report);
  });

  it('rejects unknown fields, invalid geometry, secrets, paths and oversized evidence', () => {
    const fixture = getWebDeviceFixture('desktop-wide');
    expect(fixture.schemaVersion).toBe(WEB_DEVICE_FIXTURE_SCHEMA_VERSION);
    expect(() => parseWebDeviceFixture({ ...fixture, userAgent: 'Chrome' })).toThrow(/unknown|missing/iu);
    expect(() => parseWebDeviceFixture({ ...fixture, width: 319 })).toThrow(/bounds/iu);
    expect(() => parseWebDeviceFixture({ ...fixture, aspectRatio: 'C:\\workspace\\fixture' })).toThrow(/unsafe|absolute/iu);
    const report = createUnverifiedCompatibilityReport('phone', '2026-08-05T00:00:00.000Z');
    expect(() => parseWebCompatibilityReport({ ...report, buildRevision: 'apiKey=sk-' + 'x'.repeat(24) })).toThrow(/unsafe|secret/iu);
    expect(() => parseWebCompatibilityReport({ ...report, evidenceRefs: Array.from({ length: 9 }, (_, index) => `ref-${index}`) })).toThrow(/invalid/iu);
    expect(() => parseWebCompatibilityReport({ ...report, checks: { ...report.checks, rawTranscript: 'hidden' } })).toThrow(/unknown|missing/iu);
  });

  it('keeps the report projection bounded and deduplicates safe evidence references', () => {
    const report = createUnverifiedCompatibilityReport('tablet', '2026-08-05T00:00:00.000Z');
    const parsed = parseWebCompatibilityReport({ ...report, evidenceRefs: ['manual-1', 'manual-1'], issueCodes: ['manual-evidence-required'] });
    expect(parsed.evidenceRefs).toEqual(['manual-1']);
    expect(parsed.issueCodes).toEqual(['manual-evidence-required']);
    expect(JSON.stringify(parsed)).not.toMatch(/api[_-]?key|secret|token|C:\\\\|\/var\//iu);
  });
});
