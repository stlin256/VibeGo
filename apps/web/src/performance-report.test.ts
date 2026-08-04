import { describe, expect, it } from 'vitest';
import {
  WEB_PERFORMANCE_REPORT_SCHEMA_VERSION,
  createUnverifiedPerformanceReport,
  parseWebPerformanceReport,
} from './performance-report.js';

describe('Spec 56c Web performance report contract', () => {
  it('defaults every physical/performance measurement to unverified', () => {
    const report = createUnverifiedPerformanceReport('desktop-wide', '2026-08-05T00:00:00.000Z');
    expect(report).toMatchObject({ schemaVersion: WEB_PERFORMANCE_REPORT_SCHEMA_VERSION, result: 'unverified', sampleCount: 0, buildRevision: null });
    expect(report.timings).toEqual({ firstPaintMs: null, firstInteractionMs: null, firstSseEventMs: null, settingsOpenMs: null });
    expect(parseWebPerformanceReport(report)).toEqual(report);
  });

  it('accepts bounded timings but rejects unknown fields, secrets, paths and out-of-range values', () => {
    const report = createUnverifiedPerformanceReport('phone', '2026-08-05T00:00:00.000Z');
    const measured = parseWebPerformanceReport({
      ...report,
      result: 'pass-with-known-issue',
      timings: { ...report.timings, firstPaintMs: 125.5, firstInteractionMs: 240, firstSseEventMs: 510, settingsOpenMs: 80 },
      sampleCount: 2,
      buildRevision: 'web-build-01',
    });
    expect(measured.timings.firstPaintMs).toBe(125.5);
    expect(() => parseWebPerformanceReport({ ...report, timings: { ...report.timings, firstPaintMs: 120_001 } })).toThrow(/bounds/iu);
    expect(() => parseWebPerformanceReport({ ...report, sampleCount: 33 })).toThrow(/bounds/iu);
    expect(() => parseWebPerformanceReport({ ...report, buildRevision: 'C:\\private\\build' })).toThrow(/unsafe|absolute/iu);
    expect(() => parseWebPerformanceReport({ ...report, timings: { ...report.timings, token: 1 } })).toThrow(/unknown|missing/iu);
  });

  it('does not serialize user content or raw error fields', () => {
    const report = createUnverifiedPerformanceReport('tri-fold', '2026-08-05T00:00:00.000Z');
    expect(JSON.stringify(report)).not.toMatch(/transcript|api[_-]?key|secret|token|C:\\\\|\/Users\//iu);
  });
});
