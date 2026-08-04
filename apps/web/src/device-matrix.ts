/**
 * Pure, privacy-safe fixture and compatibility report contracts for Spec 56c.
 *
 * These values describe layout/input test fixtures only. They are deliberately
 * not a browser/device detector and never imply that a physical device passed.
 */

export const WEB_DEVICE_FIXTURE_SCHEMA_VERSION = 'vibego_web_device_fixture_v1' as const;
export const WEB_COMPATIBILITY_REPORT_SCHEMA_VERSION = 'vibego_web_compatibility_report_v1' as const;

export type WebDeviceFixtureId =
  | 'desktop-wide'
  | 'desktop-portrait'
  | 'phone'
  | 'fold-cover'
  | 'fold-unfolded'
  | 'fold-wide'
  | 'tri-fold'
  | 'tablet';

export type WebOrientation = 'portrait' | 'landscape';
export type WebInputMode = 'mouse-keyboard' | 'touch';
export type WebFoldProfile = 'none' | 'cover' | 'hinge-two-segment' | 'wide-fold' | 'three-segment';
export type WebReportResult = 'unverified' | 'pass' | 'pass-with-known-issue' | 'degraded' | 'blocked';
export type WebCheckResult = WebReportResult;

export interface WebDeviceFixture {
  readonly schemaVersion: typeof WEB_DEVICE_FIXTURE_SCHEMA_VERSION;
  readonly id: WebDeviceFixtureId;
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly orientation: WebOrientation;
  readonly inputMode: WebInputMode;
  readonly segmentCount: 1 | 2 | 3;
  readonly foldProfile: WebFoldProfile;
}

export interface WebCompatibilityChecks {
  readonly viewport: WebCheckResult;
  readonly orientation: WebCheckResult;
  readonly input: WebCheckResult;
  readonly safeArea: WebCheckResult;
}

export type WebCompatibilityIssueCode =
  | 'viewport-overflow'
  | 'orientation-mismatch'
  | 'primary-action-unreachable'
  | 'safe-area-unknown'
  | 'fold-unsupported'
  | 'manual-evidence-required';

export interface WebCompatibilityReport {
  readonly schemaVersion: typeof WEB_COMPATIBILITY_REPORT_SCHEMA_VERSION;
  readonly fixture: WebDeviceFixture;
  readonly result: WebReportResult;
  readonly checks: WebCompatibilityChecks;
  readonly issueCodes: readonly WebCompatibilityIssueCode[];
  readonly evidenceRefs: readonly string[];
  readonly capturedAt: string;
  readonly buildRevision: string | null;
}

export const WEB_DEVICE_FIXTURES: readonly WebDeviceFixture[] = Object.freeze([
  fixture('desktop-wide', 1440, 900, '16:10', 'landscape', 'mouse-keyboard', 1, 'none'),
  fixture('desktop-portrait', 900, 1440, '5:8', 'portrait', 'mouse-keyboard', 1, 'none'),
  fixture('phone', 390, 844, '9:19.5', 'portrait', 'touch', 1, 'none'),
  fixture('fold-cover', 360, 800, '9:20', 'portrait', 'touch', 1, 'cover'),
  fixture('fold-unfolded', 673, 841, '4:5', 'portrait', 'touch', 2, 'hinge-two-segment'),
  fixture('fold-wide', 884, 2208, '2:5', 'portrait', 'touch', 2, 'wide-fold'),
  fixture('tri-fold', 768, 2048, '3:8', 'portrait', 'touch', 3, 'three-segment'),
  fixture('tablet', 1024, 1366, '3:4', 'portrait', 'touch', 1, 'none'),
]);

