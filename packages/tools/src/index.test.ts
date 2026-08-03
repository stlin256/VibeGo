import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDescriptor, type ToolSandboxMode } from './index.js';

const descriptor = (overrides: Partial<ToolDescriptor> = {}): ToolDescriptor => ({
  id: 'filesystem.read',
  version: '1.0.0',
  risk: 'read',
  summary: 'Read a bounded workspace file.',
  supportedSandboxModes: ['read-only', 'workspace-write'],
  ...overrides,
});

describe('ToolRegistry', () => {
  it('registers descriptors and returns a safe public projection', () => {
    const registry = new ToolRegistry();
    registry.register(descriptor({ inputSchema: { secret: 'never-return' } }));
    expect(registry.has('filesystem.read', '1.0.0')).toBe(true);
    expect(registry.list()).toEqual([{
      id: 'filesystem.read',
      version: '1.0.0',
      risk: 'read',
      summary: 'Read a bounded workspace file.',
      supportedSandboxModes: ['read-only', 'workspace-write'],
    }]);
    expect(JSON.stringify(registry.list())).not.toContain('never-return');
  });

  it('rejects duplicate id and version registrations', () => {
    const registry = new ToolRegistry();
    registry.register(descriptor());
    expect(() => registry.register(descriptor())).toThrow('already registered');
    expect(() => registry.register(descriptor({ version: '2.0.0' }))).not.toThrow();
  });

  it('returns defensive copies', () => {
    const registry = new ToolRegistry();
    registry.register(descriptor());
    const copy = registry.get('filesystem.read', '1.0.0');
    (copy?.supportedSandboxModes as ToolSandboxMode[] | undefined)?.splice(0, 1);
    expect(registry.get('filesystem.read', '1.0.0')?.supportedSandboxModes).toEqual(['read-only', 'workspace-write']);
  });

  it('requires a non-empty sandbox capability declaration', () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(descriptor({ supportedSandboxModes: [] }))).toThrow('sandbox modes');
  });
});
