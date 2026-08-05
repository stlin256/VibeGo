import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDeploymentReadiness, createDeploymentProfile, DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { AuthGate } from '@ready4vibe/auth';
import { buildCertificateReadiness, inspectTlsCertificate, loadTlsCredentials } from '@ready4vibe/certificates';
import { RunManager } from './run-manager.js';
import { Scheduler } from '@ready4vibe/scheduler';
import { SqliteEventStore, SqliteGoalEventStore, SqliteObservabilityLedger, SqliteSettingsStore } from '@ready4vibe/storage';
import { InMemoryModelSettingsManager } from './model-config.js';
import { createDaemonServer } from './server.js';
import { composeToolRuntimes, InMemoryToolSettingsManager } from './tool-settings.js';
import { InMemorySandboxSettingsManager } from './sandbox-settings.js';
import { resolveDaemonTransport } from './transport-config.js';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import { InMemoryGitSettingsManager } from './git-settings.js';
import { SqliteWorkspaceRegistryPersistence } from './workspace-persistence.js';
import { AgentMemorySettingsManager } from './agent-memory-settings.js';
import { TencentMemoryRuntimeSupervisor } from './tencent-memory-runtime-supervisor.js';
import { AgentMemoryKnowledgeSettingsManager } from './agent-memory-knowledge-settings.js';
import { McpSettingsManager } from './mcp-settings.js';
import { McpRunBindingManager } from './mcp-runtime-binding.js';
import { DurableCapabilityProfileSettingsManager } from './capability-profile-settings.js';
import type { CapabilityProfilePolicy } from '@ready4vibe/policy';
import { GoalWriteService } from '@ready4vibe/goal-control';
import { ProviderUsageLifecycleAdapter, RunUsageObserver } from '@ready4vibe/observability';

const transport = resolveDaemonTransport();
const { host, transportMode, tlsRequired, tlsEnabled, certificatePaths } = transport;
if (tlsEnabled && !certificatePaths) {
  throw new Error('TLS is enabled but certificate files are not configured; set READY4VIBE_TLS_CERT_FILE and READY4VIBE_TLS_KEY_FILE');
}
const tlsCredentials = tlsEnabled && certificatePaths ? loadTlsCredentials(certificatePaths) : undefined;
const certificateStatus = tlsCredentials ? inspectTlsCertificate(tlsCredentials.cert) : undefined;
const certificateReadiness = buildCertificateReadiness(certificateStatus, { tlsRequired });
const deploymentReadiness = buildDeploymentReadiness(createDeploymentProfile(transportMode), {
  certificate: certificateReadiness.status === 'ready' ? 'ready' : certificateReadiness.status === 'degraded' ? 'degraded' : 'blocked',
});
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
const goalEventStore = new SqliteGoalEventStore(join(dataDir, 'events.sqlite'));
const observabilityLedger = new SqliteObservabilityLedger(join(dataDir, 'events.sqlite'));
const observabilityUsageObserver = new RunUsageObserver({
  adapter: new ProviderUsageLifecycleAdapter({ writer: observabilityLedger }),
});
const goalWriteService = new GoalWriteService(goalEventStore, { producer: 'daemon-goal-api' });
let settingsStore: SqliteSettingsStore;
try {
  settingsStore = new SqliteSettingsStore(join(dataDir, 'events.sqlite'));
} catch (error) {
  await observabilityLedger.close();
  goalEventStore.close();
  eventStore.close();
  throw error;
}
let workspaceRegistry: InMemoryWorkspaceRegistry;
try {
  workspaceRegistry = new InMemoryWorkspaceRegistry({
    defaultRoot: process.cwd(),
    persistence: new SqliteWorkspaceRegistryPersistence(settingsStore),
  });
} catch (error) {
  await observabilityLedger.close();
  settingsStore.close();
  goalEventStore.close();
  eventStore.close();
  throw error;
}
const modelSettings = new InMemoryModelSettingsManager(process.env, undefined, undefined, settingsStore);
let agentMemorySettings!: AgentMemorySettingsManager;
let agentMemoryKnowledgeSettings!: AgentMemoryKnowledgeSettingsManager;
const agentMemoryRuntime = new TencentMemoryRuntimeSupervisor({
  runtimeRoot: join(dataDir, 'agent-memory-runtime'),
  settings: () => agentMemorySettings.settingsSnapshot(),
  environment: { ...process.env, READY4VIBE_DATA_DIR: dataDir },
});
try {
  agentMemorySettings = new AgentMemorySettingsManager({
    settings: settingsStore,
    runtime: agentMemoryRuntime,
    // Proxy fallback is captured per run without exposing the model secret to
    // settings, Web responses, events, or the memory sidecar state directory.
    modelProviderFactory: () => modelSettings.provider.snapshot(),
  });
  agentMemoryKnowledgeSettings = new AgentMemoryKnowledgeSettingsManager({
    settings: settingsStore,
    environment: process.env,
  });
} catch (error) {
  if (agentMemorySettings) await agentMemorySettings.close().catch(() => undefined);
  await observabilityLedger.close();
  settingsStore.close();
  goalEventStore.close();
  eventStore.close();
  throw error;
}
const toolSettings = new InMemoryToolSettingsManager(workspaceRegistry);
const gitSettings = new InMemoryGitSettingsManager({ workspaceRegistry });
const sandboxSettings = new InMemorySandboxSettingsManager({ workspaceRegistry });
// MCP remains explicitly disabled and has no default probe/transport. Web can
// persist non-secret intent and request a later injected probe without causing
// a child process or network request during daemon startup.
const mcpSettings = new McpSettingsManager({ settings: settingsStore });
const capabilityProfileSettings = new DurableCapabilityProfileSettingsManager({
  settings: settingsStore,
  policy: () => createCapabilityProfilePolicy({
    transportMode,
    modelSettings,
    toolSettings,
    sandboxSettings,
    mcpSettings,
    workspaceRegistry,
  }),
});
// R4 is opt-in: until an application service activates a verified snapshot,
// this manager contributes no runtime and performs no transport side effect.
const mcpRuntimeBinding = new McpRunBindingManager(workspaceRegistry);
const runManager = new RunManager({
  eventStore,
  modelProvider: modelSettings.provider,
  modelProviderForRun: () => modelSettings.provider.snapshot(),
  modelBindingForRun: (config) => modelSettings.bindRun(config.model),
  toolRuntimeForRun: (config) => composeToolRuntimes([toolSettings.runtimeForRun(config), gitSettings.runtimeForRun(config), sandboxSettings.runtimeForRun(config), mcpRuntimeBinding.runtimeForRun(config)]),
  workspaceExists: (workspaceId) => workspaceRegistry.resolveRoot(workspaceId) !== undefined,
  agentMemorySettings,
  agentMemoryKnowledgeSettings,
  observabilityUsageObserver,
  scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
});
try {
  await runManager.recoverAfterRestart();
  await agentMemorySettings.start();
} catch (error) {
  await mcpRuntimeBinding.close();
  await agentMemorySettings.close();
  await agentMemoryKnowledgeSettings.close();
  await observabilityLedger.close();
  settingsStore.close();
  goalEventStore.close();
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
  certificateReadiness,
  deploymentReadiness,
  modelSettings,
  toolSettings,
  gitSettings,
  sandboxSettings,
  workspaceRegistry,
  observabilityLedger,
  agentMemorySettings,
  agentMemoryKnowledgeSettings,
  mcpSettings,
  capabilityProfileSettings,
  webDistDir: process.env.READY4VIBE_WEB_DIST_DIR ?? join(process.cwd(), 'apps', 'web', 'dist'),
  goalEventStore,
  goalWriteService,
  ...(tlsCredentials ? { tls: tlsCredentials } : {}),
});

