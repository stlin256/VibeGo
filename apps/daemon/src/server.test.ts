import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createDaemonServer } from './server.js';

const servers: ReturnType<typeof createDaemonServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }));
});

describe('daemon health server', () => {
  it('serves a secret-free health response on loopback', async () => {
    const server = createDaemonServer({ host: '127.0.0.1', storageKind: 'sqlite', version: 'test-version' });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', service: 'ready4vibe-daemon', version: 'test-version' });
    expect(body).toHaveProperty('transport.tlsRequired', false);
    expect(body).toHaveProperty('storage.kind', 'sqlite');
    expect(JSON.stringify(body)).not.toContain('token');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('supports the versioned alias and rejects unknown paths', async () => {
    const server = createDaemonServer();
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    await expect(fetch(`http://127.0.0.1:${address.port}/api/v1/health`)).resolves.toMatchObject({ status: 200 });
    await expect(fetch(`http://127.0.0.1:${address.port}/runs`)).resolves.toMatchObject({ status: 404 });
  });

  it('allows only GET for health', async () => {
    const server = createDaemonServer();
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/health`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });
});
