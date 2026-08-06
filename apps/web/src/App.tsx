import type { FormEvent, JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_RUN_PROFILE, type AgentMemoryKnowledgeSettingsPatchInput, type AgentMemoryKnowledgeSettingsStatus, type AgentMemoryOperationsStatus, type AgentMemorySettingsMode, type AgentMemorySettingsPatchInput, type AgentMemorySettingsStatus, type ApprovalReviewSettingsPatchInput, type ApprovalReviewSettingsStatus, type AuditEventsResponse, type CapabilityProfile, type CapabilityProfileSettingsPatchInput, type CapabilityProfileSettingsStatus, type CertificateStatus, type DeepSeekProbeResult, type DeepSeekSettingsInput, type DeepSeekSettingsStatus, type DeploymentReadinessStatus, type GitSettingsStatus, type HealthResponse, type McpSettingsPatchInput, type McpSettingsStatus, type ModelProbeResult, type ModelSettingsInput, type ModelSettingsStatus, type PermissionApprovalPosture, type PermissionProfile, type PermissionProfileSettingsPatchInput, type PermissionProfileSettingsStatus, type PermissionStatus, type SandboxSettingsStatus, type ToolSettingsStatus, type UsageSummary, type WorkspaceRegistryStatus, type RunProfile, type RunSnapshot, type StoredEvent } from './api.js';
import type { GoalMutationResponse, GoalPreflightResult, GoalProjectionListResponse } from './api.js';
import { focusFirst, focusableElements, nextFocusIndex } from './accessibility.js';
import { ApprovalReviewSettingsCard, ContextRail, ConversationHeader, ConversationShell, PermissionProfileCard, SettingsSection, SettingsSheet, SettingsTabPanel, SettingsTabs, WorkspaceRail } from './components/vibego/index.js';
import { Toast, ToastViewport } from './components/ui/index.js';
import { createTranslator, type Locale } from './locale.js';
import { cycleTheme, type Theme } from './theme.js';
import './styles.css';

type SettingsTabId = 'run' | 'tools' | 'access';

export interface AppProps {
  health?: HealthResponse;
  run?: RunSnapshot;
  events?: readonly StoredEvent[];
  error?: string;
  onDismissError?: () => void;
  onPair?: (code: string) => void;
  onCreateRun?: (message: string) => void;
  onCancel?: () => void;
  onApprove?: (approvalId: string, decision: 'allow' | 'deny') => void;
  onRetry?: () => void;
  locale?: Locale;
  onLocaleChange?: (locale: Locale) => void;
  theme?: Theme;
  onThemeChange?: (theme: Theme) => void;
  profile?: RunProfile;
  capabilityProfileSettings?: CapabilityProfileSettingsStatus;
  capabilityProfileSettingsUnavailable?: boolean;
  onPatchCapabilityProfileSettings?: (input: CapabilityProfileSettingsPatchInput) => Promise<void> | void;
  onResetCapabilityProfileSettings?: (expectedRevision?: string) => Promise<void> | void;
  permissionSettings?: PermissionProfileSettingsStatus;
  permissionStatus?: PermissionStatus;
  permissionSettingsUnavailable?: boolean;
  onPatchPermissionSettings?: (input: PermissionProfileSettingsPatchInput) => Promise<void> | void;
  onConfirmFullHost?: (input: { requestedProfile: PermissionProfile; expectedProfileRevision: string }) => Promise<void> | void;
  onRevokePermission?: (input: { expectedRevision?: string; reason: 'user-requested' }) => Promise<void> | void;
  approvalReviewSettings?: ApprovalReviewSettingsStatus;
  approvalReviewSettingsUnavailable?: boolean;
  onPatchApprovalReviewSettings?: (input: ApprovalReviewSettingsPatchInput) => Promise<void> | void;
  onProbeApprovalReview?: () => Promise<void> | void;
  onProfileChange?: (profile: RunProfile) => void;
  onResetProfile?: () => void;
  certificateStatus?: CertificateStatus;
  certificateStatusUnavailable?: boolean;
  deploymentReadiness?: DeploymentReadinessStatus;
  deploymentReadinessUnavailable?: boolean;
  modelSettings?: ModelSettingsStatus;
  modelSettingsUnavailable?: boolean;
  modelProbe?: ModelProbeResult;
  onConfigureModel?: (input: ModelSettingsInput) => Promise<void> | void;
  onClearModelSettings?: () => Promise<void> | void;
  onProbeModel?: (endpoint: string) => Promise<void> | void;
  deepSeekSettings?: DeepSeekSettingsStatus;
  deepSeekSettingsUnavailable?: boolean;
  deepSeekProbe?: DeepSeekProbeResult;
  onConfigureDeepSeek?: (input: DeepSeekSettingsInput) => Promise<void> | void;
  onClearDeepSeekSettings?: () => Promise<void> | void;
  onProbeDeepSeek?: () => Promise<void> | void;
  agentMemorySettings?: AgentMemorySettingsStatus;
  agentMemorySettingsUnavailable?: boolean;
  onPatchAgentMemorySettings?: (input: AgentMemorySettingsPatchInput) => Promise<void> | void;
  onProbeAgentMemory?: () => Promise<void> | void;
  onUpdateAgentMemory?: () => Promise<void> | void;
  onRollbackAgentMemory?: () => Promise<void> | void;
  agentMemoryOperations?: AgentMemoryOperationsStatus;
  agentMemoryKnowledgeSettings?: AgentMemoryKnowledgeSettingsStatus;
  agentMemoryKnowledgeSettingsUnavailable?: boolean;
  onPatchAgentMemoryKnowledgeSettings?: (input: AgentMemoryKnowledgeSettingsPatchInput) => Promise<void> | void;
  onProbeAgentMemoryKnowledge?: () => Promise<void> | void;
  mcpSettings?: McpSettingsStatus;
  mcpSettingsUnavailable?: boolean;
  onPatchMcpSettings?: (input: McpSettingsPatchInput) => Promise<void> | void;
  onProbeMcp?: () => Promise<void> | void;
  toolSettings?: ToolSettingsStatus;
  toolSettingsUnavailable?: boolean;
  onSetFilesystemToolsEnabled?: (enabled: boolean) => Promise<void> | void;
  gitSettings?: GitSettingsStatus;
  gitSettingsUnavailable?: boolean;
  onSetGitToolsEnabled?: (enabled: boolean) => Promise<void> | void;
  sandboxSettings?: SandboxSettingsStatus;
  sandboxSettingsUnavailable?: boolean;
  onProbeSandbox?: (provider: 'docker' | 'podman') => Promise<void> | void;
  onSetSandboxSettings?: (input: { provider: 'docker' | 'podman'; imageDigest: string; network: 'restricted' | 'enabled'; resources: SandboxSettingsStatus['resources']; enabled: boolean }) => Promise<void> | void;
  workspaces?: WorkspaceRegistryStatus;
  workspacesUnavailable?: boolean;
  onAddWorkspace?: (input: { id: string; path: string; label?: string }) => Promise<void> | void;
  onRemoveWorkspace?: (id: string) => Promise<void> | void;
  goalProjection?: GoalProjectionListResponse;
  goalProjectionLoading?: boolean;
  goalProjectionUnavailable?: boolean;
  goalProjectionRefreshing?: boolean;
  onRefreshGoalProjection?: () => Promise<void> | void;
  onCreateGoal?: (input: { title: string; objective: string; workspaceId?: string }) => Promise<GoalMutationResponse> | void;
  onAddTodo?: (goalId: string, input: { expectedRevision: number; title: string }) => Promise<GoalMutationResponse> | void;
  onOpenGate?: (goalId: string, input: { expectedRevision: number; question: string }) => Promise<GoalMutationResponse> | void;
  onResolveGate?: (goalId: string, gateId: string, input: { expectedRevision: number; status: 'approved' | 'rejected' | 'deferred' | 'expired' }) => Promise<GoalMutationResponse> | void;
  onAttachEvidence?: (goalId: string, input: { expectedRevision: number; summary: string }) => Promise<GoalMutationResponse> | void;
  onPreflight?: (goalId: string, todoId: string, expectedRevision: number) => Promise<GoalPreflightResult>;
  usageSummary?: UsageSummary;
  auditEvents?: AuditEventsResponse;
  observabilityLoading?: boolean;
  observabilityUnavailable?: boolean;
  observabilityRefreshing?: boolean;
  onRefreshObservability?: () => Promise<void> | void;
}

