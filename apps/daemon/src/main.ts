import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { AuthGate, type TransportMode } from '@ready4vibe/auth';
import { RunManager } from './run-manager.js';
import { Scheduler } from '@ready4vibe/scheduler';
import { SqliteEventStore } from '@ready4vibe/storage';
import { createModelProvider } from './model-config.js';
import { createDaemonServer, isLanHost, isLoopbackHost, type DaemonHost } from './server.js';

const hostValue = process.env.READY4VIBE_HOST ?? '127.0.0.1';
if (!isLoopbackHost(hostValue) && !isLanHost(hostValue)) {
  throw new Error('READY4VIBE_HOST must be 127.0.0.1, ::1, 0.0.0.0 or ::');
}
const host: DaemonHost = hostValue;
const transportMode: TransportMode = isLoopbackHost(host) ? 'loopback' : 'lan';
if (transportMode === 'lan' && process.env.READY4VIBE_ALLOW_LAN !== '1') {
  throw new Error('LAN binding is disabled by default; set READY4VIBE_ALLOW_LAN=1 explicitly');
}
const tlsRequired = transportMode === 'lan' && process.env.READY4VIBE_ALLOW_INSECURE_LAN !== '1';
if (tlsRequired) {
  throw new Error('LAN TLS is required but HTTPS certificate wiring is not implemented yet; set READY4VIBE_ALLOW_INSECURE_LAN=1 only for explicit development use');
}
const allowedOrigins = process.env.READY4VIBE_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean);
const authGate = new AuthGate({
  mode: transportMode,
  authRequired: process.env.READY4VIBE_AUTH_REQUIRED !== '0',
  tlsRequired,
  ...(allowedOrigins && allowedOrigins.length > 0 ? { allowedOrigins } : {}),
});
const port = parsePort(process.env.READY4VIBE_PORT ?? '8787');
const dataDir = process.env.READY4VIBE_DATA_DIR ?? '.ready4vibe';
mkdirSync(dataDir, { recursive: true });
const eventStore = new SqliteEventStore(join(dataDir, 'events.sqlite'));
const modelProvider = createModelProvider();
const runManager = new RunManager({
  eventStore,
  modelProvider,
  scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
});
const server = createDaemonServer({ host, transportMode, authGate, storageKind: 'sqlite', runManager });

server.listen(port, host, () => {
  const displayHost = host === '::1' ? `[${host}]` : host;
  console.log(`ready4vibe daemon listening on http://${displayHost}:${port}`);
});

const shutdown = (): void => {
  server.close(() => {
    eventStore.close();
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function parsePort(value: string): number {
  const portNumber = Number(value);
  if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65_535) {
    throw new Error(`invalid READY4VIBE_PORT: ${value}`);
  }
  return portNumber;
}
