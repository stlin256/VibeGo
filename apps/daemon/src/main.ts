import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteEventStore } from '@ready4vibe/storage';
import { createDaemonServer, isLoopbackHost, type LoopbackHost } from './server.js';

const hostValue = process.env.READY4VIBE_HOST ?? '127.0.0.1';
if (!isLoopbackHost(hostValue)) {
  throw new Error('READY4VIBE_HOST must be 127.0.0.1 or ::1 until LAN transport is implemented');
}
const host: LoopbackHost = hostValue;
const port = parsePort(process.env.READY4VIBE_PORT ?? '8787');
const dataDir = process.env.READY4VIBE_DATA_DIR ?? '.ready4vibe';
mkdirSync(dataDir, { recursive: true });
const eventStore = new SqliteEventStore(join(dataDir, 'events.sqlite'));
const server = createDaemonServer({ host, storageKind: 'sqlite' });

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
