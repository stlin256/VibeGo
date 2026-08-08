import { StrictMode, useEffect, useRef, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, DEFAULT_RUN_PROFILE, loadRunProfile, resetRunProfile, saveRunProfile, type AgentMemoryKnowledgeSettingsPatchInput, type AgentMemoryKnowledgeSettingsStatus, type AgentMemoryOperationsStatus, type AgentMemorySettingsPatchInput, type AgentMemorySettingsStatus, type ApprovalReviewSettingsPatchInput, type ApprovalReviewSettingsStatus, type AuditEventsResponse, type CapabilityProfileSettingsPatchInput, type CapabilityProfileSettingsStatus, type CertificateStatus, type DeepSeekProbeResult, type DeepSeekSettingsInput, type DeepSeekSettingsStatus, type DeploymentReadinessStatus, type GitSettingsStatus, type GoalProjectionListResponse, type GovernedPreflightInput, type HealthResponse, type McpSettingsPatchInput, type McpSettingsStatus, type ModelProbeResult, type ModelSettingsInput, type ModelSettingsStatus, type PermissionConfirmationInput, type PermissionProfileSettingsPatchInput, type PermissionProfileSettingsStatus, type PermissionStatus, type PermissionRevokeInput, type SandboxSettingsStatus, type ToolSettingsStatus, type UsageSummary, type WorkspaceRegistryStatus, type RunProfile, type RunSnapshot, type RunSummary, type StoredEvent, type RunConfigInput, type GoalMutationResponse, type GoalPreflightResult } from './api.js';
import { App } from './App.js';
import { applyLocaleToDocument, createTranslator, loadLocale, saveLocale, type Locale, type Translator } from './locale.js';
import { applyThemeToDocument, loadTheme, saveTheme, type Theme } from './theme.js';
import { createStreamBuffer, type StreamBuffer } from './streamBuffer.js';

const client = new ApiClient(import.meta.env.VITE_READY4VIBE_API_BASE_URL ?? '');

