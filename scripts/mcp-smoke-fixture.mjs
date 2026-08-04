import { createInterface } from 'node:readline';

const SMOKE_FIXTURE_ID = 'ready4vibe-smoke';
const readline = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of readline) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !Object.prototype.hasOwnProperty.call(message, 'id')) continue;
  const result = message.method === 'initialize'
    ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: SMOKE_FIXTURE_ID, version: '1.0.0' } }
    : message.method === 'tools/list'
      ? { tools: [{ name: 'echo', description: 'Return a fixed smoke result.', inputSchema: { type: 'object' } }] }
      : message.method === 'tools/call'
        ? { content: [{ type: 'text', text: SMOKE_FIXTURE_ID }] }
        : {};
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
}
