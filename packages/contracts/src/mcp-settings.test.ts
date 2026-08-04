import { describe, expect, it } from 'vitest';
import {
  McpSettingsSchema,
  McpSettingsStatusSchema,
  McpSettingsProbeResultSchema,
  MCP_SETTINGS_SCHEMA_VERSION,
  MCP_SETTINGS_STATUS_SCHEMA_VERSION,
} from './mcp-settings.js';

const validSettings = {
  schemaVersion: MCP_SETTINGS_SCHEMA_VERSION,
  enabled: false,
  serverId: 'local-mcp',
  serverVersion: '1.0.0',
  transport: 'stdio' as const,
  endpointLabel: 'Local MCP server',
  manifestRevision: 'manifest-20260804',
  capabilityAllowlist: ['local-mcp/tool/read_file@1.0.0'],
};

describe('MCP settings contracts', () => {
  it('accepts a bounded non-secret snapshot and strict status projection', () => {
    expect(McpSettingsSchema.parse(validSettings)).toEqual(validSettings);
    const status = McpSettingsStatusSchema.parse({
      schemaVersion: MCP_SETTINGS_STATUS_SCHEMA_VERSION,
      settings: validSettings,
      status: 'disabled',
      health: null,
      available: false,
      degraded: false,
      currentRevision: null,
      previousRevision: null,
      capabilityCount: 0,
      lastHealthAt: null,
      lastErrorCode: 'disabled',
      nextAction: 'enable',
    });
    expect(status.settings.serverId).toBe('local-mcp');
  });

  it('rejects unknown fields, secret-shaped values, URLs and absolute paths', () => {
    expect(() => McpSettingsSchema.parse({ ...validSettings, unexpected: true })).toThrow();
    expect(() => McpSettingsSchema.parse({ ...validSettings, endpointLabel: 'https://mcp.example.test' })).toThrow();
    expect(() => McpSettingsSchema.parse({ ...validSettings, endpointLabel: 'C:\\Users\\secret\\server.exe' })).toThrow();
    expect(() => McpSettingsSchema.parse({ ...validSettings, serverId: 'apiKey=do-not-store' })).toThrow();
    expect(() => McpSettingsSchema.parse({ ...validSettings, capabilityAllowlist: ['token=secret'] })).toThrow();
  });

  it('rejects command, argv, environment-shaped and unbounded capability fields', () => {
    expect(() => McpSettingsSchema.parse({ ...validSettings, command: 'node server.js' })).toThrow();
    expect(() => McpSettingsSchema.parse({ ...validSettings, env: ['HOME'] })).toThrow();
    expect(() => McpSettingsSchema.parse({ ...validSettings, capabilityAllowlist: Array.from({ length: 129 }, () => 'local-mcp/tool/read_file@1.0.0') })).toThrow();
    expect(() => McpSettingsSchema.parse({ ...validSettings, capabilityAllowlist: ['local-mcp/tool/not valid@1.0.0'] })).toThrow();
  });

  it('validates bounded probe results without retaining raw protocol data', () => {
    const result = McpSettingsProbeResultSchema.parse({
      schemaVersion: 'ready4vibe_mcp_probe_result_v0',
      serverId: 'local-mcp',
      manifestRevision: 'manifest-20260804',
      health: 'healthy-verified',
      currentRevision: 'cap-20260804',
      previousRevision: null,
      capabilityCount: 1,
    });
    expect(result.capabilityCount).toBe(1);
    expect(() => McpSettingsProbeResultSchema.parse({ ...result, rawResponse: { token: 'secret' } })).toThrow();
  });
});