function RuntimeApp(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse>();
  const [sessionReady, setSessionReady] = useState(false);
  const [run, setRun] = useState<RunSnapshot>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [runHistory, setRunHistory] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string>();
  const [profile, setProfile] = useState<RunProfile>(() => loadRunProfile());
  const [locale, setLocale] = useState<Locale>(() => loadLocale());
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const t = createTranslator(locale);
  const [certificateStatus, setCertificateStatus] = useState<CertificateStatus>();
  const [certificateStatusUnavailable, setCertificateStatusUnavailable] = useState(false);
  const [deploymentReadiness, setDeploymentReadiness] = useState<DeploymentReadinessStatus>();
  const [deploymentReadinessUnavailable, setDeploymentReadinessUnavailable] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettingsStatus>();
  const [modelSettingsUnavailable, setModelSettingsUnavailable] = useState(false);
  const [modelProbe, setModelProbe] = useState<ModelProbeResult>();
  const [deepSeekSettings, setDeepSeekSettings] = useState<DeepSeekSettingsStatus>();
  const [deepSeekSettingsUnavailable, setDeepSeekSettingsUnavailable] = useState(false);
  const [deepSeekProbe, setDeepSeekProbe] = useState<DeepSeekProbeResult>();
  const [capabilityProfileSettings, setCapabilityProfileSettings] = useState<CapabilityProfileSettingsStatus>();
  const [capabilityProfileSettingsUnavailable, setCapabilityProfileSettingsUnavailable] = useState(false);
  const [permissionSettings, setPermissionSettings] = useState<PermissionProfileSettingsStatus>();
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>();
  const [permissionSettingsUnavailable, setPermissionSettingsUnavailable] = useState(false);
  const [approvalReviewSettings, setApprovalReviewSettings] = useState<ApprovalReviewSettingsStatus>();
  const [approvalReviewSettingsUnavailable, setApprovalReviewSettingsUnavailable] = useState(false);
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

  useEffect(() => {
    saveTheme(theme);
    applyThemeToDocument(theme);
  }, [theme]);

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

  const refreshDeepSeekSettings = async (): Promise<void> => {
    try {
      setDeepSeekSettings(await client.deepSeekSettings());
      setDeepSeekSettingsUnavailable(false);
    } catch (reason) {
      setDeepSeekSettings(undefined);
      setDeepSeekSettingsUnavailable(isDeepSeekSettingsUnavailable(reason));
    }
  };

  const refreshPermissionSettings = async (): Promise<void> => {
    const [settingsResult, statusResult] = await Promise.allSettled([client.permissionSettings(), client.permissionStatus()]);
    if (settingsResult.status === 'fulfilled') setPermissionSettings(settingsResult.value);
    else setPermissionSettings(undefined);
    if (statusResult.status === 'fulfilled') setPermissionStatus(statusResult.value);
    else setPermissionStatus(undefined);
    const unavailable = settingsResult.status === 'rejected' && statusResult.status === 'rejected' && isPermissionSettingsUnavailable(settingsResult.reason) && isPermissionSettingsUnavailable(statusResult.reason);
    setPermissionSettingsUnavailable(unavailable);
  };

  const refreshPermissionStatus = async (): Promise<void> => {
    try {
      setPermissionStatus(await client.permissionStatus());
      setPermissionSettingsUnavailable(false);
    } catch (reason) {
      setPermissionStatus(undefined);
      setPermissionSettingsUnavailable(isPermissionSettingsUnavailable(reason));
    }
  };

  const refreshApprovalReviewSettings = async (): Promise<void> => {
    try {
      setApprovalReviewSettings(await client.approvalReviewSettings());
      setApprovalReviewSettingsUnavailable(false);
    } catch (reason) {
      setApprovalReviewSettings(undefined);
      setApprovalReviewSettingsUnavailable(isApprovalReviewSettingsUnavailable(reason));
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

  const createGoal = async (input: { title: string; objective: string; workspaceId?: string }): Promise<GoalMutationResponse> => client.createGoal(input);
  const addGoalTodo = async (goalId: string, input: { expectedRevision: number; title: string }): Promise<GoalMutationResponse> => client.addGoalTodo(goalId, input);
  const openGoalGate = async (goalId: string, input: { expectedRevision: number; question: string }): Promise<GoalMutationResponse> => client.openGoalGate(goalId, input);
  const resolveGoalGate = async (goalId: string, gateId: string, input: { expectedRevision: number; status: 'approved' | 'rejected' | 'deferred' | 'expired' }): Promise<GoalMutationResponse> => client.resolveGoalGate(goalId, gateId, input);
  const attachGoalEvidence = async (goalId: string, input: { expectedRevision: number; summary: string }): Promise<GoalMutationResponse> => client.attachGoalEvidence(goalId, input);
  const preflightGoal = async (goalId: string, todoId: string, expectedControlRevision: number): Promise<GoalPreflightResult> => {
    const uuid = crypto.randomUUID().replaceAll('-', '');
    const request: GovernedPreflightInput = {
      ...profile,
      userMessage: 'Preflight only; do not start a run.',
      createdBySessionId: 'web-memory-session',
      clientRequestId: `client_web_${uuid}`,
      runMode: 'governed',
      goalId,
      todoId,
      expectedControlRevision,
      agentId: 'vibego-local-agent',
      turnKey: `turn_web_${uuid}`,
      requestId: `request_web_${uuid}`,
    };
    const { goalId: _goalId, ...withoutGoalId } = request;
    return client.preflightGoal(goalId, withoutGoalId);
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
    client.onAuthFailure = () => setSessionReady(false);
    void client.health().then((nextHealth) => {
      setHealth(nextHealth);
      if (client.hasSession()) {
        setSessionReady(true);
        void refreshCertificateStatus();
        void refreshDeploymentReadiness();
        void refreshModelSettings();
        void refreshDeepSeekSettings();
        void refreshCapabilityProfileSettings();
        void refreshPermissionSettings();
        void refreshApprovalReviewSettings();
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
        void refreshRunHistory();
      }
    }).catch((reason: unknown) => setError(safeError(reason, t)));
  }, []);

  const completeSignIn = async (): Promise<void> => {
    setSessionReady(true);
    setError(undefined);
    setHealth(await client.health());
    await refreshCertificateStatus();
    await refreshDeploymentReadiness();
    await refreshModelSettings();
    await refreshDeepSeekSettings();
    await refreshCapabilityProfileSettings();
    await refreshPermissionSettings();
    await refreshApprovalReviewSettings();
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
    await refreshRunHistory();
  };

  const createAccount = async (password: string): Promise<void> => {
    try {
      await client.createAccount(password);
      await completeSignIn();
    } catch (reason) { setError(safeError(reason, t)); }
  };

  const loginWithPassword = async (password: string): Promise<void> => {
    try {
      await client.loginWithPassword(password);
      await completeSignIn();
    } catch (reason) { setError(safeError(reason, t)); }
  };

  const streamBufferRef = useRef<StreamBuffer | undefined>(undefined);
  const getStreamBuffer = (): StreamBuffer => {
    streamBufferRef.current ??= createStreamBuffer((batch) => {
      if (batch.events.length > 0) setEvents((current) => {
        const seen = new Set(current.map((item) => item.seq));
        const fresh = batch.events.filter((item) => !seen.has(item.seq));
        return fresh.length > 0 ? [...current, ...fresh] : current;
      });
      setRun((current) => current ? { ...current, output: batch.text ? `${current.output}${batch.text}` : current.output, lastEventSeq: batch.lastEventSeq > current.lastEventSeq ? batch.lastEventSeq : current.lastEventSeq } : current);
    });
    return streamBufferRef.current;
  };

  const watchRun = async (runId: string, initial: RunSnapshot): Promise<void> => {
    setRun(initial);
    setEvents([]);
    const buffer = getStreamBuffer();
    buffer.reset();
    for await (const event of client.streamEvents(runId, initial.lastEventSeq)) {
      buffer.push(event, event.type === 'model.delta' ? readTextDelta(event.payload) : '');
      if (event.type === 'approval.required' || event.type === 'approval.decided' || event.type === 'approval.expired' || event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled' || event.type === 'run.needs_recovery') { buffer.flush(); setRun(await client.getRun(runId)); }
    }
    buffer.flush();
    await refreshGoalProjection();
    await refreshAgentMemoryOperations();
    await refreshObservability();
    await refreshRunHistory();
  };

  const refreshRunHistory = async (): Promise<void> => {
    try { setRunHistory((await client.listRuns()).runs); }
    catch { /* The history rail is optional; the conversation surface must not fail. */ }
  };

  const openRun = async (runId: string): Promise<void> => {
    try { await watchRun(runId, await client.getRun(runId)); }
    catch (reason) { setError(safeError(reason, t)); }
  };

  const newTask = (): void => {
    setRun(undefined);
    setEvents([]);
  };

  const createRun = async (message: string): Promise<void> => {
    try {
      const config: RunConfigInput = {
        ...profile, userMessage: message, createdBySessionId: 'web-memory-session', clientRequestId: crypto.randomUUID(),
      };
      const started = await client.createRun(config);
      await watchRun(started.runId, await client.getRun(started.runId));
    } catch (reason) { setError(safeError(reason, t)); }
  };

  const retry = async (): Promise<void> => {
    if (!run) return;
    try {
      const started = await client.retryRun(run.runId);
      await watchRun(started.runId, await client.getRun(started.runId));
    } catch (reason) { setError(safeError(reason, t)); }
  };

  const cancel = async (): Promise<void> => {
    if (!run) return;
    try { await client.cancel(run.runId); setRun(await client.getRun(run.runId)); } catch (reason) { setError(safeError(reason, t)); }
  };

  const approve = async (approvalId: string, decision: 'allow' | 'deny'): Promise<void> => {
    if (!run) return;
    try { await client.approveRun(run.runId, approvalId, decision); setRun(await client.getRun(run.runId)); } catch (reason) { setError(safeError(reason, t)); }
  };

  const configureModel = async (input: ModelSettingsInput): Promise<void> => {
    try {
      const status = await client.configureModel(input);
      setModelSettings(status);
      setModelSettingsUnavailable(false);
      setProfile((current) => ({ ...current, model: { provider: input.provider, name: input.model } }));
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const patchCapabilityProfileSettings = async (input: CapabilityProfileSettingsPatchInput): Promise<void> => {
    try {
      setCapabilityProfileSettings(await client.patchCapabilityProfileSettings(input));
      setCapabilityProfileSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const resetCapabilityProfileSettings = async (expectedRevision?: string): Promise<void> => {
    try {
      setCapabilityProfileSettings(await client.resetCapabilityProfileSettings(expectedRevision));
      setCapabilityProfileSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const patchPermissionSettings = async (input: PermissionProfileSettingsPatchInput): Promise<void> => {
    try {
      setPermissionSettings(await client.patchPermissionSettings(input));
      setPermissionSettingsUnavailable(false);
      await refreshPermissionStatus();
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const confirmFullHost = async (input: PermissionConfirmationInput): Promise<void> => {
    try {
      setPermissionStatus(await client.confirmFullHost(input));
      setPermissionSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const revokePermission = async (input: PermissionRevokeInput): Promise<void> => {
    try {
      await client.revokePermission(input);
      await refreshPermissionStatus();
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const patchApprovalReviewSettings = async (input: ApprovalReviewSettingsPatchInput): Promise<void> => {
    try {
      setApprovalReviewSettings(await client.patchApprovalReviewSettings(input));
      setApprovalReviewSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const probeApprovalReview = async (): Promise<void> => {
    try {
      setApprovalReviewSettings(await client.probeApprovalReview());
      setApprovalReviewSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const clearModelSettings = async (): Promise<void> => {
    try {
      const status = await client.clearModelSettings();
      setModelSettings(status);
      setModelSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); }
  };

  const probeModel = async (endpoint: string): Promise<void> => {
    try {
      setModelProbe(await client.probeModel(endpoint));
      setError(undefined);
    } catch (reason) {
      setModelProbe(undefined);
      setError(safeError(reason, t));
      throw reason;
    }
  };

  const configureDeepSeek = async (input: DeepSeekSettingsInput): Promise<void> => {
    try {
      setDeepSeekSettings(await client.configureDeepSeek(input));
      setDeepSeekSettingsUnavailable(false);
      setProfile((current) => ({ ...current, model: { provider: 'deepseek', name: input.model } }));
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const clearDeepSeekSettings = async (): Promise<void> => {
    try { setDeepSeekSettings(await client.clearDeepSeekSettings()); setDeepSeekProbe(undefined); setError(undefined); }
    catch (reason) { setError(safeError(reason, t)); }
  };

  const probeDeepSeek = async (): Promise<void> => {
    try { setDeepSeekProbe(await client.probeDeepSeek()); setError(undefined); }
    catch (reason) { setDeepSeekProbe(undefined); setError(safeError(reason, t)); throw reason; }
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
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const probeAgentMemory = async (): Promise<void> => {
    try {
      setAgentMemorySettings(await client.probeAgentMemory());
      setAgentMemorySettingsUnavailable(false);
      await refreshAgentMemoryOperations();
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const updateAgentMemory = async (): Promise<void> => {
    try {
      setAgentMemorySettings(await client.updateAgentMemory());
      setAgentMemorySettingsUnavailable(false);
      await refreshAgentMemoryOperations();
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const rollbackAgentMemory = async (): Promise<void> => {
    try {
      setAgentMemorySettings(await client.rollbackAgentMemory());
      setAgentMemorySettingsUnavailable(false);
      await refreshAgentMemoryOperations();
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const patchAgentMemoryKnowledgeSettings = async (input: AgentMemoryKnowledgeSettingsPatchInput): Promise<void> => {
    try {
      setAgentMemoryKnowledgeSettings(await client.patchAgentMemoryKnowledgeSettings(input));
      setAgentMemoryKnowledgeSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const probeAgentMemoryKnowledge = async (): Promise<void> => {
    try {
      setAgentMemoryKnowledgeSettings(await client.probeAgentMemoryKnowledge());
      setAgentMemoryKnowledgeSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const patchMcpSettings = async (input: McpSettingsPatchInput): Promise<void> => {
    try {
      setMcpSettings(await client.patchMcpSettings(input));
      setMcpSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const probeMcp = async (): Promise<void> => {
    try {
      setMcpSettings(await client.probeMcp());
      setMcpSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const setFilesystemToolsEnabled = async (enabled: boolean): Promise<void> => {
    try {
      setToolSettings(await client.setFilesystemToolsEnabled(enabled));
      setToolSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const setGitToolsEnabled = async (enabled: boolean): Promise<void> => {
    try {
      setGitSettings(await client.setGitToolsEnabled(enabled));
      setGitSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const probeSandbox = async (provider: 'docker' | 'podman'): Promise<void> => {
    try {
      setSandboxSettings(await client.probeSandbox(provider));
      setSandboxSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const setSandboxSettingsFromWeb = async (input: { provider: 'docker' | 'podman'; imageDigest: string; network: 'restricted' | 'enabled'; resources: SandboxSettingsStatus['resources']; enabled: boolean }): Promise<void> => {
    try {
      setSandboxSettings(await client.setSandboxSettings(input));
      setSandboxSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const addWorkspace = async (input: { id: string; path: string; label?: string }): Promise<void> => {
    try {
      setWorkspaces(await client.addWorkspace(input));
      setWorkspacesUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
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
    } catch (reason) { setError(safeError(reason, t)); throw reason; }
  };

  const resetProfile = (): void => {
    resetRunProfile();
    setProfile(DEFAULT_RUN_PROFILE);
  };

  return <App sessionReady={sessionReady} {...(health ? { health } : {})} {...(run ? { run } : {})} events={events} runHistory={runHistory} onOpenRun={(runId) => { void openRun(runId); }} onNewTask={newTask} {...(error ? { error } : {})} onDismissError={() => setError(undefined)} locale={locale} onLocaleChange={setLocale} theme={theme} onThemeChange={setTheme} onCreateAccount={createAccount} onLogin={loginWithPassword} profile={profile} {...(capabilityProfileSettings ? { capabilityProfileSettings } : {})} capabilityProfileSettingsUnavailable={capabilityProfileSettingsUnavailable} {...(permissionSettings ? { permissionSettings } : {})} {...(permissionStatus ? { permissionStatus } : {})} permissionSettingsUnavailable={permissionSettingsUnavailable} {...(approvalReviewSettings ? { approvalReviewSettings } : {})} approvalReviewSettingsUnavailable={approvalReviewSettingsUnavailable} {...(certificateStatus ? { certificateStatus } : {})} certificateStatusUnavailable={certificateStatusUnavailable} {...(deploymentReadiness ? { deploymentReadiness } : {})} deploymentReadinessUnavailable={deploymentReadinessUnavailable} {...(modelSettings ? { modelSettings } : {})} modelSettingsUnavailable={modelSettingsUnavailable} {...(modelProbe ? { modelProbe } : {})} {...(deepSeekSettings ? { deepSeekSettings } : {})} deepSeekSettingsUnavailable={deepSeekSettingsUnavailable} {...(deepSeekProbe ? { deepSeekProbe } : {})} {...(agentMemorySettings ? { agentMemorySettings } : {})} agentMemorySettingsUnavailable={agentMemorySettingsUnavailable} {...(agentMemoryOperations ? { agentMemoryOperations } : {})} {...(agentMemoryKnowledgeSettings ? { agentMemoryKnowledgeSettings } : {})} agentMemoryKnowledgeSettingsUnavailable={agentMemoryKnowledgeSettingsUnavailable} {...(mcpSettings ? { mcpSettings } : {})} mcpSettingsUnavailable={mcpSettingsUnavailable} {...(toolSettings ? { toolSettings } : {})} toolSettingsUnavailable={toolSettingsUnavailable} {...(gitSettings ? { gitSettings } : {})} gitSettingsUnavailable={gitSettingsUnavailable} {...(sandboxSettings ? { sandboxSettings } : {})} sandboxSettingsUnavailable={sandboxSettingsUnavailable} {...(workspaces ? { workspaces } : {})} workspacesUnavailable={workspacesUnavailable} {...(goalProjection ? { goalProjection } : {})} goalProjectionLoading={goalProjectionLoading} goalProjectionUnavailable={goalProjectionUnavailable} goalProjectionRefreshing={goalProjectionRefreshing} onRefreshGoalProjection={refreshGoalProjection} onCreateGoal={createGoal} onAddTodo={addGoalTodo} onOpenGate={openGoalGate} onResolveGate={resolveGoalGate} onAttachEvidence={attachGoalEvidence} onPreflight={preflightGoal} {...(usageSummary ? { usageSummary } : {})} {...(auditEvents ? { auditEvents } : {})} observabilityLoading={observabilityLoading} observabilityUnavailable={observabilityUnavailable} observabilityRefreshing={observabilityRefreshing} onRefreshObservability={refreshObservability} onProfileChange={setProfile} onResetProfile={resetProfile} onCreateRun={createRun} onCancel={cancel} onApprove={approve} onRetry={retry} onConfigureModel={configureModel} onClearModelSettings={clearModelSettings} onProbeModel={probeModel} onConfigureDeepSeek={configureDeepSeek} onClearDeepSeekSettings={clearDeepSeekSettings} onProbeDeepSeek={probeDeepSeek} onPatchCapabilityProfileSettings={patchCapabilityProfileSettings} onResetCapabilityProfileSettings={resetCapabilityProfileSettings} onPatchPermissionSettings={patchPermissionSettings} onConfirmFullHost={confirmFullHost} onRevokePermission={revokePermission} onPatchApprovalReviewSettings={patchApprovalReviewSettings} onProbeApprovalReview={probeApprovalReview} onPatchAgentMemorySettings={patchAgentMemorySettings} onProbeAgentMemory={probeAgentMemory} onUpdateAgentMemory={updateAgentMemory} onRollbackAgentMemory={rollbackAgentMemory} onPatchAgentMemoryKnowledgeSettings={patchAgentMemoryKnowledgeSettings} onProbeAgentMemoryKnowledge={probeAgentMemoryKnowledge} onPatchMcpSettings={patchMcpSettings} onProbeMcp={probeMcp} onSetFilesystemToolsEnabled={setFilesystemToolsEnabled} onSetGitToolsEnabled={setGitToolsEnabled} onProbeSandbox={probeSandbox} onSetSandboxSettings={setSandboxSettingsFromWeb} onAddWorkspace={addWorkspace} onRemoveWorkspace={removeWorkspace} />;
}

function readTextDelta(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && 'text' in payload && typeof payload.text === 'string' ? payload.text : '';
}

function safeError(reason: unknown, t: Translator): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') {
    const base = t('error.requestFailedWithCode', { code: reason.code });
    // Surface the daemon's bounded, developer-authored reason (e.g. which
    // capability gate rejected the run); never raw response bodies.
    const detail = 'message' in reason && typeof reason.message === 'string' && reason.message !== 'Request failed.'
      ? reason.message.replace(/[\r\n]+/gu, ' ').slice(0, 200)
      : '';
    return detail ? `${base} · ${detail}` : base;
  }
  return t('error.requestFailed');
}

function isCertificateStatusUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'CERTIFICATE_STATUS_UNAVAILABLE';
}

function isModelSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'MODEL_SETTINGS_UNAVAILABLE';
}

function isDeepSeekSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'DEEPSEEK_SETTINGS_UNAVAILABLE';
}

function isCapabilityProfileSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'CAPABILITY_PROFILE_SETTINGS_UNAVAILABLE';
}

function isPermissionSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'PERMISSION_SETTINGS_UNAVAILABLE';
}

function isApprovalReviewSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'APPROVAL_REVIEW_SETTINGS_UNAVAILABLE';
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
