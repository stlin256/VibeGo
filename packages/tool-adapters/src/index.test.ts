import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ArgvGuard, PathGuard } from '@ready4vibe/execution';
import type { McpCapabilityDescriptor, McpCapabilitySnapshot, McpToolCallPort } from '@ready4vibe/skill-mcp';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
import { SandboxResolver, type SandboxResolveRequest } from '@ready4vibe/sandbox';
import { ToolRegistry } from '@ready4vibe/tools';
import {
  FileSystemEditToolAdapter,
  FileSystemFindToolAdapter,
  FileSystemListToolAdapter,
  FileSystemSearchToolAdapter,
  FileSystemToolAdapter,
  FileSystemWriteToolAdapter,
  formatGitApprovalCommand,
  GitToolAdapter,
  HostShellToolAdapter,
  ShellToolAdapter,
  ToolAdapterError,
  ToolExecutor,
  ToolExecutorRuntime,
  McpToolExecutorRuntime,
  ToolHandlerRegistry,
  type FileSystemAdapterFileSystem,
  type HostShellRunner,
  type ProcessRunner,
} from './index.js';

const mcpConfig = {
  workspaceId: 'workspace-1',
  userMessage: 'search docs',
  model: { provider: 'fixture', name: 'fixture' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: { maxTurns: 2, maxWallTimeMs: 60_000, maxModelInputTokens: 2_000, maxModelOutputTokens: 2_000, maxToolCalls: 4, maxOutputBytes: 16_384, maxContextBytes: 16_384 },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
};

function mcpDescriptor(overrides: Partial<McpCapabilityDescriptor> = {}): McpCapabilityDescriptor {
  return {
    schemaVersion: 'mcp-capability/v1',
    source: 'mcp',
    serverId: 'docs-server',
    serverVersion: '1.0.0',
    protocolVersion: '2025-06-18',
    kind: 'tool',
    id: 'search',
    name: 'search',
    version: '1.0.0',
    revision: '1.0.0',
    qualifiedName: 'docs-server/tool/search@1.0.0',
    summary: 'Search docs.',
    risk: 'read',
    sandboxMode: 'workspace-read',
    networkAccess: 'disabled',
    approvalMode: 'none',
    executable: true,
    inputSchema: { type: 'object' },
    ...overrides,
  };
}

function mcpSnapshot(capabilities: readonly McpCapabilityDescriptor[]): McpCapabilitySnapshot {
  return {
    schemaVersion: 'mcp-capability-snapshot/v1',
    serverId: 'docs-server',
    serverVersion: '1.0.0',
    protocolVersion: '2025-06-18',
    health: 'healthy-verified',
    healthCheckId: 1,
    capabilities,
    fingerprint: 'a'.repeat(64),
  };
}

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
    readdir: async (path) => readdir(path, { withFileTypes: true }),
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

describe('host shell adapter', () => {
  const hostContext = (root: string) => ({
    workspaceRoot: root,
    intent: intent({ toolId: 'shell.exec', risk: 'destructive', sandboxMode: 'workspace-write' }),
    sandbox: { mode: 'workspace-write' as const, network: 'restricted' as const },
    signal: new AbortController().signal,
  });

  it('builds the shell argv prefix and passes the raw command string to the runner', async () => {
    const root = await temporaryWorkspace();
    try {
      const runner: HostShellRunner = { run: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false, timedOut: false, cancelled: false })) };
      const adapter = new HostShellToolAdapter(new PathGuard(root), runner, { shell: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'] });
      const result = await adapter.execute({ command: 'Get-ChildItem | Select-Object -First 1', timeoutMs: 5_000 }, hostContext(root));
      expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false });
      expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRoot: root,
        cwd: root,
        command: ['pwsh', '-NoProfile', '-NonInteractive', '-Command', 'Get-ChildItem | Select-Object -First 1'],
        allowShellMetacharacters: true,
        limits: { timeoutMs: 5_000, maxOutputBytes: 1024 * 1024 },
      }), expect.anything());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('builds the POSIX -c prefix for bash', async () => {
    const root = await temporaryWorkspace();
    try {
      const runner: HostShellRunner = { run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: false })) };
      const adapter = new HostShellToolAdapter(new PathGuard(root), runner, { shell: 'bash', args: ['-c'] });
      await adapter.execute({ command: 'ls && echo done > out.txt' }, hostContext(root));
      expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ command: ['bash', '-c', 'ls && echo done > out.txt'] }), expect.anything());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects empty, oversized and non-string commands', async () => {
    const root = await temporaryWorkspace();
    try {
      const runner: HostShellRunner = { run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: false })) };
      const adapter = new HostShellToolAdapter(new PathGuard(root), runner, { shell: 'bash', args: ['-c'] });
      await expect(adapter.execute({ command: '' }, hostContext(root))).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
      await expect(adapter.execute({ command: '   ' }, hostContext(root))).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
      await expect(adapter.execute({ command: 'x'.repeat(8_001) }, hostContext(root))).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
      await expect(adapter.execute({ argv: ['ls'] }, hostContext(root))).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a cwd outside the workspace and resolves an inside cwd', async () => {
    const root = await temporaryWorkspace();
    try {
      await mkdir(join(root, 'src'));
      const runner: HostShellRunner = { run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: false })) };
      const adapter = new HostShellToolAdapter(new PathGuard(root), runner, { shell: 'bash', args: ['-c'] });
      await expect(adapter.execute({ command: 'ls', cwd: '../outside' }, hostContext(root))).rejects.toMatchObject({ code: 'PATH_GUARD' });
      await adapter.execute({ command: 'ls', cwd: 'src' }, hostContext(root));
      expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ cwd: join(root, 'src') }), expect.anything());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('maps runner failures to TOOL_FAILED without leaking details', async () => {
    const root = await temporaryWorkspace();
    try {
      const runner: HostShellRunner = { run: vi.fn(async () => { throw new Error('CWD_OUTSIDE_WORKSPACE secret-path'); }) };
      const adapter = new HostShellToolAdapter(new PathGuard(root), runner, { shell: 'bash', args: ['-c'] });
      await expect(adapter.execute({ command: 'ls' }, hostContext(root))).rejects.toMatchObject({ code: 'TOOL_FAILED' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('read-only Git adapter', () => {
  it('uses fixed argv, bounded options, minimal environment, and redacts the workspace root', async () => {
    const calls: Array<{ argv: readonly string[]; cwd: string; env: Readonly<Record<string, string>>; timeoutMs: number; maxOutputBytes: number }> = [];
    const root = await temporaryWorkspace();
    try {
      const runner: ProcessRunner = { run: vi.fn(async (request) => { calls.push(request); return { exitCode: 0, stdout: `changed ${root}`, stderr: root, truncated: false }; }) };
      const context = { workspaceRoot: root, signal: new AbortController().signal } as never;
      const status = await new GitToolAdapter('git.status', runner).execute({}, context);
      const diff = await new GitToolAdapter('git.diff', runner).execute({ staged: true, timeoutMs: 1_000, maxOutputBytes: 2_000 }, context);
      const log = await new GitToolAdapter('git.log', runner).execute({ limit: 3 }, context);
      expect(status).toEqual({ exitCode: 0, stdout: 'changed [workspace]', stderr: '[workspace]', truncated: false });
      expect(diff).toEqual(status);
      expect(log).toEqual(status);
      expect(calls[0]).toMatchObject({ argv: ['--no-pager', '--no-optional-locks', 'status', '--short', '--branch', '--untracked-files=normal'], cwd: root, env: { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' }, timeoutMs: 15_000, maxOutputBytes: 2 * 1024 * 1024 });
      expect(calls[1]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'diff', '--no-ext-diff', '--unified=3', '--cached', '--']);
      expect(calls[1]?.timeoutMs).toBe(1_000);
      expect(calls[1]?.maxOutputBytes).toBe(2_000);
      expect(calls[2]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'log', '--oneline', '--decorate=short', '--max-count=3', '--']);
      await expect(new GitToolAdapter('git.status', runner).execute({ argv: ['git', 'reset'] }, context)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed when no process runner is injected', async () => {
    const root = await temporaryWorkspace();
    try {
      await expect(new GitToolAdapter('git.diff').execute({}, { workspaceRoot: root, signal: new AbortController().signal } as never)).rejects.toMatchObject({ code: 'TOOL_EXECUTION_UNAVAILABLE' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});



describe('Git write and destructive adapter', () => {
  it('builds correct argv for add, commit, branch, push, reset and restore', async () => {
    const calls: { argv: readonly string[] }[] = [];
    const runner = { run: vi.fn(async (request: { argv: readonly string[] }) => { calls.push(request); return { exitCode: 0, stdout: '', stderr: '', truncated: false }; }) };
    const context = { workspaceRoot: 'C:/workspace', signal: new AbortController().signal } as never;
    await new GitToolAdapter('git.add', runner).execute({ paths: ['src/index.ts'] }, context);
    await new GitToolAdapter('git.commit', runner).execute({ message: 'fix bug\nsecond line' }, context);
    await new GitToolAdapter('git.branch', runner).execute({ action: 'create', name: 'feature-x' }, context);
    await new GitToolAdapter('git.branch', runner).execute({ action: 'switch', name: 'main' }, context);
    await new GitToolAdapter('git.push', runner).execute({ remote: 'origin', branch: 'main', force: true }, context);
    await new GitToolAdapter('git.reset', runner).execute({ mode: 'hard', ref: 'HEAD~1' }, context);
    await new GitToolAdapter('git.restore', runner).execute({ paths: ['src/index.ts'], staged: true }, context);
    expect(calls[0]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'add', '--', 'src/index.ts']);
    expect(calls[1]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'commit', '-m', 'fix bug\nsecond line']);
    expect(calls[2]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'branch', '--', 'feature-x']);
    expect(calls[3]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'switch', '--', 'main']);
    expect(calls[4]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'push', '--force-with-lease', 'origin', 'main']);
    expect(calls[5]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'reset', '--hard', 'HEAD~1']);
    expect(calls[6]?.argv).toEqual(['--no-pager', '--no-optional-locks', 'restore', '--staged', '--', 'src/index.ts']);
  });

  it('rejects traversal, absolute paths, oversized commit messages and invalid branch names', async () => {
    const runner = { run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false })) };
    const context = { workspaceRoot: 'C:/workspace', signal: new AbortController().signal } as never;
    await expect(new GitToolAdapter('git.add', runner).execute({ paths: ['../secret'] }, context)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    await expect(new GitToolAdapter('git.add', runner).execute({ paths: ['C:/secret'] }, context)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    await expect(new GitToolAdapter('git.commit', runner).execute({ message: '' }, context)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    await expect(new GitToolAdapter('git.branch', runner).execute({ action: 'create', name: 'bad..name' }, context)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    await expect(new GitToolAdapter('git.push', runner).execute({ remote: 'origin', branch: 'a space' }, context)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
  });

  it('formats approval commands for destructive Git tools', () => {
    expect(formatGitApprovalCommand('git.push', { remote: 'origin', branch: 'main', force: true })).toBe('git push --force-with-lease origin main');
    expect(formatGitApprovalCommand('git.reset', { mode: 'hard', ref: 'HEAD~1' })).toBe('git reset --hard HEAD~1');
    expect(formatGitApprovalCommand('git.commit', { message: 'a'.repeat(100) })).toBe(`git commit -m "${'a'.repeat(80)}…"`);
    expect(formatGitApprovalCommand('git.status', {})).toBeUndefined();
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

describe('ToolExecutorRuntime', () => {
  it('projects public descriptors and delegates with explicit workspace, intent and sandbox callbacks', async () => {
    const root = await temporaryWorkspace();
    try {
      await writeFile(join(root, 'ok.txt'), 'ok');
      const value = registry();
      const handlers = new ToolHandlerRegistry();
      handlers.register(new FileSystemToolAdapter(new PathGuard(root), realFileSystem()));
      const executor = new ToolExecutor({ registry: value, approvalPolicy: new ApprovalPolicy(value), sandboxResolver: new SandboxResolver(), handlers });
      const resolveWorkspaceRoot = vi.fn(() => root);
      const createIntent = vi.fn((request) => intent({ toolId: request.descriptor.id, toolVersion: request.descriptor.version, risk: request.descriptor.risk }));
      const createSandboxRequest = vi.fn((request) => sandboxFor(createIntent(request)));
      const runtime = new ToolExecutorRuntime({ registry: value, executor, resolveWorkspaceRoot, createIntent, createSandboxRequest });
      const descriptor = runtime.descriptors.find((entry) => entry.id === 'filesystem.read');
      const result = await runtime.execute({
        runId: 'run-1',
        turnId: 'turn-1',
        callId: 'call-1',
        descriptor: descriptor!,
        input: { path: 'ok.txt' },
        config: {} as never,
        signal: new AbortController().signal,
      });
      expect(result).toEqual({ output: { path: 'ok.txt', content: 'ok', bytes: 2 } });
      expect(resolveWorkspaceRoot).toHaveBeenCalledOnce();
      expect(createIntent).toHaveBeenCalledWith(expect.objectContaining({ input: { path: 'ok.txt' } }));
      expect(createSandboxRequest).toHaveBeenCalledOnce();
      expect(runtime.descriptors.find((entry) => entry.id === 'filesystem.read')).toMatchObject({ name: 'filesystem.read', risk: 'read' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves executor approval failures and never supplies an implicit approval', async () => {
    const root = await temporaryWorkspace();
    try {
      const value = registry();
      const handlers = new ToolHandlerRegistry();
      handlers.register({ id: 'filesystem.write', version: '1.0.0', execute: vi.fn(async () => ({ ok: true })) });
      const executor = new ToolExecutor({ registry: value, approvalPolicy: new ApprovalPolicy(value), sandboxResolver: new SandboxResolver(), handlers });
      const runtime = new ToolExecutorRuntime({
        registry: value,
        executor,
        resolveWorkspaceRoot: () => root,
        createIntent: (request) => intent({ toolId: request.descriptor.id, toolVersion: request.descriptor.version, risk: request.descriptor.risk, sandboxMode: 'workspace-write' }),
        createSandboxRequest: (request) => sandboxFor(intent({ toolId: request.descriptor.id, toolVersion: request.descriptor.version, risk: request.descriptor.risk, sandboxMode: 'workspace-write' })),
      });
      const descriptor = runtime.descriptors.find((entry) => entry.id === 'filesystem.write')!;
      await expect(runtime.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor, input: { path: 'x', content: 'x' }, config: {} as never, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('approves through the same runtime intent and then allows one executor call', async () => {
    const root = await temporaryWorkspace();
    try {
      const value = registry();
      const handler = { id: 'filesystem.write', version: '1.0.0', execute: vi.fn(async () => ({ ok: true })) };
      const handlers = new ToolHandlerRegistry();
      handlers.register(handler);
      const executor = new ToolExecutor({ registry: value, approvalPolicy: new ApprovalPolicy(value), sandboxResolver: new SandboxResolver(), handlers });
      const runtime = new ToolExecutorRuntime({
        registry: value,
        executor,
        resolveWorkspaceRoot: () => root,
        createIntent: (request) => intent({ toolId: request.descriptor.id, toolVersion: request.descriptor.version, risk: request.descriptor.risk, sandboxMode: 'workspace-write', path: 'new.txt' }),
        createSandboxRequest: (request) => sandboxFor(intent({ toolId: request.descriptor.id, toolVersion: request.descriptor.version, risk: request.descriptor.risk, sandboxMode: 'workspace-write' })),
      });
      const descriptor = runtime.descriptors.find((entry) => entry.id === 'filesystem.write')!;
      const request = { runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor, input: { path: 'new.txt', content: 'x' }, config: {} as never, signal: new AbortController().signal };
      await runtime.approve(request, 1_000);
      await expect(runtime.execute(request)).resolves.toEqual({ output: { ok: true } });
      expect(handler.execute).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes an already-aborted signal through the executor boundary', async () => {
    const root = await temporaryWorkspace();
    try {
      const value = registry();
      const receivedSignals: AbortSignal[] = [];
      const handlers = new ToolHandlerRegistry();
      handlers.register({ id: 'filesystem.read', version: '1.0.0', execute: vi.fn(async (_input, context) => { receivedSignals.push(context.signal); return { ok: true }; }) });
      const executor = new ToolExecutor({ registry: value, approvalPolicy: new ApprovalPolicy(value), sandboxResolver: new SandboxResolver(), handlers });
      const runtime = new ToolExecutorRuntime({ registry: value, executor, resolveWorkspaceRoot: () => root, createIntent: (request) => intent({ toolId: request.descriptor.id, risk: request.descriptor.risk }), createSandboxRequest: (request) => sandboxFor(intent({ toolId: request.descriptor.id, risk: request.descriptor.risk })) });
      const controller = new AbortController();
      controller.abort();
      await runtime.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: runtime.descriptors.find((entry) => entry.id === 'filesystem.read')!, input: { path: 'ok.txt' }, config: {} as never, signal: controller.signal });
      expect(receivedSignals[0]?.aborted).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('McpToolExecutorRuntime', () => {
  it('binds only executable MCP tools and routes calls through ToolExecutor policy/sandbox', async () => {
    const root = await temporaryWorkspace();
    try {
      const snapshot = mcpSnapshot([
        mcpDescriptor(),
        { ...mcpDescriptor(), kind: 'resource', id: 'readme', name: 'readme', qualifiedName: 'docs-server/resource/readme@1.0.0', executable: false, risk: 'read', sandboxMode: 'workspace-read' },
        { ...mcpDescriptor(), kind: 'prompt', id: 'summarize', name: 'summarize', qualifiedName: 'docs-server/prompt/summarize@1.0.0', executable: false, risk: 'read', sandboxMode: 'workspace-read' },
      ]);
      const port: McpToolCallPort = { call: vi.fn(async () => ({ matches: 2 })) };
      const runtime = new McpToolExecutorRuntime({ snapshot, callPort: port, resolveWorkspaceRoot: () => root });
      expect(runtime.descriptors).toHaveLength(1);
      expect(runtime.descriptors[0]).toMatchObject({ id: 'docs-server/tool/search@1.0.0', name: 'docs-server/tool/search@1.0.0', risk: 'read' });
      const result = await runtime.execute({
        runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: runtime.descriptors[0]!, input: { query: 'ts' }, config: mcpConfig, signal: new AbortController().signal,
      });
      expect(result).toEqual({ output: { source: 'mcp', serverId: 'docs-server', toolId: 'search', revision: '1.0.0', value: { matches: 2 } } });
      expect(port.call).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1', callId: 'call-1', input: { query: 'ts' } }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('shares identical calls, rejects replay conflicts, and forwards cancellation', async () => {
    const root = await temporaryWorkspace();
    try {
      const descriptor = mcpDescriptor();
      const controller = new AbortController();
      const receivedSignals: AbortSignal[] = [];
      const port: McpToolCallPort = { call: vi.fn(async (request) => { receivedSignals.push(request.signal); return { ok: true }; }) };
      const runtime = new McpToolExecutorRuntime({ snapshot: mcpSnapshot([descriptor]), callPort: port, resolveWorkspaceRoot: () => root });
      const base = { runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: runtime.descriptors[0]!, config: mcpConfig, signal: controller.signal };
      await expect(runtime.execute({ ...base, input: { query: 'same' } })).resolves.toMatchObject({ output: { value: { ok: true } } });
      await expect(runtime.execute({ ...base, input: { query: 'same' } })).resolves.toMatchObject({ output: { value: { ok: true } } });
      await expect(runtime.execute({ ...base, input: { query: 'different' } })).rejects.toMatchObject({ code: 'MCP_CALL_REPLAY_CONFLICT' });
      expect(port.call).toHaveBeenCalledOnce();
      expect(receivedSignals[0]).toBeInstanceOf(AbortSignal);
      expect(receivedSignals[0]).not.toBe(controller.signal);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the normal approval continuation for a write MCP tool', async () => {
    const root = await temporaryWorkspace();
    try {
      const descriptor = mcpDescriptor({ id: 'publish', name: 'publish', qualifiedName: 'docs-server/tool/publish@1.0.0', risk: 'write', sandboxMode: 'workspace-write' });
      const port: McpToolCallPort = { call: vi.fn(async () => ({ published: true })) };
      const runtime = new McpToolExecutorRuntime({ snapshot: mcpSnapshot([descriptor]), callPort: port, resolveWorkspaceRoot: () => root });
      const config = { ...mcpConfig, sandbox: { mode: 'workspace-write' as const, writableRoots: ['.'], network: 'restricted' as const } };
      const request = { runId: 'run-2', turnId: 'turn-1', callId: 'call-2', descriptor: runtime.descriptors[0]!, input: { title: 'x' }, config, signal: new AbortController().signal };
      await expect(runtime.execute(request)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
      await runtime.approve(request, 1_000);
      await expect(runtime.execute(request)).resolves.toMatchObject({ output: { value: { published: true } } });
      expect(port.call).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for unverified snapshots and never treats resources as tools', () => {
    const unverified = { ...mcpSnapshot([{ ...mcpDescriptor(), executable: false }]), health: 'healthy-connectivity-only' as const } as unknown as McpCapabilitySnapshot;
    expect(() => new McpToolExecutorRuntime({
      snapshot: unverified,
      callPort: { call: vi.fn() },
      resolveWorkspaceRoot: () => 'C:\\workspace',
    })).toThrowError(new ToolAdapterError('TOOL_FORBIDDEN'));
  });
});

describe('workspace navigation adapters', () => {
  async function seededWorkspace(): Promise<string> {
    const root = await temporaryWorkspace();
    await mkdir(join(root, 'src', 'deep'), { recursive: true });
    await mkdir(join(root, 'docs'));
    await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 42;\n// TODO: refine\n');
    await writeFile(join(root, 'src', 'deep', 'util.ts'), 'export const helper = true;\n');
    await writeFile(join(root, 'docs', 'guide.md'), '# Guide\nSee src/main.ts for the answer.\n');
    return root;
  }

  it('lists a bounded directory tree with directory markers', async () => {
    const root = await seededWorkspace();
    try {
      const adapter = new FileSystemListToolAdapter(new PathGuard(root), realFileSystem(), root);
      const result = await adapter.execute({ path: '.', maxDepth: 1 }, {} as never) as { entries: string[]; truncated: boolean };
      expect(result.entries).toContain('src/');
      const fromSlash = await adapter.execute({ path: '/', maxDepth: 1 }, {} as never) as { entries: string[] };
      expect(fromSlash.entries).toEqual(result.entries);
      expect(result.entries).toContain('src/main.ts');
      expect(result.entries).toContain('docs/guide.md');
      expect(result.entries).not.toContain('src/deep/util.ts');
      await expect(adapter.execute({ path: '../outside' }, {} as never)).rejects.toMatchObject({ code: 'PATH_GUARD' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('searches file contents with a bounded regex and returns located lines', async () => {
    const root = await seededWorkspace();
    try {
      const adapter = new FileSystemSearchToolAdapter(new PathGuard(root), realFileSystem(), root);
      const result = await adapter.execute({ pattern: 'answer' }, {} as never) as { matches: string[] };
      expect(result.matches.some((line) => line.startsWith('src/main.ts:1:'))).toBe(true);
      expect(result.matches.some((line) => line.startsWith('docs/guide.md:2:'))).toBe(true);
      const caseSensitive = await adapter.execute({ pattern: 'ANSWER', caseSensitive: true }, {} as never) as { matches: string[] };
      expect(caseSensitive.matches).toEqual([]);
      await expect(adapter.execute({ pattern: '([' }, {} as never)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('finds files by glob against basenames or workspace-relative paths', async () => {
    const root = await seededWorkspace();
    try {
      const adapter = new FileSystemFindToolAdapter(new PathGuard(root), realFileSystem(), root);
      const byBasename = await adapter.execute({ pattern: '*.ts' }, {} as never) as { matches: string[] };
      expect(byBasename.matches).toEqual(expect.arrayContaining(['src/main.ts', 'src/deep/util.ts']));
      const byPath = await adapter.execute({ pattern: 'src/deep/*' }, {} as never) as { matches: string[] };
      expect(byPath.matches).toEqual(['src/deep/util.ts']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('edits exactly one anchored occurrence and rejects ambiguous or missing anchors', async () => {
    const root = await seededWorkspace();
    try {
      const adapter = new FileSystemEditToolAdapter(new PathGuard(root), realFileSystem());
      const result = await adapter.execute({ path: 'src/main.ts', oldText: 'answer = 42', newText: 'answer = 43' }, {} as never);
      expect(result).toEqual({ path: 'src/main.ts', bytes: 42, replacements: 1 });
      await expect(readFile(join(root, 'src', 'main.ts'), 'utf8')).resolves.toContain('answer = 43');
      await expect(adapter.execute({ path: 'src/main.ts', oldText: 'missing anchor', newText: 'x' }, {} as never)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
      await writeFile(join(root, 'src', 'dup.ts'), 'dup\ndup\n');
      await expect(adapter.execute({ path: 'src/dup.ts', oldText: 'dup', newText: 'x' }, {} as never)).rejects.toMatchObject({ code: 'TOOL_INPUT_INVALID' });
      await expect(adapter.execute({ path: '../outside.ts', oldText: 'a', newText: 'b' }, {} as never)).rejects.toMatchObject({ code: 'PATH_GUARD' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
