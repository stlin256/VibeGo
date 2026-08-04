import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDaemonServer } from './server.js';

const servers: ReturnType<typeof createDaemonServer>[] = [];
const roots: string[] = [];
const temporaryFiles: string[] = [];

async function fixture(files: Record<string, string> = { 'index.html': '<!doctype html><title>VibeGo</title>' }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ready4vibe-web-dist-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
  return root;
}

async function listen(server: ReturnType<typeof createDaemonServer>): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(temporaryFiles.splice(0).map((file) => rm(file, { force: true })));
});

describe('daemon static Web serving', () => {
  it('serves index, hashed assets, HEAD and extensionless SPA routes with bounded cache headers', async () => {
    const root = await fixture({
      'index.html': '<!doctype html><title>VibeGo</title>',
      'assets/app-abc123.js': 'console.log("vibego");',
    });
    const server = createDaemonServer({ webDistDir: root });
    servers.push(server);
    const base = await listen(server);

    const index = await fetch(`${base}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('cache-control')).toBe('no-store');
    expect(await index.text()).toContain('VibeGo');

    const asset = await fetch(`${base}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(await asset.text()).toContain('vibego');

    const route = await fetch(`${base}/conversation/run_123`);
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('VibeGo');

    const head = await fetch(`${base}/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String('<!doctype html><title>VibeGo</title>'.length));
    expect(await head.text()).toBe('');
  });

  it('keeps API and health routes outside static fallback and rejects extension assets/directories', async () => {
    const root = await fixture({ 'index.html': 'shell', 'assets/placeholder.js': 'placeholder' });
    const server = createDaemonServer({ webDistDir: root, version: 'static-test' });
    servers.push(server);
    const base = await listen(server);

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ service: 'ready4vibe-daemon', version: 'static-test' });

    const api = await fetch(`${base}/api/v1/health`);
    expect(api.status).toBe(200);
    expect((await api.json() as { service: string }).service).toBe('ready4vibe-daemon');

    const missing = await fetch(`${base}/assets/missing.js`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: 'WEB_ASSET_NOT_FOUND' } });

    const directory = await fetch(`${base}/assets/`);
    expect(directory.status).toBe(404);
    expect(JSON.stringify(await directory.json())).not.toContain(root);
  });

  it('fails closed on encoded traversal, POST and missing build output without exposing host paths', async () => {
    const root = await fixture();
    const outside = join(root, '..', 'ready4vibe-web-secret.txt');
    temporaryFiles.push(outside);
    await writeFile(outside, 'do-not-serve', 'utf8');
    const server = createDaemonServer({ webDistDir: root });
    servers.push(server);
    const base = await listen(server);

    const traversal = await fetch(`${base}/nested/%2e%2e/ready4vibe-web-secret.txt`);
    expect([400, 404]).toContain(traversal.status);
    expect(await traversal.text()).not.toContain('do-not-serve');

    const post = await fetch(`${base}/`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');

    const missingRoot = await mkdtemp(join(tmpdir(), 'ready4vibe-web-missing-'));
    roots.push(missingRoot);
    await rm(missingRoot, { recursive: true, force: true });
    const unavailable = createDaemonServer({ webDistDir: missingRoot });
    servers.push(unavailable);
    const missingBase = await listen(unavailable);
    const response = await fetch(`${missingBase}/`);
    expect(response.status).toBe(503);
    const body = await response.json() as { error: { code: string; message: string } };
    expect(body).toMatchObject({ error: { code: 'WEB_ASSETS_UNAVAILABLE' } });
    expect(JSON.stringify(body)).not.toContain(missingRoot);
  });

  it('preserves source-checkout behavior when static hosting is not configured', async () => {
    const server = createDaemonServer();
    servers.push(server);
    const base = await listen(server);
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