export function App({ health, run, events = [], error, onDismissError, onPair, onCreateRun, onCancel, onApprove, onRetry, locale = 'en-US', onLocaleChange, theme = 'light', onThemeChange, profile = DEFAULT_RUN_PROFILE, onProfileChange, onResetProfile, capabilityProfileSettings, capabilityProfileSettingsUnavailable = false, onPatchCapabilityProfileSettings, onResetCapabilityProfileSettings, permissionSettings, permissionStatus, permissionSettingsUnavailable = false, onPatchPermissionSettings, onConfirmFullHost, onRevokePermission, approvalReviewSettings, approvalReviewSettingsUnavailable = false, onPatchApprovalReviewSettings, onProbeApprovalReview, certificateStatus, certificateStatusUnavailable = false, deploymentReadiness, deploymentReadinessUnavailable = false, modelSettings, modelSettingsUnavailable = false, modelProbe, onConfigureModel, onClearModelSettings, onProbeModel, deepSeekSettings, deepSeekSettingsUnavailable = false, deepSeekProbe, onConfigureDeepSeek, onClearDeepSeekSettings, onProbeDeepSeek, agentMemorySettings, agentMemorySettingsUnavailable = false, onPatchAgentMemorySettings, onProbeAgentMemory, onUpdateAgentMemory, onRollbackAgentMemory, agentMemoryOperations, agentMemoryKnowledgeSettings, agentMemoryKnowledgeSettingsUnavailable = false, onPatchAgentMemoryKnowledgeSettings, onProbeAgentMemoryKnowledge, mcpSettings, mcpSettingsUnavailable = false, onPatchMcpSettings, onProbeMcp, toolSettings, toolSettingsUnavailable = false, onSetFilesystemToolsEnabled, gitSettings, gitSettingsUnavailable = false, onSetGitToolsEnabled, sandboxSettings, sandboxSettingsUnavailable = false, onProbeSandbox, onSetSandboxSettings, workspaces, workspacesUnavailable = false, onAddWorkspace, onRemoveWorkspace, goalProjection, goalProjectionLoading = false, goalProjectionUnavailable = false, goalProjectionRefreshing = false, onRefreshGoalProjection, onCreateGoal, onAddTodo, onOpenGate, onResolveGate, onAttachEvidence, onPreflight, usageSummary, auditEvents, observabilityLoading = false, observabilityUnavailable = false, observabilityRefreshing = false, onRefreshObservability }: AppProps): JSX.Element {
  const t = createTranslator(locale);
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [modelBaseUrl, setModelBaseUrl] = useState('https://api.deepseek.com');
  const [modelApiKey, setModelApiKey] = useState('');
  const [modelProbeEndpoint, setModelProbeEndpoint] = useState('https://api.deepseek.com/models');
  const [modelProbeBusy, setModelProbeBusy] = useState(false);
  const [deepSeekEndpointProfile, setDeepSeekEndpointProfile] = useState<DeepSeekSettingsInput['endpointProfile']>('openai-chat-completions');
  const [deepSeekEndpoint, setDeepSeekEndpoint] = useState('https://api.deepseek.com/v1/chat/completions');
  const [deepSeekModel, setDeepSeekModel] = useState('deepseek-v4-flash');
  const [deepSeekApiKey, setDeepSeekApiKey] = useState('');
  const [deepSeekThinking, setDeepSeekThinking] = useState<DeepSeekSettingsInput['thinkingMode']>('auto');
  const [deepSeekToolCalling, setDeepSeekToolCalling] = useState<DeepSeekSettingsInput['toolCalling']>('enabled');
  const [deepSeekSearch, setDeepSeekSearch] = useState<DeepSeekSettingsInput['webSearch']>('off');
  const [deepSeekReviewer, setDeepSeekReviewer] = useState<DeepSeekSettingsInput['reviewer']>('off');
  const [deepSeekBusy, setDeepSeekBusy] = useState(false);
  const [capabilityProfileId, setCapabilityProfileId] = useState<CapabilityProfile['profileId']>('preview');
  const [capabilityAcknowledged, setCapabilityAcknowledged] = useState(false);
  const [capabilityBusy, setCapabilityBusy] = useState(false);
  const [permissionProfileId, setPermissionProfileId] = useState<'workspace-coding' | 'full-host'>('workspace-coding');
  const [permissionApprovalPosture, setPermissionApprovalPosture] = useState<'bounded-auto' | 'session-auto' | 'explicit'>('bounded-auto');
  const [permissionFullHostAcknowledged, setPermissionFullHostAcknowledged] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionConfirmBusy, setPermissionConfirmBusy] = useState(false);
  const [permissionRevokeBusy, setPermissionRevokeBusy] = useState(false);
  const [approvalReviewEnabled, setApprovalReviewEnabled] = useState(false);
  const [approvalReviewSource, setApprovalReviewSource] = useState<ApprovalReviewSettingsStatus['reviewerSource']>('same-as-run');
  const [approvalReviewDedicatedProfileId, setApprovalReviewDedicatedProfileId] = useState('');
  const [approvalReviewPosture, setApprovalReviewPosture] = useState<ApprovalReviewSettingsStatus['posture']>('off');
  const [approvalReviewMaxLatencyMs, setApprovalReviewMaxLatencyMs] = useState(1_500);
  const [approvalReviewMaxRequestBytes, setApprovalReviewMaxRequestBytes] = useState(16_384);
  const [approvalReviewMaxResponseBytes, setApprovalReviewMaxResponseBytes] = useState(8_192);
  const [approvalReviewCacheTtlMs, setApprovalReviewCacheTtlMs] = useState(0);
  const [approvalReviewBusy, setApprovalReviewBusy] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryMode, setMemoryMode] = useState<AgentMemorySettingsMode>('off');
  const [memoryTeamId, setMemoryTeamId] = useState('vibego');
  const [memoryAgentId, setMemoryAgentId] = useState('vibego-local-agent');
  const [memoryUserId, setMemoryUserId] = useState('local-user');
  const [memoryUpstreamRepo, setMemoryUpstreamRepo] = useState('https://github.com/TencentCloud/TencentDB-Agent-Memory');
  const [memoryUpstreamRef, setMemoryUpstreamRef] = useState('feat/server_team');
  const [memoryUpstreamRefLocked, setMemoryUpstreamRefLocked] = useState(false);
  const [memoryAutoUpdate, setMemoryAutoUpdate] = useState(true);
  const [memoryIntervalMinutes, setMemoryIntervalMinutes] = useState(60);
  const [memoryFallback, setMemoryFallback] = useState(true);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(false);
  const [knowledgeId, setKnowledgeId] = useState('wiki_demo');
  const [knowledgeAutoRetrieve, setKnowledgeAutoRetrieve] = useState(false);
  const [knowledgeMaxItems, setKnowledgeMaxItems] = useState(8);
  const [knowledgeMaxBytes, setKnowledgeMaxBytes] = useState(8 * 1024);
  const [knowledgeTimeoutMs, setKnowledgeTimeoutMs] = useState(750);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpServerId, setMcpServerId] = useState('local-mcp');
  const [mcpServerVersion, setMcpServerVersion] = useState('1.0.0');
  const [mcpTransport, setMcpTransport] = useState<'stdio' | 'streamable-http'>('stdio');
  const [mcpEndpointLabel, setMcpEndpointLabel] = useState('Local MCP server');
  const [mcpManifestRevision, setMcpManifestRevision] = useState('unconfigured');
  const [mcpCapabilityAllowlist, setMcpCapabilityAllowlist] = useState('');
  const [mcpBusy, setMcpBusy] = useState(false);
  const [toolToggleBusy, setToolToggleBusy] = useState(false);
  const [gitToggleBusy, setGitToggleBusy] = useState(false);
  const [sandboxProvider, setSandboxProvider] = useState<'docker' | 'podman'>('docker');
  const [sandboxImageDigest, setSandboxImageDigest] = useState('');
  const [sandboxNetwork, setSandboxNetwork] = useState<'restricted' | 'enabled'>('restricted');
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [workspaceIdInput, setWorkspaceIdInput] = useState('');
  const [workspaceLabelInput, setWorkspaceLabelInput] = useState('');
  const [workspacePathInput, setWorkspacePathInput] = useState('');
  const [workspaceConfirmed, setWorkspaceConfirmed] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('run');
  const [contextOpen, setContextOpen] = useState(true);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const settingsPanelRef = useRef<HTMLElement | null>(null);
  const settingsTriggerRef = useRef<HTMLElement | null>(null);
  const settingsWasOpen = useRef(false);
  useEffect(() => {
    if (modelSettings?.baseUrl) setModelBaseUrl(modelSettings.baseUrl);
  }, [modelSettings?.baseUrl]);
  useEffect(() => {
    if (modelSettings?.baseUrl) setModelProbeEndpoint(`${modelSettings.baseUrl.replace(/\/$/u, '')}/models`);
  }, [modelSettings?.baseUrl]);
  useEffect(() => {
    const settings = deepSeekSettings?.profile;
    if (!settings) return;
    setDeepSeekEndpointProfile(settings.endpointProfile);
    setDeepSeekEndpoint(settings.endpoint);
    setDeepSeekModel(settings.model);
    setDeepSeekThinking(settings.thinkingMode);
    setDeepSeekToolCalling(settings.toolCalling);
    setDeepSeekSearch(settings.webSearch);
    setDeepSeekReviewer(settings.reviewer);
  }, [deepSeekSettings?.profile]);
  useEffect(() => {
    const selected = capabilityProfileSettings?.settings.profile;
    if (!selected) return;
    setCapabilityProfileId(selected.profileId);
    setCapabilityAcknowledged(selected.requiresAcknowledgement);
  }, [capabilityProfileSettings?.settings.profile]);
  useEffect(() => {
    const selected = permissionSettings?.settings.profile;
    if (!selected) return;
    setPermissionProfileId(selected.profileId === 'full-host' ? 'full-host' : 'workspace-coding');
    setPermissionApprovalPosture(selected.approvalPosture === 'session-auto' || selected.approvalPosture === 'explicit' ? selected.approvalPosture : 'bounded-auto');
    if (selected.profileId !== 'full-host') setPermissionFullHostAcknowledged(false);
  }, [permissionSettings?.settings.profile]);
  useEffect(() => {
    const settings = approvalReviewSettings;
    if (!settings) return;
    setApprovalReviewEnabled(settings.enabled);
    setApprovalReviewSource(settings.reviewerSource);
    setApprovalReviewDedicatedProfileId(settings.dedicatedProfileId ?? '');
    setApprovalReviewPosture(settings.posture);
    setApprovalReviewMaxLatencyMs(settings.limits.maxLatencyMs);
    setApprovalReviewMaxRequestBytes(settings.limits.maxRequestBytes);
    setApprovalReviewMaxResponseBytes(settings.limits.maxResponseBytes);
    setApprovalReviewCacheTtlMs(settings.limits.cacheTtlMs);
  }, [approvalReviewSettings]);
  useEffect(() => {
    const settings = agentMemorySettings?.settings;
    if (!settings) return;
    setMemoryEnabled(settings.enabled);
    setMemoryMode(settings.mode);
    setMemoryTeamId(settings.teamId);
    setMemoryAgentId(settings.agentId);
    setMemoryUserId(settings.userId);
    setMemoryUpstreamRepo(settings.upstreamRepo);
    setMemoryUpstreamRef(settings.upstreamRef);
    setMemoryUpstreamRefLocked(settings.upstreamRefLocked === true);
    setMemoryAutoUpdate(settings.autoUpdate);
    setMemoryIntervalMinutes(settings.updateIntervalMinutes);
    setMemoryFallback(settings.fallbackToDirectProvider);
  }, [agentMemorySettings?.settings]);
  useEffect(() => {
    const settings = agentMemoryKnowledgeSettings?.settings;
    if (!settings) return;
    setKnowledgeEnabled(settings.enabled);
    setKnowledgeId(settings.knowledgeId);
    setKnowledgeAutoRetrieve(settings.autoRetrieve);
    setKnowledgeMaxItems(settings.maxItems);
    setKnowledgeMaxBytes(settings.maxBytes);
    setKnowledgeTimeoutMs(settings.timeoutMs);
  }, [agentMemoryKnowledgeSettings?.settings]);
  useEffect(() => {
    const settings = mcpSettings?.settings;
    if (!settings) return;
    setMcpEnabled(settings.enabled);
    setMcpServerId(settings.serverId);
    setMcpServerVersion(settings.serverVersion);
    setMcpTransport(settings.transport);
    setMcpEndpointLabel(settings.endpointLabel);
    setMcpManifestRevision(settings.manifestRevision);
    setMcpCapabilityAllowlist(settings.capabilityAllowlist.join(', '));
  }, [mcpSettings?.settings]);
  useEffect(() => {
    if (sandboxSettings?.provider) setSandboxProvider(sandboxSettings.provider);
    if (sandboxSettings?.imageDigest) setSandboxImageDigest(sandboxSettings.imageDigest);
    if (sandboxSettings?.network) setSandboxNetwork(sandboxSettings.network);
  }, [sandboxSettings?.provider, sandboxSettings?.imageDigest]);
  const connected = health?.auth.pairingRequired === false;
  const submitPairing = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pairingCode.trim()) onPair?.(pairingCode.trim());
  };
  const submitRun = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (message.trim()) {
      onCreateRun?.(message.trim());
      setMessage('');
    }
  };
  const submitModelSettings = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!modelApiKey) return;
    try {
      await onConfigureModel?.({ provider: 'openai-compatible', baseUrl: modelBaseUrl, apiKey: modelApiKey, model: profile.model.name });
      setModelApiKey('');
    } catch {
      // The parent renders a safe error; keep the field for an intentional retry.
    }
  };
  const submitModelProbe = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!onProbeModel || !modelProbeEndpoint.trim()) return;
    setModelProbeBusy(true);
    try { await onProbeModel(modelProbeEndpoint.trim()); }
    catch { /* The parent renders a bounded error. */ }
    finally { setModelProbeBusy(false); }
  };
  const buildCapabilityProfile = (profileId: CapabilityProfile['profileId']): CapabilityProfile | undefined => {
    const current = capabilityProfileSettings?.settings.profile;
    if (!current) return undefined;
    const updatedAt = new Date().toISOString();
    const transportMode = current.transportMode;
    if (profileId === 'preview') return { schemaVersion: 'ready4vibe_capability_profile_v1', profileId, transportMode, modelMode: 'fake', filesystemMode: 'off', shellMode: 'off', networkMode: 'off', mcpSkillMode: 'off', approvalMode: 'none', policyRevision: current.policyRevision, requiresAcknowledgement: false, updatedAt };
    if (profileId === 'advanced-local') return { schemaVersion: 'ready4vibe_capability_profile_v1', profileId, transportMode, ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}), modelMode: modelSettings?.configured ? 'configured' : 'fake', filesystemMode: 'workspace-write', shellMode: 'host-restricted', networkMode: 'off', mcpSkillMode: 'off', approvalMode: 'explicit', policyRevision: current.policyRevision, requiresAcknowledgement: capabilityAcknowledged, updatedAt };
    if (profileId === 'workspace-coding') return { schemaVersion: 'ready4vibe_capability_profile_v1', profileId, transportMode, ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}), modelMode: modelSettings?.configured ? 'configured' : 'fake', filesystemMode: 'workspace-write', shellMode: 'off', networkMode: 'off', mcpSkillMode: 'off', approvalMode: 'on-request', policyRevision: current.policyRevision, requiresAcknowledgement: false, updatedAt };
    return { ...current, profileId: 'custom', ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}), updatedAt };
  };
  const saveCapabilityProfile = async (): Promise<void> => {
    if (!onPatchCapabilityProfileSettings || !capabilityProfileSettings) return;
    const next = buildCapabilityProfile(capabilityProfileId);
    if (!next) return;
    setCapabilityBusy(true);
    try {
      await onPatchCapabilityProfileSettings({ profile: next, expectedRevision: capabilityProfileSettings.currentRevision });
    } finally { setCapabilityBusy(false); }
  };
  const resetCapabilityProfile = async (): Promise<void> => {
    if (!onResetCapabilityProfileSettings || !capabilityProfileSettings) return;
    setCapabilityBusy(true);
    try { await onResetCapabilityProfileSettings(capabilityProfileSettings.currentRevision); }
    finally { setCapabilityBusy(false); }
  };
  const submitDeepSeekSettings = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!onConfigureDeepSeek || !deepSeekApiKey.trim()) return;
    setDeepSeekBusy(true);
    try {
      await onConfigureDeepSeek({ endpointProfile: deepSeekEndpointProfile, endpoint: deepSeekEndpoint, model: deepSeekModel, apiKey: deepSeekApiKey, thinkingMode: deepSeekThinking, toolCalling: deepSeekToolCalling, webSearch: deepSeekSearch, reviewer: deepSeekReviewer, ...(deepSeekSettings?.profile?.profileRevision ? { expectedRevision: deepSeekSettings.profile.profileRevision } : {}) });
      setDeepSeekApiKey('');
      updateProfile({ model: { provider: 'deepseek', name: deepSeekModel } });
    } catch { /* parent renders safe error */ }
    finally { setDeepSeekBusy(false); }
  };
  const probeDeepSeekSettings = async (): Promise<void> => {
    if (!onProbeDeepSeek) return;
    setDeepSeekBusy(true);
    try { await onProbeDeepSeek(); }
    catch { /* parent renders safe error */ }
    finally { setDeepSeekBusy(false); }
  };
  const buildPermissionProfile = (): PermissionProfile | undefined => {
    const current = permissionSettings?.settings.profile;
    if (!current) return undefined;
    const updatedAt = new Date().toISOString();
    if (permissionProfileId === 'workspace-coding') {
      return {
        ...current,
        profileId: 'workspace-coding',
        filesystemScope: 'workspace-only',
        processScope: 'none',
        networkMode: 'off',
        mcpSkillMode: 'off',
        approvalPosture: permissionApprovalPosture === 'session-auto' ? 'bounded-auto' : permissionApprovalPosture,
        taskTrust: current.taskTrust === 'untrusted-content' ? 'trusted-workspace' : current.taskTrust,
        ...(current.workspaceId || profile.workspaceId ? { workspaceId: current.workspaceId ?? profile.workspaceId } : {}),
        requiresConfirmation: false,
        updatedAt,
      };
    }
    const { workspaceId: _workspaceId, ...hostBase } = current;
    return {
      ...hostBase,
      profileId: 'full-host',
      filesystemScope: 'host',
      processScope: 'host',
      networkMode: 'off',
      mcpSkillMode: 'off',
      approvalPosture: permissionApprovalPosture === 'bounded-auto' ? 'explicit' : permissionApprovalPosture,
      taskTrust: 'trusted-user',
      requiresConfirmation: true,
      updatedAt,
    };
  };
  const savePermissionProfile = async (): Promise<void> => {
    if (!onPatchPermissionSettings || !permissionSettings) return;
    const next = buildPermissionProfile();
    if (!next) return;
    setPermissionBusy(true);
    try {
      await onPatchPermissionSettings({ profile: next, expectedRevision: permissionSettings.currentRevision });
    } finally { setPermissionBusy(false); }
  };
  const confirmFullHost = async (): Promise<void> => {
    if (!onConfirmFullHost || !permissionSettings || permissionSettings.settings.profile.profileId !== 'full-host') return;
    setPermissionConfirmBusy(true);
    try {
      await onConfirmFullHost({ requestedProfile: permissionSettings.settings.profile, expectedProfileRevision: permissionSettings.currentRevision });
    } finally { setPermissionConfirmBusy(false); }
  };
  const revokePermission = async (): Promise<void> => {
    if (!onRevokePermission) return;
    setPermissionRevokeBusy(true);
    try {
      const expectedRevision = permissionStatus?.currentRevision ?? permissionSettings?.currentRevision;
      await onRevokePermission({ ...(expectedRevision ? { expectedRevision } : {}), reason: 'user-requested' });
    } finally { setPermissionRevokeBusy(false); }
  };
  const saveApprovalReviewSettings = async (input: ApprovalReviewSettingsPatchInput): Promise<void> => {
    if (!onPatchApprovalReviewSettings) return;
    setApprovalReviewBusy(true);
    try { await onPatchApprovalReviewSettings(input); }
    catch { /* Parent renders a safe error and keeps the bounded draft. */ }
    finally { setApprovalReviewBusy(false); }
  };
  const probeApprovalReview = async (): Promise<void> => {
    if (!onProbeApprovalReview) return;
    setApprovalReviewBusy(true);
    try { await onProbeApprovalReview(); }
    catch { /* Parent renders a safe error. */ }
    finally { setApprovalReviewBusy(false); }
  };
  const saveAgentMemorySettings = async (): Promise<void> => {
    if (!onPatchAgentMemorySettings) return;
    setMemoryBusy(true);
    try {
      const selectedMode: AgentMemorySettingsMode = memoryEnabled && memoryMode === 'off' ? 'memory-core' : memoryMode;
      if (selectedMode !== memoryMode) setMemoryMode(selectedMode);
      await onPatchAgentMemorySettings({ enabled: memoryEnabled, mode: selectedMode, teamId: memoryTeamId, agentId: memoryAgentId, userId: memoryUserId, upstreamRepo: memoryUpstreamRepo, upstreamRef: memoryUpstreamRef, upstreamRefLocked: memoryUpstreamRefLocked, autoUpdate: memoryAutoUpdate, updateIntervalMinutes: memoryIntervalMinutes, fallbackToDirectProvider: memoryFallback });
    } catch { /* Parent renders a safe error and keeps the draft for retry. */ } finally { setMemoryBusy(false); }
  };
  const runAgentMemoryAction = async (action?: () => Promise<void> | void): Promise<void> => {
    if (!action) return;
    setMemoryBusy(true);
    try { await action(); } catch { /* Parent renders a safe error. */ } finally { setMemoryBusy(false); }
  };
  const saveAgentMemoryKnowledgeSettings = async (): Promise<void> => {
    if (!onPatchAgentMemoryKnowledgeSettings) return;
    setKnowledgeBusy(true);
    try {
      await onPatchAgentMemoryKnowledgeSettings({ enabled: knowledgeEnabled, knowledgeId, autoRetrieve: knowledgeAutoRetrieve, maxItems: knowledgeMaxItems, maxBytes: knowledgeMaxBytes, timeoutMs: knowledgeTimeoutMs });
    } catch { /* Parent renders a safe error and keeps the draft for retry. */ } finally { setKnowledgeBusy(false); }
  };
  const probeAgentMemoryKnowledge = async (): Promise<void> => {
    if (!onProbeAgentMemoryKnowledge) return;
    setKnowledgeBusy(true);
    try { await onProbeAgentMemoryKnowledge(); } catch { /* Parent renders a safe error. */ } finally { setKnowledgeBusy(false); }
  };
  const saveMcpSettings = async (): Promise<void> => {
    if (!onPatchMcpSettings) return;
    setMcpBusy(true);
    try {
      const capabilityAllowlist = mcpCapabilityAllowlist.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 128);
      await onPatchMcpSettings({ enabled: mcpEnabled, serverId: mcpServerId, serverVersion: mcpServerVersion, transport: mcpTransport, endpointLabel: mcpEndpointLabel, manifestRevision: mcpManifestRevision, capabilityAllowlist });
    } catch { /* Parent renders a safe error and keeps the draft for retry. */ } finally { setMcpBusy(false); }
  };
  const probeMcp = async (): Promise<void> => {
    if (!onProbeMcp) return;
    setMcpBusy(true);
    try { await onProbeMcp(); } catch { /* Parent renders a safe error. */ } finally { setMcpBusy(false); }
  };
  const toggleFilesystemTools = async (enabled: boolean): Promise<void> => {
    if (!onSetFilesystemToolsEnabled) return;
    setToolToggleBusy(true);
    try { await onSetFilesystemToolsEnabled(enabled); } catch { /* Parent renders a safe error and keeps the previous toggle state. */ } finally { setToolToggleBusy(false); }
  };
  const toggleGitTools = async (enabled: boolean): Promise<void> => {
    if (!onSetGitToolsEnabled) return;
    setGitToggleBusy(true);
    try { await onSetGitToolsEnabled(enabled); } catch { /* Parent renders a safe error and keeps the previous toggle state. */ } finally { setGitToggleBusy(false); }
  };
  const probeSandbox = async (): Promise<void> => {
    if (!onProbeSandbox) return;
    setSandboxBusy(true);
    try { await onProbeSandbox(sandboxProvider); } catch { /* Parent renders a safe error. */ } finally { setSandboxBusy(false); }
  };
  const toggleSandbox = async (enabled: boolean): Promise<void> => {
    if (!onSetSandboxSettings || !sandboxSettings) return;
    setSandboxBusy(true);
    try { await onSetSandboxSettings({ provider: sandboxProvider, imageDigest: sandboxImageDigest, network: sandboxNetwork, resources: sandboxSettings.resources, enabled }); } catch { /* Parent renders a safe error. */ } finally { setSandboxBusy(false); }
  };
  const updateProfile = (patch: Partial<RunProfile>): void => onProfileChange?.({ ...profile, ...patch });
  const startNewTask = (): void => {
    setMessage('');
    setContextOpen(false);
    if (typeof window !== 'undefined') window.requestAnimationFrame(() => composerRef.current?.focus());
  };
  useEffect(() => {
    if (!workspaces || workspaces.workspaces.some((workspace) => workspace.id === profile.workspaceId)) return;
    const fallback = workspaces.workspaces.find((workspace) => workspace.isDefault) ?? workspaces.workspaces[0];
    if (fallback) updateProfile({ workspaceId: fallback.id });
  }, [profile.workspaceId, workspaces]);
  useEffect(() => {
    if (!settingsOpen) {
      if (settingsWasOpen.current) {
        settingsWasOpen.current = false;
        settingsTriggerRef.current?.focus();
      }
      return;
    }
    settingsWasOpen.current = true;
    const panel = settingsPanelRef.current;
    focusFirst(panel);
    const onDialogKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = focusableElements(panel);
      if (focusable.length === 0) return;
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = nextFocusIndex(currentIndex, focusable.length, event.shiftKey);
      if (currentIndex < 0 || (event.shiftKey && currentIndex === 0) || (!event.shiftKey && currentIndex === focusable.length - 1)) {
        event.preventDefault();
        focusable[nextIndex]?.focus();
      }
    };
    document.addEventListener('keydown', onDialogKeyDown);
    return () => document.removeEventListener('keydown', onDialogKeyDown);
  }, [settingsOpen]);
  useEffect(() => {
    const startFromShortcut = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        startNewTask();
      }
    };
    window.addEventListener('keydown', startFromShortcut);
    return () => window.removeEventListener('keydown', startFromShortcut);
  }, []);
  const addWorkspace = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!onAddWorkspace || !workspaceIdInput.trim() || !workspacePathInput.trim() || !workspaceConfirmed) return;
    setWorkspaceBusy(true);
    try {
      await onAddWorkspace({ id: workspaceIdInput.trim(), path: workspacePathInput.trim(), ...(workspaceLabelInput.trim() ? { label: workspaceLabelInput.trim() } : {}) });
      setWorkspaceIdInput('');
      setWorkspaceLabelInput('');
      setWorkspacePathInput('');
      setWorkspaceConfirmed(false);
    } catch {
      // Parent renders a safe error and keeps the form for an intentional retry.
    } finally { setWorkspaceBusy(false); }
  };
  const removeWorkspace = async (id: string): Promise<void> => {
    if (!onRemoveWorkspace) return;
    setWorkspaceBusy(true);
    try { await onRemoveWorkspace(id); } catch { /* Parent renders a safe error. */ } finally { setWorkspaceBusy(false); }
  };
  const updateLimit = (key: keyof RunProfile['limits'], value: string): void => onProfileChange?.({ ...profile, limits: { ...profile.limits, [key]: clampLimit(key, value) } });
  const updateSandboxMode = (mode: RunProfile['sandbox']['mode']): void => {
    const network = 'network' in profile.sandbox && profile.sandbox.network ? profile.sandbox.network : 'restricted';
    if (mode === 'read-only') updateProfile({ sandbox: { mode, network } });
    else if (mode === 'workspace-write') updateProfile({ sandbox: { mode, network, writableRoots: 'writableRoots' in profile.sandbox && profile.sandbox.writableRoots.length > 0 ? profile.sandbox.writableRoots : ['.'] } });
    else updateProfile({ sandbox: { mode, network, provider: 'provider' in profile.sandbox ? profile.sandbox.provider : 'docker', ...('writableRoots' in profile.sandbox && profile.sandbox.writableRoots ? { writableRoots: profile.sandbox.writableRoots } : {}) } });
  };
  const openSettings = (target: HTMLElement): void => {
    settingsTriggerRef.current = target;
    setSettingsOpen(true);
  };

  return (
    <main className="app-shell">
      <ConversationHeader connected={connected} contextOpen={contextOpen} settingsOpen={settingsOpen} locale={locale} theme={theme} onToggleTheme={() => onThemeChange?.(cycleTheme(theme))} copy={{ brandName: t('brand.name'), brandPrefix: 'Vibe', brandSuffix: 'Go', newTask: t('nav.newTask'), hideDetails: t('nav.hideDetails'), showDetails: t('nav.showDetails'), settings: t('nav.settings'), localeLabel: t('locale.label'), localeEnglish: t('locale.english'), localeChinese: t('locale.chinese'), themeToggle: t('theme.toggle'), themeLight: t('theme.light'), themeDark: t('theme.dark'), connected: t('connection.connected'), awaitingPairing: t('connection.awaitingPairing') }} onNewTask={startNewTask} onToggleContext={() => setContextOpen((current) => !current)} onOpenSettings={openSettings} onLocaleChange={onLocaleChange} />
      <div className="sr-only" aria-live="polite" aria-label={t('accessibility.statusLabel')}>{error ?? (connected ? t('connection.connected') : t('connection.awaitingPairing'))}</div>
      <section className="content-grid">
        <WorkspaceRail workspaceLabel={workspaces?.workspaces.find((workspace) => workspace.id === profile.workspaceId)?.label ?? profile.workspaceId} settingsOpen={settingsOpen} copy={{ navigationLabel: 'Workspace navigation', eyebrow: 'WORKSPACE', localSession: t('nav.localSession'), newTask: t('nav.newTask'), recent: 'RECENT', currentTask: t('nav.currentTask'), noOtherRuns: t('nav.noOtherRuns'), settings: t('nav.settings') }} onNewTask={startNewTask} onOpenSettings={openSettings} />
        <aside className="sidebar" aria-label="连接与运行摘要">
          <SettingsSheet open={settingsOpen} panelRef={settingsPanelRef} copy={{ eyebrow: t('settings.eyebrow'), title: t('settings.title'), description: t('settings.description'), close: t('settings.close') }} onClose={() => setSettingsOpen(false)}>
            <SettingsTabs ariaLabel="Settings sections" tabs={[{ id: 'run', label: 'Run' }, { id: 'tools', label: 'Tools' }, { id: 'access', label: 'Access' }]} activeTab={settingsTab} onTabChange={(tabId) => { if (tabId === 'run' || tabId === 'tools' || tabId === 'access') setSettingsTab(tabId); }}>
              <SettingsTabPanel tabId="run" activeTab={settingsTab}>
                <div className="settings-grid">
                  <SettingsSection id="permission-profile-settings" eyebrow="PERMISSION PROFILE" title="Permission profile" description="Choose the daemon-owned capability posture for new runs. Existing runs keep their frozen snapshot." status={permissionSettingsUnavailable ? 'unavailable' : permissionStatus?.status === 'blocked' || permissionSettings?.resolution.status === 'blocked' ? 'degraded' : permissionStatus?.status === 'degraded' || permissionSettings?.resolution.status === 'degraded' ? 'degraded' : permissionSettings ? 'ready' : 'loading'} statusLabel={permissionSettingsUnavailable ? 'Unavailable' : permissionStatus?.status ?? permissionSettings?.resolution.status ?? 'Loading'}>
                    <PermissionProfileCard
                      settings={permissionSettings}
                      {...(permissionStatus ? { status: permissionStatus } : {})}
                      unavailable={permissionSettingsUnavailable}
                      selectedProfileId={permissionProfileId}
                      selectedApprovalPosture={permissionApprovalPosture}
                      onProfileChange={setPermissionProfileId}
                      onApprovalPostureChange={setPermissionApprovalPosture}
                      onSave={onPatchPermissionSettings ? () => { void savePermissionProfile(); } : undefined}
                      saveBusy={permissionBusy}
                      fullHostAcknowledged={permissionFullHostAcknowledged}
                      onFullHostAcknowledgedChange={setPermissionFullHostAcknowledged}
                      onConfirmFullHost={onConfirmFullHost ? () => { void confirmFullHost(); } : undefined}
                      confirmBusy={permissionConfirmBusy}
                      onRevoke={onRevokePermission ? () => { void revokePermission(); } : undefined}
                      revokeBusy={permissionRevokeBusy}
                    />
                  </SettingsSection>
                  <SettingsSection id="approval-review-settings" eyebrow="LLM APPROVAL REVIEW" title="Approval review" description="Optional bounded review for exact low-risk approvals. It never replaces deterministic policy or the user." status={approvalReviewSettingsUnavailable ? 'unavailable' : approvalReviewSettings?.status === 'blocked' ? 'degraded' : approvalReviewSettings?.status === 'degraded' ? 'degraded' : approvalReviewSettings?.status === 'ready' ? 'ready' : approvalReviewSettings ? 'idle' : 'loading'} statusLabel={approvalReviewSettingsUnavailable ? 'Unavailable' : approvalReviewSettings?.status ?? 'Loading'}>
                    <ApprovalReviewSettingsCard
                      settings={approvalReviewSettings}
                      unavailable={approvalReviewSettingsUnavailable}
                      enabled={approvalReviewEnabled}
                      reviewerSource={approvalReviewSource}
                      dedicatedProfileId={approvalReviewDedicatedProfileId}
                      posture={approvalReviewPosture}
                      maxLatencyMs={approvalReviewMaxLatencyMs}
                      maxRequestBytes={approvalReviewMaxRequestBytes}
                      maxResponseBytes={approvalReviewMaxResponseBytes}
                      cacheTtlMs={approvalReviewCacheTtlMs}
                      onEnabledChange={setApprovalReviewEnabled}
                      onReviewerSourceChange={(source) => { setApprovalReviewSource(source); if (source === 'same-as-run') setApprovalReviewDedicatedProfileId(''); }}
                      onDedicatedProfileIdChange={setApprovalReviewDedicatedProfileId}
                      onPostureChange={setApprovalReviewPosture}
                      onMaxLatencyMsChange={setApprovalReviewMaxLatencyMs}
                      onMaxRequestBytesChange={setApprovalReviewMaxRequestBytes}
                      onMaxResponseBytesChange={setApprovalReviewMaxResponseBytes}
                      onCacheTtlMsChange={setApprovalReviewCacheTtlMs}
                      onSave={onPatchApprovalReviewSettings ? (input) => { void saveApprovalReviewSettings(input); } : undefined}
                      onProbe={onProbeApprovalReview ? () => { void probeApprovalReview(); } : undefined}
                      busy={approvalReviewBusy}
                    />
                  </SettingsSection>
                  <SettingsSection id="capability-profile-settings" eyebrow="CAPABILITY PROFILE" title="Capability profile" description="Choose a bounded intent; the daemon resolves the effective permissions." status={capabilityProfileSettingsUnavailable ? 'unavailable' : capabilityProfileSettings?.resolution.status === 'blocked' ? 'degraded' : capabilityProfileSettings?.resolution.status === 'degraded' ? 'degraded' : capabilityProfileSettings ? 'ready' : 'loading'} statusLabel={capabilityProfileSettingsUnavailable ? 'Unavailable' : capabilityProfileSettings?.resolution.status ?? 'Loading'}>
                    {capabilityProfileSettingsUnavailable ? <p className="muted">Capability profile settings are unavailable; existing run controls remain unchanged.</p> : capabilityProfileSettings ? <>
                      <div className="capability-profile-cards" role="radiogroup" aria-label="Capability profiles">
                        {([
                          ['preview', 'Preview', 'Inspect the conversation with no side-effecting tools.'],
                          ['workspace-coding', 'Workspace coding', 'Workspace-scoped coding with approval and no implicit host shell.'],
                          ['advanced-local', 'Advanced local', 'Opt-in host-restricted shell; explicit acknowledgement is required.'],
                          ['custom', 'Custom', 'Keep individually selected capability modes under daemon policy.'],
                        ] as const).map(([id, label, description]) => <button key={id} type="button" className="capability-profile-card" data-selected={capabilityProfileId === id ? 'true' : 'false'} role="radio" aria-checked={capabilityProfileId === id} disabled={capabilityBusy} onClick={() => setCapabilityProfileId(id)}><strong>{label}</strong><span>{description}</span></button>)}
                      </div>
                      {capabilityProfileId === 'advanced-local' && <label className="toggle-row"><input type="checkbox" checked={capabilityAcknowledged} disabled={capabilityBusy} onChange={(event) => setCapabilityAcknowledged(event.target.checked)} /><span>I understand host-restricted execution requires explicit approval and never falls back silently.</span></label>}
                      <p className="muted">Requested: {capabilityProfileSettings.resolution.requestedProfile.profileId} · Effective: {capabilityProfileSettings.resolution.effectiveProfile?.profileId ?? 'blocked'} · reason: {capabilityProfileSettings.resolution.reasonCode} · revision: {capabilityProfileSettings.currentRevision}</p>
                      {capabilityProfileSettings.resolution.effectiveProfile && <p className="muted">Effective modes: model {capabilityProfileSettings.resolution.effectiveProfile.modelMode} · filesystem {capabilityProfileSettings.resolution.effectiveProfile.filesystemMode} · shell {capabilityProfileSettings.resolution.effectiveProfile.shellMode} · network {capabilityProfileSettings.resolution.effectiveProfile.networkMode} · MCP/Skill {capabilityProfileSettings.resolution.effectiveProfile.mcpSkillMode}</p>}
                      <div className="inline-actions"><button type="button" disabled={capabilityBusy || !onPatchCapabilityProfileSettings || (capabilityProfileId === 'advanced-local' && !capabilityAcknowledged)} onClick={() => { void saveCapabilityProfile(); }}>Save capability profile</button><button className="reset-button" type="button" disabled={capabilityBusy || !onResetCapabilityProfileSettings} onClick={() => { void resetCapabilityProfile(); }}>Reset to Preview</button></div>
                    </> : <p className="muted">Pair with the daemon to choose a capability profile.</p>}
                  </SettingsSection>
                  <SettingsSection id="workspace-settings" eyebrow={t('settings.workspaces')} title="Workspace" description="Select the daemon workspace used by new runs." status={workspacesUnavailable ? 'unavailable' : workspaces ? 'ready' : 'loading'} statusLabel={workspacesUnavailable ? 'Unavailable' : workspaces ? 'Ready' : 'Loading'}>
                    <div className="workspace-setup" aria-label={t('settings.workspaceSetup')}>
                      <div className="eyebrow">{t('settings.workspaces')}</div>
                      {workspacesUnavailable ? <p className="muted">Workspace setup is unavailable until the daemon exposes the authenticated registry.</p> : workspaces ? <>
                        <label>{t('settings.workspace')}<select value={profile.workspaceId} disabled={workspaceBusy} onChange={(event) => updateProfile({ workspaceId: event.target.value })}>{workspaces.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.label} · {workspace.id}{workspace.isDefault ? ' · default' : ''}</option>)}</select></label>
                        <p className="muted">Added paths are on the daemon machine. The path is used only by the daemon and is never shown in status, events, or browser storage.</p>
                        {onAddWorkspace && <form onSubmit={(event) => { void addWorkspace(event); }}>
                          <label>Workspace id<input value={workspaceIdInput} disabled={workspaceBusy} onChange={(event) => setWorkspaceIdInput(event.target.value)} placeholder="project-a" autoComplete="off" /></label>
                          <label>Friendly label<input value={workspaceLabelInput} disabled={workspaceBusy} onChange={(event) => setWorkspaceLabelInput(event.target.value)} placeholder="Project A" autoComplete="off" /></label>
                          <label>Path on daemon machine<input value={workspacePathInput} disabled={workspaceBusy} onChange={(event) => setWorkspacePathInput(event.target.value)} placeholder="C:\\work\\project-a" autoComplete="off" /></label>
                          <label className="toggle-row"><input type="checkbox" checked={workspaceConfirmed} disabled={workspaceBusy} onChange={(event) => setWorkspaceConfirmed(event.target.checked)} /><span>I understand this grants guarded tools access to that directory.</span></label>
                          <button type="submit" disabled={workspaceBusy || !workspaceIdInput.trim() || !workspacePathInput.trim() || !workspaceConfirmed}>Add workspace</button>
                        </form>}
                        {workspaces.workspaces.filter((workspace) => workspace.canRemove).map((workspace) => <div className="workspace-row" key={workspace.id}><span>{workspace.label} · {workspace.id}</span><button className="cancel-button" type="button" disabled={workspaceBusy} onClick={() => { void removeWorkspace(workspace.id); }}>Remove</button></div>)}
                      </> : <p className="muted">Pair with the daemon to configure workspaces.</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="model-settings" eyebrow={t('settings.modelAccess')} title="Model provider" description="Configure a compatible endpoint without editing files." status={modelSettingsUnavailable ? 'unavailable' : modelSettings?.credentialState === 'required' ? 'degraded' : modelSettings?.configured ? 'ready' : 'idle'} statusLabel={modelSettingsUnavailable ? 'Unavailable' : modelSettings?.credentialState === 'required' ? 'Credential required' : modelSettings?.configured ? 'Ready' : 'Not configured'}>
                    <div className="settings-run-fields">
                      <label>{t('settings.modelProvider')}<input value={profile.model.provider} onChange={(event) => updateProfile({ model: { ...profile.model, provider: event.target.value } })} /></label>
                      <label>{t('settings.modelName')}<input value={profile.model.name} onChange={(event) => updateProfile({ model: { ...profile.model, name: event.target.value } })} /></label>
                    </div>
                    <div className="model-setup" aria-label="Model provider setup">
                      <div className="eyebrow">{t('settings.modelAccess')}</div>
                      {modelSettingsUnavailable ? <p className="muted">Model setup is unavailable until the daemon exposes the authenticated settings adapter.</p> : <>
                        <p className="muted">{modelSettings?.configured ? `Configured via ${modelSettings.source}. The key is held by the daemon and is never shown here.` : modelSettings?.credentialState === 'required' ? 'Saved endpoint restored; enter the key again to enable new runs. The key is never persisted.' : 'Set up a provider here; no .env or YAML editing is required.'}</p>
                        {modelSettings?.baseUrl && <p className="muted">{modelSettings.providerId} · {modelSettings.baseUrl}{modelSettings.modelName ? ` · ${modelSettings.modelName}` : ''}</p>}
                        <form onSubmit={(event) => { void submitModelSettings(event); }}>
                          <label>{t('settings.providerUrl')}<input type="url" value={modelBaseUrl} onChange={(event) => setModelBaseUrl(event.target.value)} placeholder="https://api.deepseek.com" autoComplete="url" /></label>
                          <label>{t('settings.apiKey')}<input type="password" value={modelApiKey} onChange={(event) => setModelApiKey(event.target.value)} placeholder={modelSettings?.configured ? 'Enter a replacement key' : 'Paste once; never stored in browser'} autoComplete="new-password" /></label>
                          <div className="inline-actions"><button type="submit" disabled={!modelApiKey}>{t('settings.saveProvider')}</button>{modelSettings?.configured && <button className="cancel-button" type="button" onClick={() => { void (async () => { await onClearModelSettings?.(); setModelApiKey(''); })(); }}>{t('settings.clearDaemonKey')}</button>}</div>
                        </form>
                        <form onSubmit={(event) => { void submitModelProbe(event); }}>
                          <label>{t('settings.modelListEndpoint')}<input type="url" value={modelProbeEndpoint} onChange={(event) => setModelProbeEndpoint(event.target.value)} placeholder="https://api.deepseek.com/models" autoComplete="url" /></label>
                          <div className="inline-actions"><button type="submit" disabled={!onProbeModel || modelProbeBusy || !modelProbeEndpoint.trim()}>{t('settings.probeModels')}</button>{modelProbe && <span className="muted">{modelProbe.status}{modelProbe.errorCode ? ` · ${modelProbe.errorCode}` : modelProbe.capabilities ? ` · ${modelProbe.capabilities.modelId}` : ''}</span>}</div>
                        </form>
                      </>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="deepseek-settings" eyebrow="DEEPSEEK" title="DeepSeek provider" description="Configure the first-class DeepSeek adapter without editing files." status={deepSeekSettingsUnavailable ? 'unavailable' : deepSeekSettings?.credentialState === 'required' ? 'degraded' : deepSeekSettings?.configured ? 'ready' : 'idle'} statusLabel={deepSeekSettingsUnavailable ? 'Unavailable' : deepSeekSettings?.credentialState === 'required' ? 'Credential required' : deepSeekSettings?.configured ? 'Ready' : 'Not configured'}>
                    {deepSeekSettingsUnavailable ? <p className="muted">DeepSeek settings are unavailable; the existing provider surface remains unchanged.</p> : <form className="model-setup" onSubmit={(event) => { void submitDeepSeekSettings(event); }}>
                      <p className="muted">The API key is sent once to the daemon and is never returned or stored in browser state. Changes apply only to new runs.</p>
                      <label>Endpoint profile<select value={deepSeekEndpointProfile} disabled={deepSeekBusy} onChange={(event) => { const profileValue = event.target.value as DeepSeekSettingsInput['endpointProfile']; setDeepSeekEndpointProfile(profileValue); setDeepSeekEndpoint(profileValue === 'openai-responses' ? 'https://api.deepseek.com/v1/responses' : profileValue === 'anthropic-messages' ? 'https://api.deepseek.com/anthropic/v1/messages' : 'https://api.deepseek.com/v1/chat/completions'); }}><option value="openai-chat-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
                      <label>Complete endpoint<input type="url" value={deepSeekEndpoint} disabled={deepSeekBusy} onChange={(event) => setDeepSeekEndpoint(event.target.value)} placeholder="https://api.deepseek.com/v1/chat/completions" autoComplete="url" /></label>
                      <label>Model<input value={deepSeekModel} disabled={deepSeekBusy} onChange={(event) => setDeepSeekModel(event.target.value)} placeholder="deepseek-v4-flash" autoComplete="off" /></label>
                      <label>API key (write-only)<input type="password" value={deepSeekApiKey} disabled={deepSeekBusy} onChange={(event) => setDeepSeekApiKey(event.target.value)} placeholder="Paste once; never displayed" autoComplete="new-password" /></label>
                      <div className="settings-run-fields"><label>Thinking<select value={deepSeekThinking} disabled={deepSeekBusy} onChange={(event) => setDeepSeekThinking(event.target.value as DeepSeekSettingsInput['thinkingMode'])}><option value="off">Off</option><option value="auto">Auto</option><option value="high">High (probe required)</option><option value="max">Max (probe required)</option></select></label><label>Tool calling<select value={deepSeekToolCalling} disabled={deepSeekBusy} onChange={(event) => setDeepSeekToolCalling(event.target.value as DeepSeekSettingsInput['toolCalling'])}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label><label>Web search<select value={deepSeekSearch} disabled={deepSeekBusy || deepSeekEndpointProfile !== 'openai-responses'} onChange={(event) => setDeepSeekSearch(event.target.value as DeepSeekSettingsInput['webSearch'])}><option value="off">Off</option><option value="provider-owned">Provider-owned (Approval + network)</option></select></label><label>Reviewer<select value={deepSeekReviewer} disabled={deepSeekBusy} onChange={(event) => setDeepSeekReviewer(event.target.value as DeepSeekSettingsInput['reviewer'])}><option value="off">Off</option><option value="advisory">Advisory</option></select></label></div>
                      <div className="inline-actions"><button type="submit" disabled={deepSeekBusy || !deepSeekApiKey.trim()}>Save DeepSeek</button><button type="button" disabled={deepSeekBusy || !onProbeDeepSeek || !deepSeekSettings?.configured} onClick={() => { void probeDeepSeekSettings(); }}>Probe</button>{deepSeekSettings?.configured && <button className="cancel-button" type="button" disabled={deepSeekBusy} onClick={() => { void (async () => { await onClearDeepSeekSettings?.(); setDeepSeekApiKey(''); })(); }}>Clear</button>}</div>
                      {(deepSeekProbe || deepSeekSettings?.lastProbe) && <p className="muted">Probe: {(deepSeekProbe ?? deepSeekSettings?.lastProbe)?.status} · {(deepSeekProbe ?? deepSeekSettings?.lastProbe)?.errorCode ?? `latency ${(deepSeekProbe ?? deepSeekSettings?.lastProbe)?.latencyMs ?? 'n/a'} ms`}</p>}
                      {deepSeekSettings?.capability && <p className="muted">Capability: {deepSeekSettings.capability.status} · streaming {String(deepSeekSettings.capability.streaming)} · tools {String(deepSeekSettings.capability.toolCalls)} · reasoning {String(deepSeekSettings.capability.reasoning)} · revision {deepSeekSettings.capability.descriptorRevision}</p>}
                    </form>}
                  </SettingsSection>
                  <SettingsSection id="run-defaults" eyebrow="RUN DEFAULTS" title="Safety and limits" description="Conservative defaults apply to new runs only." status="idle" statusLabel="Local draft">
                    <div className="settings-run-fields">
                      <label>{t('settings.taskTrust')}<select value={profile.taskTrust} onChange={(event) => updateProfile({ taskTrust: event.target.value as RunProfile['taskTrust'] })}><option value="trusted-workspace">Trusted workspace</option><option value="untrusted-content">Untrusted content</option></select></label>
                      <label>{t('settings.sandbox')}<select value={profile.sandbox.mode} onChange={(event) => updateSandboxMode(event.target.value as RunProfile['sandbox']['mode'])}><option value="read-only">Read-only</option><option value="workspace-write">Workspace write</option><option value="external-sandbox">External sandbox</option></select></label>
                      <label>{t('settings.network')}<select value={'network' in profile.sandbox ? profile.sandbox.network : 'restricted'} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, network: event.target.value as 'restricted' | 'enabled' } as RunProfile['sandbox'] })}><option value="restricted">Restricted</option><option value="enabled">Enabled</option></select></label>
                      {profile.sandbox.mode === 'workspace-write' && <label>Writable roots<input value={profile.sandbox.writableRoots?.join(', ') ?? ''} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, writableRoots: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } })} /></label>}
                      {profile.sandbox.mode === 'external-sandbox' && <><label>Runtime<select value={profile.sandbox.provider} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, provider: event.target.value as 'docker' | 'podman' | 'vm' } })}><option value="docker">Docker</option><option value="podman">Podman</option><option value="vm">VM</option></select></label><label>Sandbox writable roots<input value={profile.sandbox.writableRoots?.join(', ') ?? ''} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, writableRoots: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } })} placeholder="src, tests" /></label></>}
                      <label>{t('settings.approval')}<select value={typeof profile.approval === 'string' ? profile.approval : 'on-request'} onChange={(event) => updateProfile({ approval: event.target.value as RunProfile['approval'] })}><option value="on-request">On request</option><option value="untrusted">Untrusted tasks</option><option value="never">Never (read-only only)</option></select></label>
                      <label>{t('settings.maxTurns')}<input type="number" min={1} max={50} value={profile.limits.maxTurns} onChange={(event) => updateLimit('maxTurns', event.target.value)} /></label>
                      <label>{t('settings.wallTime')}<input type="number" min={1} max={1800000} value={profile.limits.maxWallTimeMs} onChange={(event) => updateLimit('maxWallTimeMs', event.target.value)} /></label>
                      <label>{t('settings.modelInputTokens')}<input type="number" min={1} value={profile.limits.maxModelInputTokens} onChange={(event) => updateLimit('maxModelInputTokens', event.target.value)} /></label>
                      <label>{t('settings.modelOutputTokens')}<input type="number" min={1} value={profile.limits.maxModelOutputTokens} onChange={(event) => updateLimit('maxModelOutputTokens', event.target.value)} /></label>
                      <label>{t('settings.maxToolCalls')}<input type="number" min={1} max={200} value={profile.limits.maxToolCalls} onChange={(event) => updateLimit('maxToolCalls', event.target.value)} /></label>
                      <label>{t('settings.maxOutputBytes')}<input type="number" min={1} value={profile.limits.maxOutputBytes} onChange={(event) => updateLimit('maxOutputBytes', event.target.value)} /></label>
                      <label>{t('settings.maxContextBytes')}<input type="number" min={1} value={profile.limits.maxContextBytes} onChange={(event) => updateLimit('maxContextBytes', event.target.value)} /></label>
                    </div>
                    <button className="reset-button" type="button" onClick={onResetProfile}>{t('settings.resetDefaults')}</button>
                  </SettingsSection>
                </div>
              </SettingsTabPanel>
              <SettingsTabPanel tabId="tools" activeTab={settingsTab}>
                <div className="settings-grid">
                  <SettingsSection id="memory-settings" eyebrow="AGENT MEMORY" title="Long-term memory" description="Optional untrusted retrieval; it never grants tools or permissions." status={agentMemorySettingsUnavailable ? 'unavailable' : agentMemorySettings ? (agentMemorySettings.status.degraded ? 'degraded' : agentMemorySettings.status.available ? 'ready' : 'idle') : 'loading'} statusLabel={agentMemorySettingsUnavailable ? 'Unavailable' : agentMemorySettings?.status.degraded ? 'Degraded' : agentMemorySettings?.status.available ? 'Ready' : agentMemorySettings ? 'Disabled' : 'Loading'}>
                    <div className="tool-setup memory-setup" aria-label="Agent memory setup">
                      <div className="eyebrow">AGENT MEMORY</div>
                      {agentMemorySettingsUnavailable ? <p className="muted">Agent memory settings are unavailable; normal runs are unaffected.</p> : agentMemorySettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={memoryEnabled} disabled={memoryBusy} onChange={(event) => setMemoryEnabled(event.target.checked)} /><span>Enable optional long-term memory</span></label>
                        <p className="muted">Memory is an untrusted retrieval enhancement. It never grants tools, bypasses approval, or changes Goal/run facts.</p>
                        <div className="inline-actions"><label>Mode<select value={memoryMode} disabled={memoryBusy} onChange={(event) => setMemoryMode(event.target.value as AgentMemorySettingsMode)}><option value="memory-core">MemoryCore</option><option value="proxy">Proxy (later)</option><option value="full-stack">Full stack (later)</option><option value="off">Off</option></select></label><label>Interval (min)<input type="number" min={5} max={1440} value={memoryIntervalMinutes} disabled={memoryBusy} onChange={(event) => setMemoryIntervalMinutes(Math.max(5, Math.min(1440, Number(event.target.value) || 60)))} /></label></div>
                        <div className="inline-actions"><label>Team ID<input value={memoryTeamId} disabled={memoryBusy} onChange={(event) => setMemoryTeamId(event.target.value)} /></label><label>Agent ID<input value={memoryAgentId} disabled={memoryBusy} onChange={(event) => setMemoryAgentId(event.target.value)} /></label><label>User ID<input value={memoryUserId} disabled={memoryBusy} onChange={(event) => setMemoryUserId(event.target.value)} /></label></div>
                        <label>Upstream repository<input value={memoryUpstreamRepo} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRepo(event.target.value)} /></label>
                        <label>Upstream ref<input value={memoryUpstreamRef} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRef(event.target.value)} /></label>
                        <label className="toggle-row"><input type="checkbox" checked={memoryUpstreamRefLocked} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRefLocked(event.target.checked)} /><span>Lock ref to an immutable commit SHA</span></label>
                        <label className="toggle-row"><input type="checkbox" checked={memoryAutoUpdate} disabled={memoryBusy} onChange={(event) => setMemoryAutoUpdate(event.target.checked)} /><span>Allow scheduled upstream checks</span></label>
                        <label className="toggle-row"><input type="checkbox" checked={memoryFallback} disabled={memoryBusy} onChange={(event) => setMemoryFallback(event.target.checked)} /><span>Fall back to direct provider when memory is unavailable</span></label>
                        <p className="muted">Status: {agentMemorySettings.status.updateState} · {agentMemorySettings.status.available ? 'ready' : agentMemorySettings.status.degraded ? 'degraded' : 'disabled'} · current {agentMemorySettings.currentRevision ?? 'none'} · previous {agentMemorySettings.previousRevision ?? 'none'}</p>
                        {agentMemoryOperations && <p className="muted">Health {agentMemoryOperations.healthLatencyMs === null ? 'n/a' : `${agentMemoryOperations.healthLatencyMs} ms`} · recall hits {agentMemoryOperations.recall.hits} / misses {agentMemoryOperations.recall.misses} · write queue {agentMemoryOperations.writeQueue.pending} pending ({agentMemoryOperations.writeQueue.failed} failed)</p>}
                        {agentMemoryOperations && agentMemoryOperations.updates.length > 0 && <p className="muted">Recent: {agentMemoryOperations.updates.slice(-3).map((update) => `${update.operation} ${update.outcome}`).join(' · ')}</p>}
                        <div className="inline-actions"><button type="button" disabled={memoryBusy} onClick={() => { void saveAgentMemorySettings(); }}>Save memory settings</button><button type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onProbeAgentMemory); }}>Probe</button><button type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onUpdateAgentMemory); }}>Update</button><button className="cancel-button" type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onRollbackAgentMemory); }}>Roll back</button></div>
                      </> : <p className="muted">Pair with the daemon to configure optional memory.</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="knowledge-settings" eyebrow="KNOWLEDGE RETRIEVAL" title="Knowledge retrieval" description="Explicit bounded Wiki/CodeGraph context only; never a tool permission." status={agentMemoryKnowledgeSettingsUnavailable ? 'unavailable' : agentMemoryKnowledgeSettings ? (agentMemoryKnowledgeSettings.degraded ? 'degraded' : agentMemoryKnowledgeSettings.available ? 'ready' : 'idle') : 'loading'} statusLabel={agentMemoryKnowledgeSettingsUnavailable ? 'Unavailable' : agentMemoryKnowledgeSettings?.degraded ? 'Degraded' : agentMemoryKnowledgeSettings?.available ? 'Ready' : agentMemoryKnowledgeSettings ? 'Not probed' : 'Loading'}>
                    <div className="tool-setup knowledge-setup" aria-label="Agent memory knowledge setup">
                      <div className="eyebrow">KNOWLEDGE RETRIEVAL</div>
                      {agentMemoryKnowledgeSettingsUnavailable ? <p className="muted">Knowledge settings are unavailable; normal runs are unaffected.</p> : agentMemoryKnowledgeSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={knowledgeEnabled} disabled={knowledgeBusy} onChange={(event) => setKnowledgeEnabled(event.target.checked)} /><span>Enable optional knowledge resource</span></label>
                        <p className="muted">Only explicit, bounded Wiki/CodeGraph retrieval is allowed. Results are untrusted context and never become tools or permissions.</p>
                        <label>Resource ID<input value={knowledgeId} disabled={knowledgeBusy} onChange={(event) => setKnowledgeId(event.target.value)} placeholder="wiki_demo" autoComplete="off" /></label>
                        <label className="toggle-row"><input type="checkbox" checked={knowledgeAutoRetrieve} disabled={knowledgeBusy || !knowledgeEnabled} onChange={(event) => setKnowledgeAutoRetrieve(event.target.checked)} /><span>Retrieve once for each new run</span></label>
                        <div className="inline-actions"><label>Max items<input type="number" min={1} max={64} value={knowledgeMaxItems} disabled={knowledgeBusy} onChange={(event) => setKnowledgeMaxItems(clampKnowledgeLimit(event.target.value, 1, 64, 8))} /></label><label>Max bytes<input type="number" min={256} max={131072} value={knowledgeMaxBytes} disabled={knowledgeBusy} onChange={(event) => setKnowledgeMaxBytes(clampKnowledgeLimit(event.target.value, 256, 131072, 8192))} /></label><label>Timeout (ms)<input type="number" min={50} max={10000} value={knowledgeTimeoutMs} disabled={knowledgeBusy} onChange={(event) => setKnowledgeTimeoutMs(clampKnowledgeLimit(event.target.value, 50, 10000, 750))} /></label></div>
                        <p className="muted">Status: {agentMemoryKnowledgeSettings.available ? 'ready' : agentMemoryKnowledgeSettings.degraded ? `degraded${agentMemoryKnowledgeSettings.lastErrorCode ? ` · ${agentMemoryKnowledgeSettings.lastErrorCode}` : ''}` : 'not probed'} · {agentMemoryKnowledgeSettings.resourceName ?? 'resource not probed'} · revision {agentMemoryKnowledgeSettings.sourceRevision ?? 'none'}</p>
                        {agentMemoryKnowledgeSettings.tools.length > 0 && <p className="muted">Read-only tools: {agentMemoryKnowledgeSettings.tools.map((tool) => tool.name).join(', ')}</p>}
                        <div className="inline-actions"><button type="button" disabled={knowledgeBusy} onClick={() => { void saveAgentMemoryKnowledgeSettings(); }}>Save knowledge settings</button><button type="button" disabled={knowledgeBusy || !knowledgeEnabled} onClick={() => { void probeAgentMemoryKnowledge(); }}>Probe knowledge</button></div>
                      </> : <p className="muted">Pair with the daemon to configure optional knowledge retrieval.</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="mcp-settings" eyebrow="MCP / SKILL" title="MCP capability bridge" description="Optional capabilities remain untrusted until explicit activation review." status={mcpSettingsUnavailable ? 'unavailable' : mcpSettings ? 'idle' : 'loading'} statusLabel={mcpSettingsUnavailable ? 'Unavailable' : mcpSettings ? mcpSettings.status : 'Loading'}>
                    <div className="tool-setup mcp-setup" aria-label="MCP and Skill setup">
                      <div className="eyebrow">MCP / SKILL</div>
                      {mcpSettingsUnavailable ? <p className="muted">MCP settings are unavailable; normal runs are unaffected.</p> : mcpSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={mcpEnabled} disabled={mcpBusy} onChange={(event) => setMcpEnabled(event.target.checked)} /><span>Enable optional MCP integration</span></label>
                        <p className="muted">MCP stays outside the default run path. Capabilities remain untrusted until a later explicit activation review.</p>
                        <div className="inline-actions"><label>Server ID<input value={mcpServerId} disabled={mcpBusy} onChange={(event) => setMcpServerId(event.target.value)} /></label><label>Server version<input value={mcpServerVersion} disabled={mcpBusy} onChange={(event) => setMcpServerVersion(event.target.value)} /></label><label>Transport<select value={mcpTransport} disabled={mcpBusy} onChange={(event) => setMcpTransport(event.target.value as 'stdio' | 'streamable-http')}><option value="stdio">stdio</option><option value="streamable-http">Streamable HTTP</option></select></label></div>
                        <label>Endpoint label<input value={mcpEndpointLabel} disabled={mcpBusy} onChange={(event) => setMcpEndpointLabel(event.target.value)} placeholder="Local MCP server" /></label>
                        <label>Manifest revision<input value={mcpManifestRevision} disabled={mcpBusy} onChange={(event) => setMcpManifestRevision(event.target.value)} /></label>
                        <label>Capability references<input value={mcpCapabilityAllowlist} disabled={mcpBusy} onChange={(event) => setMcpCapabilityAllowlist(event.target.value)} placeholder="server/tool/name@1.0.0, …" /></label>
                        <p className="muted">Status: {mcpSettings.status} · {mcpSettings.health ?? 'not probed'} · revision {mcpSettings.currentRevision ?? 'none'} · capabilities {mcpSettings.capabilityCount} · next {mcpSettings.nextAction}{mcpSettings.lastErrorCode ? ` · ${mcpSettings.lastErrorCode}` : ''}</p>
                        <div className="inline-actions"><button type="button" disabled={mcpBusy} onClick={() => { void saveMcpSettings(); }}>Save MCP settings</button><button type="button" disabled={mcpBusy || !mcpEnabled} onClick={() => { void probeMcp(); }}>Probe MCP</button></div>
                      </> : <p className="muted">Pair with the daemon to configure optional MCP/Skill status.</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="filesystem-settings" eyebrow="TOOL ACCESS" title="Guarded filesystem" description="Bounded reads and approval-gated writes." status={toolSettingsUnavailable ? 'unavailable' : toolSettings ? 'ready' : 'loading'} statusLabel={toolSettingsUnavailable ? 'Unavailable' : toolSettings ? 'Ready' : 'Loading'}>
                    <div className="tool-setup" aria-label="Filesystem tool setup">
                      <div className="eyebrow">TOOL ACCESS</div>
                      {toolSettingsUnavailable ? <p className="muted">Tool settings are unavailable until the daemon exposes the authenticated adapter.</p> : toolSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={toolSettings.filesystemEnabled} disabled={toolToggleBusy} onChange={(event) => { void toggleFilesystemTools(event.target.checked); }} /><span>Enable guarded filesystem tools</span></label>
                        <p className="muted">Workspace: {toolSettings.workspaceLabel}. Reads are bounded; writes still require approval. Shell, MCP, and network tools remain disabled here; Git reads have a separate toggle.</p>
                        {toolSettings.availableTools.length > 0 && <p className="muted">Available: {toolSettings.availableTools.join(', ')}</p>}
                      </> : <p className="muted">Pair with the daemon to configure guarded filesystem tools.</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="git-settings" eyebrow="GIT READ-ONLY TOOLS" title="Git read-only tools" description="Status, diff, and log only; no write operations." status={gitSettingsUnavailable ? 'unavailable' : gitSettings ? 'ready' : 'loading'} statusLabel={gitSettingsUnavailable ? 'Unavailable' : gitSettings ? 'Ready' : 'Loading'}>
                    <div className="tool-setup" aria-label="Git read-only tool setup">
                      <div className="eyebrow">GIT READ-ONLY TOOLS</div>
                      {gitSettingsUnavailable ? <p className="muted">Git settings are unavailable until the daemon exposes the authenticated adapter.</p> : gitSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={gitSettings.enabled} disabled={gitToggleBusy} onChange={(event) => { void toggleGitTools(event.target.checked); }} /><span>Enable Git read-only tools</span></label>
                        <p className="muted">Workspace: {gitSettings.workspaceLabel}. This exposes only bounded status, diff, and log reads; commits, checkout, reset, patch writes, remotes, and arbitrary Git flags remain unavailable.</p>
                        {gitSettings.availableTools.length > 0 && <p className="muted">Available: {gitSettings.availableTools.join(', ')}</p>}
                      </> : <p className="muted">Pair with the daemon to configure Git read-only tools.</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="sandbox-settings" eyebrow="EXTERNAL SANDBOX" title="External sandbox" description="Docker/Podman shell is opt-in and has no host fallback." status={sandboxSettingsUnavailable ? 'unavailable' : sandboxSettings ? (sandboxSettings.healthy ? 'ready' : sandboxSettings.detected ? 'degraded' : 'idle') : 'loading'} statusLabel={sandboxSettingsUnavailable ? 'Unavailable' : sandboxSettings?.healthy ? 'Ready' : sandboxSettings?.detected ? 'Degraded' : sandboxSettings ? 'Not probed' : 'Loading'}>
                    <div className="tool-setup" aria-label="External sandbox setup">
                      <div className="eyebrow">EXTERNAL SANDBOX</div>
                      {sandboxSettingsUnavailable ? <p className="muted">External sandbox settings are unavailable until the authenticated adapter is ready.</p> : sandboxSettings ? <>
                        <p className="muted">Docker/Podman shell is off by default. Probe the runtime, then enable it explicitly; no host shell fallback exists.</p>
                        <div className="inline-actions"><label>Provider<select value={sandboxProvider} disabled={sandboxBusy} onChange={(event) => setSandboxProvider(event.target.value as 'docker' | 'podman')}><option value="docker">Docker</option><option value="podman">Podman</option></select></label><label>Network<select value={sandboxNetwork} disabled={sandboxBusy} onChange={(event) => setSandboxNetwork(event.target.value as 'restricted' | 'enabled')}><option value="restricted">Restricted</option><option value="enabled">Enabled (warning)</option></select></label><button type="button" disabled={sandboxBusy} onClick={() => { void probeSandbox(); }}>Probe runtime</button></div>
                        <label>Image digest<input value={sandboxImageDigest} disabled={sandboxBusy} onChange={(event) => setSandboxImageDigest(event.target.value)} placeholder="registry.example/agent@sha256:..." /></label>
                        <p className="muted">Status: {sandboxSettings.detected ? (sandboxSettings.healthy ? `healthy${sandboxSettings.capabilities?.version ? ` · ${sandboxSettings.capabilities.version}` : ''}` : 'detected but unhealthy') : 'not probed'} · configured network: {sandboxNetwork} · {sandboxSettings.enabled ? 'enabled' : 'disabled'}</p>
                        <button type="button" disabled={sandboxBusy || !sandboxSettings.healthy || !sandboxImageDigest} onClick={() => { void toggleSandbox(!sandboxSettings.enabled); }}>{sandboxSettings.enabled ? 'Disable external shell' : 'Enable external shell'}</button>
                      </> : <p className="muted">Pair with the daemon to configure external sandbox execution.</p>}
                    </div>
                  </SettingsSection>
                </div>
              </SettingsTabPanel>
              <SettingsTabPanel tabId="access" activeTab={settingsTab}>
                <div className="settings-grid">
                  <SettingsSection id="certificate-settings" eyebrow="TLS STATUS" title="Certificate" description="Private keys stay in the daemon certificate adapter." status={certificateStatus ? 'ready' : health?.transport.tlsRequired || certificateStatusUnavailable ? 'degraded' : 'idle'} statusLabel={certificateStatus ? 'Ready' : health?.transport.tlsRequired || certificateStatusUnavailable ? 'Required' : 'Loopback'}>
                    <div className="certificate-guidance">
                      <div className="eyebrow">TLS STATUS</div>
                      {certificateStatus ? <><strong>{certificateStatus.subject}</strong><p className="muted">Valid to {new Date(certificateStatus.validTo).toLocaleDateString()} · {certificateStatus.daysRemaining} days remaining</p><p className="muted">SAN: {certificateStatus.subjectAltNames.join(', ') || 'not reported'}</p></> : health?.transport.tlsRequired || certificateStatusUnavailable ? <p className="muted">Certificate setup is required for this TLS transport. Use the daemon certificate adapter; private keys are never entered or shown in this browser.</p> : <p className="muted">Loopback HTTP is active for local development. Pairing and future TLS setup remain available.</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="deployment-settings" eyebrow="DEPLOYMENT STATUS" title="Access readiness" description="LAN and future Tailscale/SSH/public modes remain explicit and fail-closed." status={deploymentReadiness?.status === 'ready' ? 'ready' : deploymentReadiness?.status === 'blocked' ? 'degraded' : deploymentReadinessUnavailable ? 'unavailable' : 'loading'} statusLabel={deploymentReadiness?.status ?? (deploymentReadinessUnavailable ? 'Unavailable' : 'Loading')}>
                    <div className="deployment-readiness" data-status={deploymentReadiness?.status ?? 'unknown'}>
                      <div className="eyebrow">DEPLOYMENT STATUS</div>
                      {deploymentReadiness ? <><strong>{deploymentReadiness.status} · {deploymentReadiness.mode}</strong><p className="muted">Reason: {deploymentReadiness.reasonCode} · Next: {deploymentReadiness.nextStep}</p></> : deploymentReadinessUnavailable ? <p className="muted">Deployment readiness is unavailable; existing pairing and run controls remain usable.</p> : <p className="muted">Reading deployment readiness…</p>}
                    </div>
                  </SettingsSection>
                </div>
              </SettingsTabPanel>
            </SettingsTabs>
          </SettingsSheet>
          {!connected && <>
            <section className="panel connection-panel">
              <div className="eyebrow">CONNECTION</div>
              <h1>{t('connection.workspaceTitle')}</h1>
              <p className="muted">Vibe Coding，随时随地；执行有边界，进度可继续。</p>
              {health ? <dl className="summary-list"><div><dt>transport</dt><dd>{health.transport.kind}</dd></div><div><dt>TLS</dt><dd>{health.transport.tlsRequired ? 'required' : 'off'}</dd></div><div><dt>sandbox</dt><dd>{health.sandbox.availableModes.join(' · ')}</dd></div></dl> : <p className="muted">正在读取 daemon 状态…</p>}
            </section>
            <section className="panel pairing-panel"><div className="eyebrow">PAIRING</div><h2>{t('connection.pairingTitle')}</h2><p className="muted">{t('connection.pairingDescription')}</p><form onSubmit={submitPairing}><label htmlFor="pairing-code">Pairing code</label><input id="pairing-code" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} autoComplete="off" inputMode="text" /><button type="submit">{t('connection.pairingAction')}</button></form></section>
            <section className="panel safety-panel"><div className="eyebrow">{t('guardrails.title')}</div><ul><li>{t('guardrails.untrusted')}</li><li>{t('guardrails.approval')}</li><li>{t('guardrails.sse')}</li></ul></section>
          </>}
        </aside>
        <section className="main-column">
          {error && <ToastViewport><Toast variant="error" title={error} {...(onDismissError ? { onDismiss: onDismissError } : {})} /></ToastViewport>}
          {connected ? <ConversationShell run={run} events={events} message={message} profile={profile} composerRef={composerRef} copy={{ title: t('conversation.title'), hint: t('conversation.hint'), newMessage: t('conversation.newMessage'), inputLabel: t('conversation.inputLabel'), inputPlaceholder: t('conversation.inputPlaceholder'), startRun: t('conversation.startRun'), readyTitle: t('conversation.readyTitle'), readyDescription: t('conversation.readyDescription'), untrustedPolicy: 'untrusted content · external sandbox', trustedPolicy: 'trusted workspace · read-only' }} onMessageChange={setMessage} onSubmit={submitRun} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} /> : <section className="panel empty-state"><span className="empty-icon">◎</span><h2>先完成安全配对</h2><p className="muted">daemon 默认不会把 token 放进 URL、cookie 或本地存储。</p></section>}
        </section>
        {connected && <ContextRail open={contextOpen} goalProjection={goalProjection} goalProjectionLoading={goalProjectionLoading} goalProjectionUnavailable={goalProjectionUnavailable} goalProjectionRefreshing={goalProjectionRefreshing} {...(onRefreshGoalProjection ? { onRefreshGoalProjection } : {})} {...(onCreateGoal ? { onCreateGoal } : {})} {...(onAddTodo ? { onAddTodo } : {})} {...(onOpenGate ? { onOpenGate } : {})} {...(onResolveGate ? { onResolveGate } : {})} {...(onAttachEvidence ? { onAttachEvidence } : {})} {...(onPreflight ? { onPreflight } : {})} usageSummary={usageSummary} auditEvents={auditEvents} observabilityLoading={observabilityLoading} observabilityUnavailable={observabilityUnavailable} observabilityRefreshing={observabilityRefreshing} {...(onRefreshObservability ? { onRefreshObservability } : {})} {...(health ? { health } : {})} copy={{ ariaLabel: 'Run context', connectionEyebrow: 'CONNECTION', connectionTitle: 'Connected workspace', description: 'Vibe Coding，随时随地；执行有边界，进度可继续。', transport: 'transport', tls: 'TLS', sandbox: 'sandbox', safetyTitle: t('guardrails.title'), guardrails: [t('guardrails.untrusted'), t('guardrails.approval'), t('guardrails.sse')], tabGoals: t('rail.goals'), tabTelemetry: t('rail.telemetry'), tabWorkspace: t('rail.workspace') }} />}
      </section>
    </main>
  );
}

function clampLimit(key: keyof RunProfile['limits'], value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  const maximum = key === 'maxTurns' ? 50 : key === 'maxWallTimeMs' ? 1_800_000 : key === 'maxToolCalls' ? 200 : Number.MAX_SAFE_INTEGER;
  return Math.min(maximum, Math.max(1, Math.floor(parsed)));
}

function clampKnowledgeLimit(value: string, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}