server.listen(port, host, () => {
  const displayHost = host === '::1' ? `[${host}]` : host;
  console.log(`ready4vibe daemon listening on ${tlsCredentials ? 'https' : 'http'}://${displayHost}:${port}`);
});

const shutdown = (): void => {
  server.close(() => {
    void (async () => {
      await mcpRuntimeBinding.close();
      await agentMemorySettings.close();
      await agentMemoryKnowledgeSettings.close();
      await observabilityLedger.close();
      settingsStore.close();
      goalEventStore.close();
      eventStore.close();
    })().catch(() => {
      // Shutdown is best effort; the HTTP server has already stopped accepting work.
    });
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

function createCapabilityProfilePolicy(input: {
  transportMode: 'loopback' | 'lan' | 'tailscale' | 'ssh';
  modelSettings: InMemoryModelSettingsManager;
  toolSettings: InMemoryToolSettingsManager;
  sandboxSettings: InMemorySandboxSettingsManager;
  mcpSettings: McpSettingsManager;
  workspaceRegistry: InMemoryWorkspaceRegistry;
}): CapabilityProfilePolicy {
  const transport = input.transportMode === 'loopback' ? 'loopback'
    : input.transportMode === 'lan' ? 'lan-tls' : input.transportMode;
  const model = input.modelSettings.status();
  const tools = input.toolSettings.status();
  const sandbox = input.sandboxSettings.status();
  const mcp = input.mcpSettings.status();
  const workspaceReady = input.workspaceRegistry.status().workspaces.length > 0;
  return {
    policyRevision: 'daemon-policy-1',
    transportModes: [transport],
    modelModes: model.configured ? ['off', 'fake', 'configured'] : ['off', 'fake'],
    filesystemModes: tools.filesystemEnabled ? ['off', 'workspace-read', 'workspace-write'] : ['off'],
    shellModes: sandbox.enabled ? ['off', 'external-sandbox'] : ['off'],
    networkModes: ['off', 'restricted'],
    mcpSkillModes: mcp.available ? ['off', 'configured'] : ['off'],
    approvalModes: ['none', 'on-request'],
    transportHealth: { [transport]: 'ready' },
    workspaceHealth: workspaceReady ? 'ready' : 'missing',
    modelHealth: model.configured ? 'ready' : 'missing',
    filesystemHealth: tools.filesystemEnabled ? 'ready' : 'missing',
    externalSandboxHealth: sandbox.enabled && sandbox.healthy ? 'ready' : 'missing',
    hostRunnerHealth: 'missing',
    networkHealth: 'off',
    mcpSkillHealth: mcp.available ? 'ready' : mcp.settings.enabled ? 'degraded' : 'missing',
  };
}
