import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ArgvGuard, PathGuard } from '@ready4vibe/execution';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
import { SandboxResolver, type SandboxResolveRequest } from '@ready4vibe/sandbox';
import { ToolRegistry } from '@ready4vibe/tools';
import {
  FileSystemToolAdapter,
  FileSystemWriteToolAdapter,
  ShellToolAdapter,
  ToolAdapterError,
  ToolExecutor,
  ToolHandlerRegistry,
  type FileSystemAdapterFileSystem,
  type ProcessRunner,
} from './index.js';

const registry = (): ToolRegistry => {
  const value = new ToolRegistry();
  value.register({ id: 'filesystem.read', version: '1.0.0', risk: 'read', summary: 'read', supportedSandboxModes: ['read-only', 'workspace-write'] });
  value.register({ id: 'filesystem.write', version: '1.0.0', risk: 'write', summary: 'write', supportedSandboxModes: ['workspace-write', 'external-sandbox'] });
  value.register({ id: 'shell.exec', version: '1.0.0', risk: 'destructive', summary: 'execute', supportedSandboxModes: ['external-sandbox'] });
  return value;
};

const intent = (overrides: Partial<ToolIntent> = {}): ToolIntent => ({
  workspaceId: 'workspace-1',
  toolId: 'filesystem.read',
  toolVersion: '1.0.0',
  risk: 'read',
  taskTrust: 'trusted-workspace',
  sandboxMode: 'read-only',
  networkAccess: 'restricted',
  approvalPolicy: 'on-request',
  policyRevision: 'policy-1',
  sessionId: 'session-1',
  ...overrides,
});

const sandboxFor = (value: ToolIntent): SandboxResolveRequest => {
  if (value.sandboxMode === 'read-only') return { taskTrust: value.taskTrust, policy: { mode: 'read-only', network: value.networkAccess } };
  if (value.sandboxMode === 'workspace-write') return { taskTrust: value.taskTrust, policy: { mode: 'workspace-write', writableRoots: ['.'], network: value.networkAccess } };
  return { taskTrust: value.taskTrust, policy: { mode: 'external-sandbox', provider: 'docker', network: value.networkAccess } };
};

async function temporaryWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ready4vibe-tool-adapter-'));
}

function realFileSystem(): FileSystemAdapterFileSystem {
  return {
    stat,
    readFile: async (path) => readFile(path),
    writeFile,
  };
}