const FIXTURE_KEYS = ['schemaVersion', 'id', 'width', 'height', 'aspectRatio', 'orientation', 'inputMode', 'segmentCount', 'foldProfile'] as const;
const CHECK_KEYS = ['viewport', 'orientation', 'input', 'safeArea'] as const;
const REPORT_KEYS = ['schemaVersion', 'fixture', 'result', 'checks', 'issueCodes', 'evidenceRefs', 'capturedAt', 'buildRevision'] as const;
const RESULT_VALUES: readonly WebReportResult[] = ['unverified', 'pass', 'pass-with-known-issue', 'degraded', 'blocked'];
const ISSUE_CODES: readonly WebCompatibilityIssueCode[] = ['viewport-overflow', 'orientation-mismatch', 'primary-action-unreachable', 'safe-area-unknown', 'fold-unsupported', 'manual-evidence-required'];
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const ASPECT_RATIO_PATTERN = /^\d{1,3}:\d{1,4}(?:\.\d{1,2})?$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const SECRET_VALUE_PATTERN = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^/]|$))/u;
const CONTROL_PATTERN = /^[^\u0000-\u001F\u007F\r\n]*$/u;

export function getWebDeviceFixture(id: WebDeviceFixtureId): WebDeviceFixture {
  const value = WEB_DEVICE_FIXTURES.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`unknown Web device fixture: ${id}`);
  return cloneFixture(value);
}

export function parseWebDeviceFixture(input: unknown): WebDeviceFixture {
  if (!isRecord(input)) throw new TypeError('Web device fixture must be an object');
  assertExactKeys(input, FIXTURE_KEYS, 'fixture');
  if (input.schemaVersion !== WEB_DEVICE_FIXTURE_SCHEMA_VERSION) throw new TypeError('unsupported Web device fixture schema');
  assertFixtureId(input.id);
  assertInteger(input.width, 320, 4096, 'fixture.width');
  assertInteger(input.height, 320, 4096, 'fixture.height');
  assertSafeText(input.aspectRatio, 'fixture.aspectRatio');
  if (!ASPECT_RATIO_PATTERN.test(input.aspectRatio)) throw new TypeError('fixture.aspectRatio is invalid');
  if (input.orientation !== 'portrait' && input.orientation !== 'landscape') throw new TypeError('fixture.orientation is invalid');
  if (input.inputMode !== 'mouse-keyboard' && input.inputMode !== 'touch') throw new TypeError('fixture.inputMode is invalid');
  if (input.segmentCount !== 1 && input.segmentCount !== 2 && input.segmentCount !== 3) throw new TypeError('fixture.segmentCount is invalid');
  if (!isFoldProfile(input.foldProfile)) throw new TypeError('fixture.foldProfile is invalid');
  if (input.foldProfile === 'none' && input.segmentCount !== 1) throw new TypeError('non-fold fixture must have one segment');
  if (input.foldProfile === 'cover' && input.segmentCount !== 1) throw new TypeError('fold cover fixture must have one segment');
  if (input.foldProfile !== 'none' && input.foldProfile !== 'cover' && input.segmentCount === 1) throw new TypeError('unfolded fold fixture must declare multiple segments');
  const canonical = WEB_DEVICE_FIXTURES.find((candidate) => candidate.id === input.id);
  if (!canonical || FIXTURE_KEYS.some((key) => input[key] !== canonical[key])) throw new TypeError('fixture metadata does not match the canonical fixture');
  return cloneFixture(input as unknown as WebDeviceFixture);
}

export function createUnverifiedCompatibilityReport(fixtureId: WebDeviceFixtureId, capturedAt = new Date().toISOString()): WebCompatibilityReport {
  const fixture = getWebDeviceFixture(fixtureId);
  assertTimestamp(capturedAt, 'capturedAt');
  return {
    schemaVersion: WEB_COMPATIBILITY_REPORT_SCHEMA_VERSION,
    fixture,
    result: 'unverified',
    checks: { viewport: 'unverified', orientation: 'unverified', input: 'unverified', safeArea: 'unverified' },
    issueCodes: [],
    evidenceRefs: [],
    capturedAt,
    buildRevision: null,
  };
}

