import { StrictMode, useEffect, useRef, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, DEFAULT_RUN_PROFILE, loadRunProfile, resetRunProfile, saveRunProfile, type AgentMemoryKnowledgeSettingsPatchInput, type AgentMemoryKnowledgeSettingsStatus, type AgentMemoryOperationsStatus, type AgentMemorySettingsPatchInput, type AgentMemorySettingsStatus, type AuditEventsResponse, type CapabilityProfileSettingsPatchInput, type CapabilityProfileSettingsStatus, type CertificateStatus, type DeploymentReadinessStatus, type GitSettingsStatus, type GoalProjectionListResponse, type HealthResponse, type McpSettingsPatchInput, type McpSettingsStatus, type ModelProbeResult, type ModelSettingsInput, type ModelSettingsStatus, type SandboxSettingsStatus, type ToolSettingsStatus, type UsageSummary, type WorkspaceRegistryStatus, type RunProfile, type RunSnapshot, type StoredEvent, type RunConfigInput } from './api.js';
import { App } from './App.js';
import { applyLocaleToDocument, loadLocale, saveLocale, type Locale } from './locale.js';

const client = new ApiClient(import.meta.env.VITE_READY4VIBE_API_BASE_URL ?? '');

function RuntimeApp(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse>();
  const [run, setRun] = useState<RunSnapshot>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string>();
  const [profile, setProfile] = useState<RunProfile>(() => loadRunProfile());
  const [locale, setLocale] = useState<Locale>(() => loadLocale());
  const [certificateStatus, setCertificateStatus] = useState<CertificateStatus>();
  const [certificateStatusUnavailable, setCertificateStatusUnavailable] = useState(false);
  const [deploymentReadiness, setDeploymentReadiness] = useState<DeploymentReadinessStatus>();
  const [deploymentReadinessUnavailable, setDeploymentReadinessUnavailable] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettingsStatus>();
  const [modelSettingsUnavailable, setModelSettingsUnavailable] = useState(false);
  const [modelProbe, setModelProbe] = useState<ModelProbeResult>();
  const [capabilityProfileSettings, setCapabilityProfileSettings] = useState<CapabilityProfileSettingsStatus>();
  const [capabilityProfileSettingsUnavailable, setCapabilityProfileSettingsUnavailable] = useState(false);
  const [agentMemorySettings, setAgentMemorySettings] = useState<AgentMemorySettingsStatus>();
  const [agentMemorySettingsUnavailable, setAgentMemorySettingsUnavailable] = useState(false);
  const [agentMemoryOperations, setAgentMemoryOperations] = useState<AgentMemoryOperationsStatus>();
  const [agentMemoryKnowledgeSettings, setAgentMemoryKnowledgeSettings] = useState<AgentMemoryKnowledgeSettingsStatus>();
  const [agentMemoryKnowledgeSettingsUnavailable, setAgentMemoryKnowledgeSettingsUnavailable] = useState(false);
  const [mcpSettings, setMcpSettings] = useState<McpSettingsStatus>();
  const [mcpSettingsUnavailable, setMcpSettingsUnavailable] = useState(false);
  const [toolSettings, setToolSettings] = useState<ToolSettingsStatus>();
  const [toolSettingsUnavailable, setToolSettingsUnavailable] = useState(false);
  const [gitSettings, setGitSettings] = useState<GitSettingsStatus>();
  const [gitSettingsUnavailable, setGitSettingsUnavailable] = useState(false);
  const [sandboxSettings, setSandboxSettings] = useState<SandboxSettingsStatus>();
  const [sandboxSettingsUnavailable, setSandboxSettingsUnavailable] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceRegistryStatus>();
  const [workspacesUnavailable, setWorkspacesUnavailable] = useState(false);
  const [goalProjection, setGoalProjection] = useState<GoalProjectionListResponse>();
  const [goalProjectionLoading, setGoalProjectionLoading] = useState(true);
  const [goalProjectionUnavailable, setGoalProjectionUnavailable] = useState(false);
  const [goalProjectionRefreshing, setGoalProjectionRefreshing] = useState(false);
  const goalRefreshInFlight = useRef(false);
  const [usageSummary, setUsageSummary] = useState<UsageSummary>();
  const [auditEvents, setAuditEvents] = useState<AuditEventsResponse>();
  const [observabilityLoading, setObservabilityLoading] = useState(true);
  const [observabilityUnavailable, setObservabilityUnavailable] = useState(false);
  const [observabilityRefreshing, setObservabilityRefreshing] = useState(false);
  const observabilityRefreshInFlight = useRef(false);

  useEffect(() => {
    saveRunProfile(profile);
  }, [profile]);

  useEffect(() => {
    saveLocale(locale);
    applyLocaleToDocument(locale);
  }, [locale]);

  const refreshCertificateStatus = async (): Promise<void> => {
    try {
      setCertificateStatus(await client.certificateStatus());
      setCertificateStatusUnavailable(false);
    } catch (reason) {
      setCertificateStatus(undefined);
      setCertificateStatusUnavailable(isCertificateStatusUnavailable(reason));
    }
  };

  const refreshModelSettings = async (): Promise<void> => {
    try {
      setModelSettings(await client.modelSettings());
      setModelSettingsUnavailable(false);
    } catch (reason) {
      setModelSettings(undefined);
      setModelSettingsUnavailable(isModelSettingsUnavailable(reason));
    }
  };

  const refreshCapabilityProfileSettings = async (): Promise<void> => {
    try {
      setCapabilityProfileSettings(await client.capabilityProfileSettings());
      setCapabilityProfileSettingsUnavailable(false);
    } catch (reason) {
      setCapabilityProfileSettings(undefined);
      setCapabilityProfileSettingsUnavailable(isCapabilityProfileSettingsUnavailable(reason));
    }
  };

  const refreshAgentMemorySettings = async (): Promise<void> => {
    try {
      setAgentMemorySettings(await client.agentMemorySettings());
      setAgentMemorySettingsUnavailable(false);
    } catch (reason) {
      setAgentMemorySettings(undefined);
      setAgentMemorySettingsUnavailable(isAgentMemorySettingsUnavailable(reason));
    }
  };

  const refreshAgentMemoryOperations = async (): Promise<void> => {
    try { setAgentMemoryOperations(await client.agentMemoryOperations()); }
    catch { setAgentMemoryOperations(undefined); }
  };

  const refreshAgentMemoryKnowledgeSettings = async (): Promise<void> => {
    try {
      setAgentMemoryKnowledgeSettings(await client.agentMemoryKnowledgeSettings());
      setAgentMemoryKnowledgeSettingsUnavailable(false);
    } catch (reason) {
      setAgentMemoryKnowledgeSettings(undefined);
      setAgentMemoryKnowledgeSettingsUnavailable(isAgentMemoryKnowledgeSettingsUnavailable(reason));
    }
  };

  const refreshMcpSettings = async (): Promise<void> => {
    try {
      setMcpSettings(await client.mcpSettings());
      setMcpSettingsUnavailable(false);
    } catch (reason) {
      setMcpSettings(undefined);
      setMcpSettingsUnavailable(isMcpSettingsUnavailable(reason));
    }
  };

  const refreshToolSettings = async (): Promise<void> => {
    try {
      setToolSettings(await client.toolSettings());
      setToolSettingsUnavailable(false);
    } catch (reason) {
      setToolSettings(undefined);
      setToolSettingsUnavailable(isToolSettingsUnavailable(reason));
    }
  };

  const refreshSandboxSettings = async (): Promise<void> => {
    try {
      setSandboxSettings(await client.sandboxSettings());
      setSandboxSettingsUnavailable(false);
    } catch (reason) {
      setSandboxSettings(undefined);
      setSandboxSettingsUnavailable(isSandboxSettingsUnavailable(reason));
    }
  };

  const refreshGitSettings = async (): Promise<void> => {
    try {
      setGitSettings(await client.gitSettings());
      setGitSettingsUnavailable(false);
    } catch (reason) {
      setGitSettings(undefined);
      setGitSettingsUnavailable(isGitSettingsUnavailable(reason));
    }
  };

  const refreshWorkspaces = async (): Promise<void> => {
    try {
      setWorkspaces(await client.workspaces());
      setWorkspacesUnavailable(false);
    } catch (reason) {
      setWorkspaces(undefined);
      setWorkspacesUnavailable(isWorkspacesUnavailable(reason));
    }
  };

  const refreshGoalProjection = async (): Promise<void> => {
    if (goalRefreshInFlight.current) return;
    goalRefreshInFlight.current = true;
    const hasExistingProjection = goalProjection !== undefined;
    if (hasExistingProjection) setGoalProjectionRefreshing(true);
    else setGoalProjectionLoading(true);
    try {
      setGoalProjection(await client.listGoals());
      setGoalProjectionUnavailable(false);
    } catch {
      setGoalProjection(undefined);
      setGoalProjectionUnavailable(true);
    } finally {
      setGoalProjectionLoading(false);
      setGoalProjectionRefreshing(false);
      goalRefreshInFlight.current = false;
    }
  };

  const refreshObservability = async (): Promise<void> => {
    if (observabilityRefreshInFlight.current) return;
    observabilityRefreshInFlight.current = true;
    const hasExisting = usageSummary !== undefined || auditEvents !== undefined;
    if (hasExisting) setObservabilityRefreshing(true);
    else setObservabilityLoading(true);
    const [summaryResult, auditResult] = await Promise.allSettled([client.usageSummary('24h'), client.auditEvents()]);
    if (summaryResult.status === 'fulfilled') setUsageSummary(summaryResult.value);
    else setUsageSummary(undefined);
    if (auditResult.status === 'fulfilled') setAuditEvents(auditResult.value);
    else setAuditEvents(undefined);
    setObservabilityUnavailable(summaryResult.status === 'rejected' && auditResult.status === 'rejected');
    setObservabilityLoading(false);
    setObservabilityRefreshing(false);
    observabilityRefreshInFlight.current = false;
  };

  useEffect(() => {
    void client.health().then((nextHealth) => {
      setHealth(nextHealth);
      if (!nextHealth.auth.pairingRequired) {
        void refreshCertificateStatus();
        void refreshDeploymentReadiness();
        void refreshModelSettings();
        void refreshCapabilityProfileSettings();
        void refreshAgentMemorySettings();
        void refreshAgentMemoryOperations();
        void refreshAgentMemoryKnowledgeSettings();
        void refreshMcpSettings();
        void refreshToolSettings();
        void refreshGitSettings();
        void refreshSandboxSettings();
        void refreshWorkspaces();
        void refreshGoalProjection();
        void refreshObservability();
      }
    }).catch((reason: unknown) => setError(safeError(reason)));
  }, []);

  const pair = async (code: string): Promise<void> => {
    try {
      await client.completePairing(code);
      setError(undefined);
      setHealth(await client.health());
      await refreshCertificateStatus();
      await refreshDeploymentReadiness();
      await refreshModelSettings();
      await refreshCapabilityProfileSettings();
      await refreshAgentMemorySettings();
      await refreshAgentMemoryOperations();
      await refreshAgentMemoryKnowledgeSettings();
      await refreshMcpSettings();
      await refreshToolSettings();
      await refreshGitSettings();
      await refreshSandboxSettings();
      await refreshWorkspaces();
      await refreshGoalProjection();
      await refreshObservability();
    } catch (reason) { setError(safeError(reason)); }
  };

  const watchRun = async (runId: string, initial: RunSnapshot): Promise<void> => {
    setRun(initial);
    setEvents([]);
    for await (const event of client.streamEvents(runId, initial.lastEventSeq)) {
      setEvents((current) => current.some((item) => item.seq === event.seq) ? current : [...current, event]);
      if (event.type === 'model.delta') setRun((current) => current ? { ...current, output: `${current.output}${readTextDelta(event.payload)}`, lastEventSeq: event.seq } : current);
      else setRun((current) => current ? { ...current, lastEventSeq: event.seq } : current);
      if (event.type === 'approval.required' || event.type === 'approval.decided' || event.type === 'approval.expired' || event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled' || event.type === 'run.needs_recovery') setRun(await client.getRun(runId));
    }
    await refreshGoalProjection();
    await refreshAgentMemoryOperations();
    await refreshObservability();
  };

  const createRun = async (message: string): Promise<void> => {
    try {
      const config: RunConfigInput = {
        ...profile, userMessage: message, createdBySessionId: 'web-memory-session', clientRequestId: crypto.randomUUID(),
      };
      const started = await client.createRun(config);
      await watchRun(started.runId, await client.getRun(started.runId));
    } catch (reason) { setError(safeError(reason)); }
  };

  const retry = async (): Promise<void> => {
    if (!run) return;
    try {
      const started = await client.retryRun(run.runId);
      await watchRun(started.runId, await client.getRun(started.runId));
    } catch (reason) { setError(safeError(reason)); }
  };

  const cancel = async (): Promise<void> => {
    if (!run) return;
    try { await client.cancel(run.runId); setRun(await client.getRun(run.runId)); } catch (reason) { setError(safeError(reason)); }
  };

  const approve = async (approvalId: string, decision: 'allow' | 'deny'): Promise<void> => {
    if (!run) return;
    try { await client.approveRun(run.runId, approvalId, decision); setRun(await client.getRun(run.runId)); } catch (reason) { setError(safeError(reason)); }
  };

  const configureModel = async (input: ModelSettingsInput): Promise<void> => {
    try {
      const status = await client.configureModel(input);
      setModelSettings(status);
      setModelSettingsUnavailable(false);
      setProfile((current) => ({ ...current, model: { provider: input.provider, name: input.model } }));
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const patchCapabilityProfileSettings = async (input: CapabilityProfileSettingsPatchInput): Promise<void> => {
    try {
      setCapabilityProfileSettings(await client.patchCapabilityProfileSettings(input));
      setCapabilityProfileSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const resetCapabilityProfileSettings = async (expectedRevision?: string): Promise<void> => {
    try {
      setCapabilityProfileSettings(await client.resetCapabilityProfileSettings(expectedRevision));
      setCapabilityProfileSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const clearModelSettings = async (): Promise<void> => {
    try {
      const status = await client.clearModelSettings();
      setModelSettings(status);
      setModelSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); }
  };

  const probeModel = async (endpoint: string): Promise<void> => {
    try {
      setModelProbe(await client.probeModel(endpoint));
      setError(undefined);
    } catch (reason) {
      setModelProbe(undefined);
      setError(safeError(reason));
      throw reason;
    }
  };

  const refreshDeploymentReadiness = async (): Promise<void> => {
    try {
      setDeploymentReadiness(await client.deploymentReadiness());
      setDeploymentReadinessUnavailable(false);
    } catch {
      setDeploymentReadiness(undefined);
      setDeploymentReadinessUnavailable(true);
    }
  };

  const patchAgentMemorySettings = async (input: AgentMemorySettingsPatchInput): Promise<void> => {
    try {
      setAgentMemorySettings(await client.patchAgentMemorySettings(input));
      setAgentMemorySettingsUnavailable(false);
      await refreshAgentMemoryOperations();
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const probeAgentMemory = async (): Promise<void> => {
    try {
      setAgentMemorySettings(await client.probeAgentMemory());
      setAgentMemorySettingsUnavailable(false);
      await refreshAgentMemoryOperations();
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const updateAgentMemory = async (): Promise<void> => {
    try {
      setAgentMemorySettings(await client.updateAgentMemory());
      setAgentMemorySettingsUnavailable(false);
      await refreshAgentMemoryOperations();
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const rollbackAgentMemory = async (): Promise<void> => {
    try {
      setAgentMemorySettings(await client.rollbackAgentMemory());
      setAgentMemorySettingsUnavailable(false);
      await refreshAgentMemoryOperations();
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const patchAgentMemoryKnowledgeSettings = async (input: AgentMemoryKnowledgeSettingsPatchInput): Promise<void> => {
    try {
      setAgentMemoryKnowledgeSettings(await client.patchAgentMemoryKnowledgeSettings(input));
      setAgentMemoryKnowledgeSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const probeAgentMemoryKnowledge = async (): Promise<void> => {
    try {
      setAgentMemoryKnowledgeSettings(await client.probeAgentMemoryKnowledge());
      setAgentMemoryKnowledgeSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const patchMcpSettings = async (input: McpSettingsPatchInput): Promise<void> => {
    try {
      setMcpSettings(await client.patchMcpSettings(input));
      setMcpSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const probeMcp = async (): Promise<void> => {
    try {
      setMcpSettings(await client.probeMcp());
      setMcpSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const setFilesystemToolsEnabled = async (enabled: boolean): Promise<void> => {
    try {
      setToolSettings(await client.setFilesystemToolsEnabled(enabled));
      setToolSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const setGitToolsEnabled = async (enabled: boolean): Promise<void> => {
    try {
      setGitSettings(await client.setGitToolsEnabled(enabled));
      setGitSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const probeSandbox = async (provider: 'docker' | 'podman'): Promise<void> => {
    try {
      setSandboxSettings(await client.probeSandbox(provider));
      setSandboxSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const setSandboxSettingsFromWeb = async (input: { provider: 'docker' | 'podman'; imageDigest: string; network: 'restricted' | 'enabled'; resources: SandboxSettingsStatus['resources']; enabled: boolean }): Promise<void> => {
    try {
      setSandboxSettings(await client.setSandboxSettings(input));
      setSandboxSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const addWorkspace = async (input: { id: string; path: string; label?: string }): Promise<void> => {
    try {
      setWorkspaces(await client.addWorkspace(input));
      setWorkspacesUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const removeWorkspace = async (workspaceId: string): Promise<void> => {
    try {
      const next = await client.removeWorkspace(workspaceId);
      setWorkspaces(next);
      setWorkspacesUnavailable(false);
      if (profile.workspaceId === workspaceId) {
        const fallback = next.workspaces.find((workspace) => workspace.isDefault) ?? next.workspaces[0];
        if (fallback) setProfile((current) => ({ ...current, workspaceId: fallback.id }));
      }
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); throw reason; }
  };

  const resetProfile = (): void => {
    resetRunProfile();
    setProfile(DEFAULT_RUN_PROFILE);
  };

  return <App {...(health ? { health } : {})} {...(run ? { run } : {})} events={events} {...(error ? { error } : {})} locale={locale} onLocaleChange={setLocale} profile={profile} {...(capabilityProfileSettings ? { capabilityProfileSettings } : {})} capabilityProfileSettingsUnavailable={capabilityProfileSettingsUnavailable} {...(certificateStatus ? { certificateStatus } : {})} certificateStatusUnavailable={certificateStatusUnavailable} {...(deploymentReadiness ? { deploymentReadiness } : {})} deploymentReadinessUnavailable={deploymentReadinessUnavailable} {...(modelSettings ? { modelSettings } : {})} modelSettingsUnavailable={modelSettingsUnavailable} {...(modelProbe ? { modelProbe } : {})} {...(agentMemorySettings ? { agentMemorySettings } : {})} agentMemorySettingsUnavailable={agentMemorySettingsUnavailable} {...(agentMemoryOperations ? { agentMemoryOperations } : {})} {...(agentMemoryKnowledgeSettings ? { agentMemoryKnowledgeSettings } : {})} agentMemoryKnowledgeSettingsUnavailable={agentMemoryKnowledgeSettingsUnavailable} {...(mcpSettings ? { mcpSettings } : {})} mcpSettingsUnavailable={mcpSettingsUnavailable} {...(toolSettings ? { toolSettings } : {})} toolSettingsUnavailable={toolSettingsUnavailable} {...(gitSettings ? { gitSettings } : {})} gitSettingsUnavailable={gitSettingsUnavailable} {...(sandboxSettings ? { sandboxSettings } : {})} sandboxSettingsUnavailable={sandboxSettingsUnavailable} {...(workspaces ? { workspaces } : {})} workspacesUnavailable={workspacesUnavailable} {...(goalProjection ? { goalProjection } : {})} goalProjectionLoading={goalProjectionLoading} goalProjectionUnavailable={goalProjectionUnavailable} goalProjectionRefreshing={goalProjectionRefreshing} onRefreshGoalProjection={refreshGoalProjection} {...(usageSummary ? { usageSummary } : {})} {...(auditEvents ? { auditEvents } : {})} observabilityLoading={observabilityLoading} observabilityUnavailable={observabilityUnavailable} observabilityRefreshing={observabilityRefreshing} onProfileChange={setProfile} onResetProfile={resetProfile} onPair={pair} onCreateRun={createRun} onCancel={cancel} onApprove={approve} onRetry={retry} onConfigureModel={configureModel} onClearModelSettings={clearModelSettings} onProbeModel={probeModel} onPatchCapabilityProfileSettings={patchCapabilityProfileSettings} onResetCapabilityProfileSettings={resetCapabilityProfileSettings} onPatchAgentMemorySettings={patchAgentMemorySettings} onProbeAgentMemory={probeAgentMemory} onUpdateAgentMemory={updateAgentMemory} onRollbackAgentMemory={rollbackAgentMemory} onPatchAgentMemoryKnowledgeSettings={patchAgentMemoryKnowledgeSettings} onProbeAgentMemoryKnowledge={probeAgentMemoryKnowledge} onPatchMcpSettings={patchMcpSettings} onProbeMcp={probeMcp} onSetFilesystemToolsEnabled={setFilesystemToolsEnabled} onSetGitToolsEnabled={setGitToolsEnabled} onProbeSandbox={probeSandbox} onSetSandboxSettings={setSandboxSettingsFromWeb} onAddWorkspace={addWorkspace} onRemoveWorkspace={removeWorkspace} />;
}

function readTextDelta(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && 'text' in payload && typeof payload.text === 'string' ? payload.text : '';
}

function safeError(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') return `请求失败：${reason.code}`;
  return '请求失败，请检查 daemon 连接。';
}

function isCertificateStatusUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'CERTIFICATE_STATUS_UNAVAILABLE';
}

function isModelSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'MODEL_SETTINGS_UNAVAILABLE';
}

function isCapabilityProfileSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'CAPABILITY_PROFILE_SETTINGS_UNAVAILABLE';
}

function isAgentMemorySettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'AGENT_MEMORY_SETTINGS_UNAVAILABLE';
}

function isAgentMemoryKnowledgeSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'AGENT_MEMORY_KNOWLEDGE_SETTINGS_UNAVAILABLE';
}

function isMcpSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'MCP_SETTINGS_UNAVAILABLE';
}

function isToolSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'TOOL_SETTINGS_UNAVAILABLE';
}

function isGitSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'GIT_SETTINGS_UNAVAILABLE';
}

function isSandboxSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'SANDBOX_SETTINGS_UNAVAILABLE';
}

function isWorkspacesUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'WORKSPACES_UNAVAILABLE';
}

createRoot(document.getElementById('root')!).render(<StrictMode><RuntimeApp /></StrictMode>);