describe('filesystem adapters', () => {
  it('reads bounded UTF-8 files and returns only the requested relative path', async () => {
    const root = await temporaryWorkspace();
    try {
      await mkdir(join(root, 'src'));
      await writeFile(join(root, 'src', 'main.ts'), 'export {}');
      const adapter = new FileSystemToolAdapter(new PathGuard(root), realFileSystem());
      const result = await adapter.execute({ path: 'src/main.ts' }, {} as never);
      expect(result).toEqual({ path: 'src/main.ts', content: 'export {}', bytes: 9 });
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects oversized reads, path escapes and missing parents before filesystem writes', async () => {
    const root = await temporaryWorkspace();
    try {
      const fs = realFileSystem();
      const read = new FileSystemToolAdapter(new PathGuard(root), fs, { maxReadBytes: 4 });
      await writeFile(join(root, 'large.txt'), '12345');
      await expect(read.execute({ path: 'large.txt' }, {} as never)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
      await expect(read.execute({ path: '../outside' }, {} as never)).rejects.toMatchObject({ code: 'PATH_GUARD' });
      await expect(read.execute({ path: 'missing.txt' }, {} as never)).rejects.toMatchObject({ code: 'TARGET_UNAVAILABLE' });
      const write = new FileSystemWriteToolAdapter(new PathGuard(root), fs);
      await expect(write.execute({ path: 'missing/new.txt', content: 'x' }, {} as never)).rejects.toMatchObject({ code: 'PATH_GUARD' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes bounded UTF-8 content without creating parent directories', async () => {
    const root = await temporaryWorkspace();
    try {
      const adapter = new FileSystemWriteToolAdapter(new PathGuard(root), realFileSystem(), { maxWriteBytes: 4 });
      await expect(adapter.execute({ path: 'new.txt', content: '你好' }, {} as never)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
      const result = await adapter.execute({ path: 'new.txt', content: 'ok' }, {} as never);
      expect(result).toEqual({ path: 'new.txt', bytes: 2 });
      expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('ok');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('shell adapter', () => {
  it('passes validated argv, shell=false, bounded limits and allowlisted env to an injected runner', async () => {
    const runner: ProcessRunner = { run: vi.fn(async (request) => ({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false })) };
    const root = await temporaryWorkspace();
    try {
      const adapter = new ShellToolAdapter(new PathGuard(root), new ArgvGuard({ allowedEnv: ['PATH'] }), runner);
      const result = await adapter.execute({ argv: ['node', '--version'], env: { PATH: '/usr/bin' }, timeoutMs: 1_000, maxOutputBytes: 2_000 }, {
        workspaceRoot: root,
        intent: intent({ toolId: 'shell.exec', risk: 'destructive', taskTrust: 'untrusted-content', sandboxMode: 'external-sandbox' }),
        sandbox: { mode: 'external-sandbox', network: 'restricted', provider: 'docker' },
        signal: new AbortController().signal,
      });
      expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false });
      expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ argv: ['node', '--version'], shell: false, cwd: root, env: { PATH: '/usr/bin' }, timeoutMs: 1_000, maxOutputBytes: 2_000 }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not execute when the runner is not explicitly injected', async () => {
    const root = await temporaryWorkspace();
    try {
      const adapter = new ShellToolAdapter(new PathGuard(root), new ArgvGuard());
      await expect(adapter.execute({ argv: ['node'] }, {
        workspaceRoot: root,
        intent: intent({ toolId: 'shell.exec', risk: 'destructive', taskTrust: 'trusted-workspace', sandboxMode: 'external-sandbox' }),
        sandbox: { mode: 'external-sandbox', network: 'restricted', provider: 'docker' },
        signal: new AbortController().signal,
      })).rejects.toMatchObject({ code: 'TOOL_EXECUTION_UNAVAILABLE' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('ToolExecutor', () => {
  it('requires approval and sandbox resolution before invoking a handler', async () => {
    const root = await temporaryWorkspace();
    try {
      const handlers = new ToolHandlerRegistry();
      const handler = { id: 'filesystem.write', version: '1.0.0', execute: vi.fn(async () => ({ ok: true })) };
      handlers.register(handler);
      const value = intent({ toolId: 'filesystem.write', risk: 'write', sandboxMode: 'workspace-write' });
      const executor = new ToolExecutor({ registry: registry(), approvalPolicy: new ApprovalPolicy(registry()), sandboxResolver: new SandboxResolver(), handlers });
      await expect(executor.execute({ workspaceRoot: root, intent: value, sandbox: sandboxFor(value), input: {} })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
      expect(handler.execute).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for untrusted host fallback and does not call a handler', async () => {
    const root = await temporaryWorkspace();
    const handlers = new ToolHandlerRegistry();
    const handler = { id: 'filesystem.write', version: '1.0.0', execute: vi.fn(async () => ({ ok: true })) };
    handlers.register(handler);
    const value = intent({ toolId: 'filesystem.write', risk: 'write', taskTrust: 'untrusted-content', sandboxMode: 'external-sandbox' });
    const approvalPolicy = new ApprovalPolicy(registry());
    approvalPolicy.approve(value, 1_000);
    const executor = new ToolExecutor({ registry: registry(), approvalPolicy, sandboxResolver: new SandboxResolver(), handlers });
    await expect(executor.execute({ workspaceRoot: root, intent: value, sandbox: sandboxFor(value), input: { path: 'x', content: 'x' } })).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    expect(handler.execute).not.toHaveBeenCalled();
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a sandbox request that disagrees with the approval intent', async () => {
    const root = await temporaryWorkspace();
    const handlers = new ToolHandlerRegistry();
    handlers.register({ id: 'filesystem.read', version: '1.0.0', execute: vi.fn(async () => ({ ok: true })) });
    const value = intent();
    const executor = new ToolExecutor({ registry: registry(), approvalPolicy: new ApprovalPolicy(registry()), sandboxResolver: new SandboxResolver(), handlers });
    await expect(executor.execute({ workspaceRoot: root, intent: value, sandbox: { taskTrust: value.taskTrust, policy: { mode: 'workspace-write', writableRoots: ['.'], network: 'restricted' } }, input: { path: 'x' } })).rejects.toMatchObject({ code: 'SANDBOX_REQUEST_MISMATCH' });
    await rm(root, { recursive: true, force: true });
  });

  it('runs an allowed filesystem read only after policy and sandbox checks pass', async () => {
    const root = await temporaryWorkspace();
    try {
      await writeFile(join(root, 'ok.txt'), 'ok');
      const handlers = new ToolHandlerRegistry();
      handlers.register(new FileSystemToolAdapter(new PathGuard(root), realFileSystem()));
      const value = intent();
      const executor = new ToolExecutor({ registry: registry(), approvalPolicy: new ApprovalPolicy(registry()), sandboxResolver: new SandboxResolver(), handlers });
      await expect(executor.execute({ workspaceRoot: root, intent: value, sandbox: sandboxFor(value), input: { path: 'ok.txt' } })).resolves.toEqual({ path: 'ok.txt', content: 'ok', bytes: 2 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