export function parseWebCompatibilityReport(input: unknown): WebCompatibilityReport {
  if (!isRecord(input)) throw new TypeError('Web compatibility report must be an object');
  assertExactKeys(input, REPORT_KEYS, 'report');
  if (input.schemaVersion !== WEB_COMPATIBILITY_REPORT_SCHEMA_VERSION) throw new TypeError('unsupported Web compatibility report schema');
  const fixture = parseWebDeviceFixture(input.fixture);
  const result = parseResult(input.result, 'report.result');
  if (!isRecord(input.checks)) throw new TypeError('report.checks must be an object');
  assertExactKeys(input.checks, CHECK_KEYS, 'report.checks');
  const checks: WebCompatibilityChecks = {
    viewport: parseResult(input.checks.viewport, 'report.checks.viewport'),
    orientation: parseResult(input.checks.orientation, 'report.checks.orientation'),
    input: parseResult(input.checks.input, 'report.checks.input'),
    safeArea: parseResult(input.checks.safeArea, 'report.checks.safeArea'),
  };
  const issueCodes = parseIssueCodes(input.issueCodes);
  const evidenceRefs = parseReferences(input.evidenceRefs, 'report.evidenceRefs', 8);
  assertTimestamp(input.capturedAt, 'report.capturedAt');
  const buildRevision = input.buildRevision === null ? null : parseRevision(input.buildRevision, 'report.buildRevision');
  return { schemaVersion: WEB_COMPATIBILITY_REPORT_SCHEMA_VERSION, fixture, result, checks, issueCodes, evidenceRefs, capturedAt: input.capturedAt, buildRevision };
}

function fixture(id: WebDeviceFixtureId, width: number, height: number, aspectRatio: string, orientation: WebOrientation, inputMode: WebInputMode, segmentCount: 1 | 2 | 3, foldProfile: WebFoldProfile): WebDeviceFixture {
  return Object.freeze({ schemaVersion: WEB_DEVICE_FIXTURE_SCHEMA_VERSION, id, width, height, aspectRatio, orientation, inputMode, segmentCount, foldProfile });
}

function cloneFixture(value: WebDeviceFixture): WebDeviceFixture {
  return { ...value };
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

function assertInteger(value: unknown, minimum: number, maximum: number, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is out of bounds`);
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length > 32 || !ISO_TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`${label} must be an ISO timestamp`);
}

function assertFixtureId(value: unknown): asserts value is WebDeviceFixtureId {
  if (!WEB_DEVICE_FIXTURES.some((fixtureValue) => fixtureValue.id === value)) throw new TypeError('fixture.id is unknown');
}

function isFoldProfile(value: unknown): value is WebFoldProfile {
  return value === 'none' || value === 'cover' || value === 'hinge-two-segment' || value === 'wide-fold' || value === 'three-segment';
}

function parseResult(value: unknown, label: string): WebReportResult {
  if (!RESULT_VALUES.includes(value as WebReportResult)) throw new TypeError(`${label} is invalid`);
  return value as WebReportResult;
}

function parseIssueCodes(value: unknown): readonly WebCompatibilityIssueCode[] {
  if (!Array.isArray(value) || value.length > 8 || value.some((entry) => !ISSUE_CODES.includes(entry as WebCompatibilityIssueCode))) throw new TypeError('report.issueCodes is invalid');
  return [...new Set(value as WebCompatibilityIssueCode[])];
}

function parseReferences(value: unknown, label: string, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} is invalid`);
  const references = value.map((entry, index) => {
    assertSafeText(entry, `${label}[${index}]`);
    if (!REFERENCE_PATTERN.test(entry)) throw new TypeError(`${label}[${index}] is invalid`);
    return entry;
  });
  return [...new Set(references)];
}

function parseRevision(value: unknown, label: string): string {
  assertSafeText(value, label);
  if (!REVISION_PATTERN.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
