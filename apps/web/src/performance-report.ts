import {
  getWebDeviceFixture,
  parseWebDeviceFixture,
  type WebDeviceFixture,
  type WebDeviceFixtureId,
  type WebReportResult,
} from './device-matrix.js';

export const WEB_PERFORMANCE_REPORT_SCHEMA_VERSION = 'vibego_web_performance_report_v1' as const;

export interface WebPerformanceTimings {
  readonly firstPaintMs: number | null;
  readonly firstInteractionMs: number | null;
  readonly firstSseEventMs: number | null;
  readonly settingsOpenMs: number | null;
}

export interface WebPerformanceReport {
  readonly schemaVersion: typeof WEB_PERFORMANCE_REPORT_SCHEMA_VERSION;
  readonly fixture: WebDeviceFixture;
  readonly result: WebReportResult;
  readonly timings: WebPerformanceTimings;
  readonly sampleCount: number;
  readonly capturedAt: string;
  readonly buildRevision: string | null;
}

const REPORT_KEYS = ['schemaVersion', 'fixture', 'result', 'timings', 'sampleCount', 'capturedAt', 'buildRevision'] as const;
const TIMING_KEYS = ['firstPaintMs', 'firstInteractionMs', 'firstSseEventMs', 'settingsOpenMs'] as const;
const RESULT_VALUES: readonly WebReportResult[] = ['unverified', 'pass', 'pass-with-known-issue', 'degraded', 'blocked'];
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SECRET_VALUE_PATTERN = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^/]|$))/u;
const CONTROL_PATTERN = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

export function createUnverifiedPerformanceReport(fixtureId: WebDeviceFixtureId, capturedAt = new Date().toISOString()): WebPerformanceReport {
  const fixture = getWebDeviceFixture(fixtureId);
  assertTimestamp(capturedAt, 'capturedAt');
  return {
    schemaVersion: WEB_PERFORMANCE_REPORT_SCHEMA_VERSION,
    fixture,
    result: 'unverified',
    timings: { firstPaintMs: null, firstInteractionMs: null, firstSseEventMs: null, settingsOpenMs: null },
    sampleCount: 0,
    capturedAt,
    buildRevision: null,
  };
}

export function parseWebPerformanceReport(input: unknown): WebPerformanceReport {
  if (!isRecord(input)) throw new TypeError('Web performance report must be an object');
  assertExactKeys(input, REPORT_KEYS, 'report');
  if (input.schemaVersion !== WEB_PERFORMANCE_REPORT_SCHEMA_VERSION) throw new TypeError('unsupported Web performance report schema');
  const fixture = parseWebDeviceFixture(input.fixture);
  const result = parseResult(input.result, 'report.result');
  if (!isRecord(input.timings)) throw new TypeError('report.timings must be an object');
  assertExactKeys(input.timings, TIMING_KEYS, 'report.timings');
  const timings: WebPerformanceTimings = {
    firstPaintMs: parseTiming(input.timings.firstPaintMs, 'report.timings.firstPaintMs'),
    firstInteractionMs: parseTiming(input.timings.firstInteractionMs, 'report.timings.firstInteractionMs'),
    firstSseEventMs: parseTiming(input.timings.firstSseEventMs, 'report.timings.firstSseEventMs'),
    settingsOpenMs: parseTiming(input.timings.settingsOpenMs, 'report.timings.settingsOpenMs'),
  };
  if (typeof input.sampleCount !== 'number' || !Number.isInteger(input.sampleCount) || input.sampleCount < 0 || input.sampleCount > 32) throw new TypeError('report.sampleCount is out of bounds');
  assertTimestamp(input.capturedAt, 'report.capturedAt');
  const buildRevision = input.buildRevision === null ? null : parseRevision(input.buildRevision, 'report.buildRevision');
  return { schemaVersion: WEB_PERFORMANCE_REPORT_SCHEMA_VERSION, fixture, result, timings, sampleCount: input.sampleCount, capturedAt: input.capturedAt, buildRevision };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) throw new TypeError(`${label} contains unknown or missing fields`);
}

function assertSafeText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 256 || !CONTROL_PATTERN.test(value) || SECRET_VALUE_PATTERN.test(value) || ABSOLUTE_PATH_PATTERN.test(value)) throw new TypeError(`${label} contains unsafe text`);
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 32 || !ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp`);
}

function parseResult(value: unknown, label: string): WebReportResult {
  if (!RESULT_VALUES.includes(value as WebReportResult)) throw new TypeError(`${label} is invalid`);
  return value as WebReportResult;
}

function parseTiming(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 120_000) throw new TypeError(`${label} is out of bounds`);
  return value;
}

function parseRevision(value: unknown, label: string): string {
  assertSafeText(value, label);
  if (!REVISION_PATTERN.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
