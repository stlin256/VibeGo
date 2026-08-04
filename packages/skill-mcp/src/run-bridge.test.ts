import { describe, expect, it, vi } from 'vitest';
import {
  McpExecutionError,
  McpExecutionLedger,
  McpProtocolToolCallPort,
  type McpToolCallRequest,
} from './run-bridge.js';

const descriptor = {
  schemaVersion: 'mcp-capability/v1' as const,
  source: 'mcp' as const,
  serverId: 'docs-server',
  serverVersion: '1.0.0',
  protocolVersion: '2025-06-18',
  kind: 'tool' as const,
  id: 'search',
  name: 'docs.search',
  version: '1.0.0',
  revision: '1.0.0',
  qualifiedName: 'docs-server/tool/docs.search@1.0.0',
  summary: 'Search documentation.',
  risk: 'read' as const,
  sandboxMode: 'workspace-read' as const,
  networkAccess: 'disabled' as const,
  approvalMode: 'none' as const,
  executable: true,
  inputSchema: { type: 'object' },
};

function request(overrides: Partial<McpToolCallRequest> = {}): McpToolCallRequest {
  return {
    runId: 'run_1',
    turnId: 'turn_1',
    callId: 'call_1',
    descriptor,
    input: { query: 'typescript' },
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('McpExecutionLedger', () => {
  it('shares an in-flight call and returns the bounded cached result on replay', async () => {
    const ledger = new McpExecutionLedger();
    let resolveCall!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise<unknown>((resolve) => { resolveCall = resolve; }));
    const first = ledger.execute(request(), invoke);
    const second = ledger.execute(request(), invoke);
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();
    resolveCall({ matches: 2 });
    await expect(first).resolves.toEqual({ matches: 2 });
    await expect(second).resolves.toEqual({ matches: 2 });
    await expect(ledger.execute(request(), invoke)).resolves.toEqual({ matches: 2 });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('fails closed when a call id is reused with changed input or descriptor revision', async () => {
    const ledger = new McpExecutionLedger();
    const invoke = vi.fn(async () => ({ ok: true }));
    await ledger.execute(request(), invoke);
    await expect(ledger.execute(request({ input: { query: 'changed' } }), invoke)).rejects.toMatchObject({ code: 'MCP_CALL_REPLAY_CONFLICT' });
    await expect(ledger.execute(request({ descriptor: { ...descriptor, revision: '2.0.0', version: '2.0.0' } }), invoke)).rejects.toMatchObject({ code: 'MCP_CALL_REPLAY_CONFLICT' });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('does not execute a failed request again and exposes only a stable error', async () => {
    const ledger = new McpExecutionLedger();
    const invoke = vi.fn(async () => { throw new Error('Bearer secret at C:\\private\\mcp'); });
    await expect(ledger.execute(request(), invoke)).rejects.toMatchObject({ code: 'MCP_CALL_UNAVAILABLE' });
    await expect(ledger.execute(request(), invoke)).rejects.toMatchObject({ code: 'MCP_CALL_UNAVAILABLE' });
    expect(invoke).toHaveBeenCalledOnce();
    await expect(ledger.execute(request({ callId: 'call_2' }), invoke)).rejects.toMatchObject({ code: 'MCP_CALL_UNAVAILABLE' });
    expect(JSON.stringify(await Promise.resolve(new McpExecutionError('MCP_CALL_UNAVAILABLE')))).not.toMatch(/secret|private/iu);
  });

  it('rejects oversized input and redacts secret-shaped or absolute-path output', async () => {
    const ledger = new McpExecutionLedger({ maxInputBytes: 64, maxOutputBytes: 512 });
    await expect(ledger.execute(request({ input: { query: 'x'.repeat(100) } }), async () => ({ ok: true }))).rejects.toMatchObject({ code: 'MCP_CALL_TOO_LARGE' });
    await expect(ledger.execute(request({ callId: 'call-privacy' }), async () => ({
      apiKey: 'sk-' + 'x'.repeat(24),
      path: 'C:\\Users\\private\\file.txt',
      safe: 'ok',
    }))).resolves.toEqual({ safe: 'ok' });
  });
});

describe('McpProtocolToolCallPort', () => {
  it('uses the exact tools/call method and forwards the run AbortSignal', async () => {
    const signal = new AbortController().signal;
    const requestSignal = vi.fn();
    const session = {
      request: vi.fn(async (method: string, params: unknown, forwarded: AbortSignal) => {
        expect(method).toBe('tools/call');
        expect(params).toEqual({ name: 'search', arguments: { query: 'ts' } });
        requestSignal(forwarded);
        return { content: [{ type: 'text', text: 'two matches' }] };
      }),
    };
    const port = new McpProtocolToolCallPort(session);
    await expect(port.call(request({ input: { query: 'ts' }, signal }))).resolves.toEqual({ content: [{ type: 'text', text: 'two matches' }] });
    expect(requestSignal).toHaveBeenCalledWith(signal);
  });

  it('maps session failures to stable MCP execution errors without leaking details', async () => {
    const port = new McpProtocolToolCallPort({ request: vi.fn(async () => { throw new Error('secret response at C:\\private'); }) });
    await expect(port.call(request())).rejects.toMatchObject({ code: 'MCP_CALL_UNAVAILABLE' });
  });
});
