import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { AuthGate } from '@ready4vibe/auth';
import { inspectTlsCertificate, loadTlsCredentials } from '@ready4vibe/certificates';
import { RunManager } from './run-manager.js';
import { Scheduler } from '@ready4vibe/scheduler';
import { SqliteEventStore } from '@ready4vibe/storage';
import { InMemoryModelSettingsManager } from './model-config.js';
import { createDaemonServer } from './server.js';
import { composeToolRuntimes, InMemoryToolSettingsManager } from './tool-settings.js';
import { InMemorySandboxSettingsManager } from './sandbox-settings.js';
import { resolveDaemonTransport } from './transport-config.js';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import { InMemoryGitSettingsManager } from './git-settings.js';

const transport = resolveDaemonTransport();
const { host, transportMode, tlsRequired, tlsEnabled, certificatePaths } = transport;
if (tlsEnabled && !certificatePaths) {
  throw new Error('TLS is enabled but certificate files are not configured; set READY4VIBE_TLS_CERT_FILE and READY4VIBE_TLS_KEY_FILE');
}
const tlsCredentials = tlsEnabled && certificatePaths ? loadTlsCredentials(certificatePaths) : undefined;
const certificateStatus = tlsCredentials ? inspectTlsCertificate(tlsCredentials.cert) : undefined;
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
const workspaceRegistry = new InMemoryWorkspaceRegistry({ defaultRoot: process.cwd() });
const modelSettings = new InMemoryModelSettingsManager();
const toolSettings = new InMemoryToolSettingsManager(workspaceRegistry);
const gitSettings = new InMemoryGitSettingsManager({ workspaceRegistry });
const sandboxSettings = new InMemorySandboxSettingsManager({ workspaceRegistry });
const runManager = new RunManager({
  eventStore,
  modelProvider: modelSettings.provider,
  modelProviderForRun: () => modelSettings.provider.snapshot(),
  toolRuntimeForRun: (config) => composeToolRuntimes([toolSettings.runtimeForRun(config), gitSettings.runtimeForRun(config), sandboxSettings.runtimeForRun(config)]),
  workspaceExists: (workspaceId) => workspaceRegistry.resolveRoot(workspaceId) !== undefined,
  scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
});
try {
  await runManager.recoverAfterRestart();
} catch (error) {
  eventStore.close();
  throw error;
}
const server = createDaemonServer({
  host,
  transportMode,
  authGate,
  storageKind: 'sqlite',
  runManager,
  ...(certificateStatus ? { certificateStatus } : {}),
  modelSettings,
  toolSettings,
  gitSettings,
  sandboxSettings,
  workspaceRegistry,
  ...(tlsCredentials ? { tls: tlsCredentials } : {}),
});

server.listen(port, host, () => {
  const displayHost = host === '::1' ? `[${host}]` : host;
  console.log(`ready4vibe daemon listening on ${tlsCredentials ? 'https' : 'http'}://${displayHost}:${port}`);
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
