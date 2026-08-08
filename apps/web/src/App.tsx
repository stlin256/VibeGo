import type { FormEvent, JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { clampSandboxToCapability, DEFAULT_RUN_PROFILE, type AgentMemoryKnowledgeSettingsPatchInput, type AgentMemoryKnowledgeSettingsStatus, type AgentMemoryOperationsStatus, type AgentMemorySettingsMode, type AgentMemorySettingsPatchInput, type AgentMemorySettingsStatus, type ApprovalReviewSettingsPatchInput, type ApprovalReviewSettingsStatus, type AuditEventsResponse, type CapabilityProfile, type CapabilityProfileSettingsPatchInput, type CapabilityProfileSettingsStatus, type CertificateStatus, type DeepSeekProbeResult, type DeepSeekSettingsInput, type DeepSeekSettingsStatus, type DeploymentReadinessStatus, type GitSettingsStatus, type HealthResponse, type McpSettingsPatchInput, type McpSettingsStatus, type ModelProbeResult, type ModelSettingsInput, type ModelSettingsStatus, type PermissionApprovalPosture, type PermissionProfile, type PermissionProfileSettingsPatchInput, type PermissionProfileSettingsStatus, type PermissionStatus, type SandboxSettingsStatus, type ToolSettingsStatus, type UsageSummary, type WorkspaceRegistryStatus, type RunProfile, type RunSnapshot, type RunSummary, type ConversationMessage, type StoredEvent } from './api.js';
import type { GoalMutationResponse, GoalPreflightResult, GoalProjectionListResponse } from './api.js';
import { focusFirst, focusableElements, nextFocusIndex } from './accessibility.js';
import { ApprovalReviewSettingsCard, ContextRail, ConversationHeader, ConversationShell, PermissionProfileCard, SettingsSection, SettingsSheet, SettingsTabPanel, SettingsTabs, SetupWizard, WorkspaceRail } from './components/vibego/index.js';
import { Button, Toast, ToastViewport } from './components/ui/index.js';
import { createTranslator, type Locale } from './locale.js';
import { loadSetupDismissed, saveSetupDismissed } from './setup.js';
import { cycleTheme, type Theme } from './theme.js';
import './styles.css';

type SettingsTabId = 'run' | 'tools' | 'access';

export interface AppProps {
  health?: HealthResponse;
  /** When set, drives the connected state from the actual client session instead of the daemon-global health flag. */
  sessionReady?: boolean;
  run?: RunSnapshot;
  events?: readonly StoredEvent[];
  error?: string;
  onDismissError?: () => void;
  onCreateAccount?: (password: string) => void;
  onLogin?: (password: string) => void;
  onCreateRun?: (message: string) => void;
  onCancel?: () => void;
  onApprove?: (approvalId: string, decision: 'allow' | 'deny') => void;
  onRetry?: () => void;
  runHistory?: readonly RunSummary[];
  onOpenRun?: (runId: string) => void;
  /** Past exchanges of the active conversation, rendered above the live run. */
  thread?: readonly ConversationMessage[];
  /** Rail highlight key: conversation id for grouped entries, run id for legacy runs. */
  activeRailKey?: string;
  onOpenConversation?: (key: string) => void;
  onNewTask?: () => void;
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

export function App({ health, sessionReady, run, events = [], error, onDismissError, onCreateAccount, onLogin, onCreateRun, onCancel, onApprove, onRetry, runHistory, onOpenRun, thread = [], activeRailKey, onOpenConversation, onNewTask, locale = 'en-US', onLocaleChange, theme = 'light', onThemeChange, profile = DEFAULT_RUN_PROFILE, onProfileChange, onResetProfile, capabilityProfileSettings, capabilityProfileSettingsUnavailable = false, onPatchCapabilityProfileSettings, onResetCapabilityProfileSettings, permissionSettings, permissionStatus, permissionSettingsUnavailable = false, onPatchPermissionSettings, onConfirmFullHost, onRevokePermission, approvalReviewSettings, approvalReviewSettingsUnavailable = false, onPatchApprovalReviewSettings, onProbeApprovalReview, certificateStatus, certificateStatusUnavailable = false, deploymentReadiness, deploymentReadinessUnavailable = false, modelSettings, modelSettingsUnavailable = false, modelProbe, onConfigureModel, onClearModelSettings, onProbeModel, deepSeekSettings, deepSeekSettingsUnavailable = false, deepSeekProbe, onConfigureDeepSeek, onClearDeepSeekSettings, onProbeDeepSeek, agentMemorySettings, agentMemorySettingsUnavailable = false, onPatchAgentMemorySettings, onProbeAgentMemory, onUpdateAgentMemory, onRollbackAgentMemory, agentMemoryOperations, agentMemoryKnowledgeSettings, agentMemoryKnowledgeSettingsUnavailable = false, onPatchAgentMemoryKnowledgeSettings, onProbeAgentMemoryKnowledge, mcpSettings, mcpSettingsUnavailable = false, onPatchMcpSettings, onProbeMcp, toolSettings, toolSettingsUnavailable = false, onSetFilesystemToolsEnabled, gitSettings, gitSettingsUnavailable = false, onSetGitToolsEnabled, sandboxSettings, sandboxSettingsUnavailable = false, onProbeSandbox, onSetSandboxSettings, workspaces, workspacesUnavailable = false, onAddWorkspace, onRemoveWorkspace, goalProjection, goalProjectionLoading = false, goalProjectionUnavailable = false, goalProjectionRefreshing = false, onRefreshGoalProjection, onCreateGoal, onAddTodo, onOpenGate, onResolveGate, onAttachEvidence, onPreflight, usageSummary, auditEvents, observabilityLoading = false, observabilityUnavailable = false, observabilityRefreshing = false, onRefreshObservability }: AppProps): JSX.Element {
  const t = createTranslator(locale);
  const [accountPassword, setAccountPassword] = useState('');
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('');
  const [accountFormError, setAccountFormError] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [modelBaseUrl, setModelBaseUrl] = useState('https://api.deepseek.com');
  const [modelApiKey, setModelApiKey] = useState('');
  const [modelProbeEndpoint, setModelProbeEndpoint] = useState('https://api.deepseek.com/models');
  const [modelProbeBusy, setModelProbeBusy] = useState(false);
  const [deepSeekEndpointProfile, setDeepSeekEndpointProfile] = useState<DeepSeekSettingsInput['endpointProfile']>('openai-chat-completions');
  const [deepSeekEndpoint, setDeepSeekEndpoint] = useState('https://api.deepseek.com/v1/chat/completions');
  const [deepSeekModel, setDeepSeekModel] = useState('deepseek-v4-flash');
  const [deepSeekApiKey, setDeepSeekApiKey] = useState('');
  const [providerPreset, setProviderPreset] = useState<'deepseek' | 'openai-compatible'>(() => deepSeekSettings?.configured === true ? 'deepseek' : modelSettings !== undefined || modelProbe !== undefined ? 'openai-compatible' : 'deepseek');
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
  const [setupDismissed, setSetupDismissed] = useState(() => loadSetupDismissed());
  const [setupForcedOpen, setSetupForcedOpen] = useState(false);
  const [setupActive, setSetupActive] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  /** Brief success toast after any settings save; each save re-triggers it. */
  const [savedCount, setSavedCount] = useState(0);
  const [savedVisible, setSavedVisible] = useState(false);
  const notifySaved = (): void => setSavedCount((count) => count + 1);
  useEffect(() => {
    if (savedCount === 0) return;
    setSavedVisible(true);
    const timer = window.setTimeout(() => setSavedVisible(false), 2400);
    return () => window.clearTimeout(timer);
  }, [savedCount]);
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
  const connected = sessionReady ?? health?.auth.pairingRequired === false;
  const accountExists = health?.auth.accountCreated === true;
  const submitAccount = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (accountPassword.length < 4) { setAccountFormError(t('connection.accountPasswordHint')); return; }
    if (!accountExists && accountPassword !== accountPasswordConfirm) { setAccountFormError(t('connection.accountPasswordMismatch')); return; }
    setAccountFormError(undefined);
    if (accountExists) onLogin?.(accountPassword);
    else onCreateAccount?.(accountPassword);
  };
  const providerSettingsLoaded = deepSeekSettings !== undefined || modelSettings !== undefined;
  const modelConfigured = deepSeekSettings?.configured === true || modelSettings?.configured === true;
  /** Daemon-resolved effective capability profile: `undefined` while settings load, `null` when the resolution is blocked. */
  const effectiveCapabilityProfile = capabilityProfileSettings === undefined ? undefined : capabilityProfileSettings.resolution.status === 'blocked' ? null : capabilityProfileSettings.resolution.effectiveProfile;
  useEffect(() => { if (connected === true && providerSettingsLoaded && !modelConfigured && !setupDismissed) setSetupActive(true); }, [connected, providerSettingsLoaded, modelConfigured, setupDismissed]);
  const setupOpen = connected === true && (setupActive || setupForcedOpen);
  const closeSetup = (): void => { saveSetupDismissed(); setSetupDismissed(true); setSetupForcedOpen(false); setSetupActive(false); };
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
      notifySaved();
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
    if (profileId === 'advanced-local') return { schemaVersion: 'ready4vibe_capability_profile_v1', profileId, transportMode, ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}), modelMode: modelConfigured ? 'configured' : 'fake', filesystemMode: 'workspace-write', shellMode: 'host-restricted', networkMode: 'off', mcpSkillMode: 'off', approvalMode: 'explicit', policyRevision: current.policyRevision, requiresAcknowledgement: capabilityAcknowledged, updatedAt };
    if (profileId === 'workspace-coding') return { schemaVersion: 'ready4vibe_capability_profile_v1', profileId, transportMode, ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}), modelMode: modelConfigured ? 'configured' : 'fake', filesystemMode: 'workspace-write', shellMode: 'off', networkMode: 'off', mcpSkillMode: 'off', approvalMode: 'on-request', policyRevision: current.policyRevision, requiresAcknowledgement: false, updatedAt };
    return { ...current, profileId: 'custom', ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}), updatedAt };
  };
  const saveCapabilityProfile = async (): Promise<void> => {
    if (!onPatchCapabilityProfileSettings || !capabilityProfileSettings) return;
    const next = buildCapabilityProfile(capabilityProfileId);
    if (!next) return;
    setCapabilityBusy(true);
    try {
      await onPatchCapabilityProfileSettings({ profile: next, expectedRevision: capabilityProfileSettings.currentRevision });
      notifySaved();
    } catch { /* Parent renders a safe error and keeps the draft for retry. */ } finally { setCapabilityBusy(false); }
  };
  const resetCapabilityProfile = async (): Promise<void> => {
    if (!onResetCapabilityProfileSettings || !capabilityProfileSettings) return;
    setCapabilityBusy(true);
    try { await onResetCapabilityProfileSettings(capabilityProfileSettings.currentRevision); notifySaved(); } catch { /* Parent renders a safe error. */ } finally { setCapabilityBusy(false); }
  };
  const submitDeepSeekSettings = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!onConfigureDeepSeek || !deepSeekApiKey.trim()) return;
    setDeepSeekBusy(true);
    try {
      await onConfigureDeepSeek({ endpointProfile: deepSeekEndpointProfile, endpoint: deepSeekEndpoint, model: deepSeekModel, apiKey: deepSeekApiKey, thinkingMode: deepSeekThinking, toolCalling: deepSeekToolCalling, webSearch: deepSeekSearch, reviewer: deepSeekReviewer, ...(deepSeekSettings?.profile?.profileRevision ? { expectedRevision: deepSeekSettings.profile.profileRevision } : {}) });
      setDeepSeekApiKey('');
      updateProfile({ model: { provider: 'deepseek', name: deepSeekModel } });
      notifySaved();
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
      notifySaved();
    } catch { /* Parent renders a safe error and keeps the draft for retry. */ } finally { setPermissionBusy(false); }
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
    try { await onPatchApprovalReviewSettings(input); notifySaved(); }
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
      notifySaved();
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
      notifySaved();
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
      notifySaved();
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
    onNewTask?.();
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
  // A persisted or stale composer selection that exceeds the effective capability
  // profile would be blocked at run creation; clamp it to the always-available mode.
  useEffect(() => {
    const clamped = clampSandboxToCapability(profile.sandbox, effectiveCapabilityProfile);
    if (clamped !== profile.sandbox) updateProfile({ sandbox: clamped });
  }, [effectiveCapabilityProfile, profile.sandbox]);
  const openSettings = (target: HTMLElement): void => {
    settingsTriggerRef.current = target;
    setSettingsOpen(true);
  };

  return (
    <main className="app-shell">
      <ConversationHeader connected={connected} contextOpen={contextOpen} settingsOpen={settingsOpen} locale={locale} theme={theme} onToggleTheme={() => onThemeChange?.(cycleTheme(theme))} copy={{ brandName: t('brand.name'), brandPrefix: 'Vibe', brandSuffix: 'Go', newTask: t('nav.newTask'), hideDetails: t('nav.hideDetails'), showDetails: t('nav.showDetails'), settings: t('nav.settings'), localeLabel: t('locale.label'), localeEnglish: t('locale.english'), localeChinese: t('locale.chinese'), themeToggle: t('theme.toggle'), themeLight: t('theme.light'), themeDark: t('theme.dark'), connected: t('connection.connected'), awaitingPairing: t('connection.awaitingPairing') }} onNewTask={startNewTask} onToggleContext={() => setContextOpen((current) => !current)} onOpenSettings={openSettings} onLocaleChange={onLocaleChange} />
      <div className="sr-only" aria-live="polite" aria-label={t('accessibility.statusLabel')}>{error ?? (connected ? t('connection.connected') : t('connection.awaitingPairing'))}</div>
      <section className="content-grid">
        <WorkspaceRail workspaceLabel={workspaces?.workspaces.find((workspace) => workspace.id === profile.workspaceId)?.label ?? profile.workspaceId} settingsOpen={settingsOpen} copy={{ navigationLabel: t('workspace.navigationLabel'), newTask: t('nav.newTask'), recent: t('workspace.recent'), currentTask: t('nav.currentTask'), settings: t('nav.settings') }} onNewTask={startNewTask} onOpenSettings={openSettings} history={runHistory ?? []} activeKey={activeRailKey ?? run?.runId} {...(onOpenConversation ? { onOpenConversation } : onOpenRun ? { onOpenConversation: onOpenRun } : {})} />
        <aside className="sidebar" aria-label={t('accessibility.sidebarLabel')}>
          <SettingsSheet open={settingsOpen} panelRef={settingsPanelRef} copy={{ eyebrow: t('settings.eyebrow'), title: t('settings.title'), description: t('settings.description'), close: t('settings.close') }} onClose={() => setSettingsOpen(false)}>
            <SettingsTabs ariaLabel={t('settings.tabsAriaLabel')} tabs={[{ id: 'run', label: t('settings.tabRun') }, { id: 'tools', label: t('settings.tabTools') }, { id: 'access', label: t('settings.tabAccess') }]} activeTab={settingsTab} onTabChange={(tabId) => { if (tabId === 'run' || tabId === 'tools' || tabId === 'access') setSettingsTab(tabId); }}>
              <SettingsTabPanel tabId="run" activeTab={settingsTab}>
                <div className="settings-grid">
                  <SettingsSection id="permission-profile-settings" eyebrow={t('settings.permission.eyebrow')} title={t('settings.permission.title')} description={t('settings.permission.description')} status={permissionSettingsUnavailable ? 'unavailable' : permissionStatus?.status === 'blocked' || permissionSettings?.resolution.status === 'blocked' ? 'degraded' : permissionStatus?.status === 'degraded' || permissionSettings?.resolution.status === 'degraded' ? 'degraded' : permissionSettings ? 'ready' : 'loading'} statusLabel={permissionSettingsUnavailable ? t('settings.status.unavailable') : permissionStatus?.status ?? permissionSettings?.resolution.status ?? t('settings.status.loading')}>
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
                      copy={{ eyebrow: t('settings.permission.eyebrow'), ariaLabel: t('settings.permission.ariaLabel'), unavailableNote: t('settings.permission.unavailableNote'), unpairedNote: t('settings.permission.unpairedNote'), profilesAriaLabel: t('settings.permission.profilesAriaLabel'), workspaceCodingLabel: t('settings.permission.workspaceCodingLabel'), workspaceCodingDescription: t('settings.permission.workspaceCodingDescription'), fullHostLabel: t('settings.permission.fullHostLabel'), fullHostDescription: t('settings.permission.fullHostDescription'), safeBadge: t('settings.permission.safeBadge'), riskBadge: t('settings.permission.riskBadge'), postureAriaLabel: t('settings.permission.postureAriaLabel'), postureEyebrow: t('settings.permission.postureEyebrow'), boundedAutoLabel: t('settings.permission.boundedAutoLabel'), boundedAutoDescription: t('settings.permission.boundedAutoDescription'), sessionAutoLabel: t('settings.permission.sessionAutoLabel'), sessionAutoDescription: t('settings.permission.sessionAutoDescription'), explicitLabel: t('settings.permission.explicitLabel'), explicitDescription: t('settings.permission.explicitDescription'), fullHostPostureHint: t('settings.permission.fullHostPostureHint'), statusLabel: t('settings.grid.status'), revisionLabel: t('settings.grid.revision'), requestedLabel: t('settings.grid.requested'), effectiveLabel: t('settings.grid.effective'), blockedValue: t('settings.status.blockedInline'), statusUnavailable: t('settings.status.unavailableInline'), statusLoading: t('settings.status.loadingInline'), statusNotPaired: t('settings.status.notPaired'), reasonLine: t('settings.permission.reasonLine'), nextLine: t('settings.permission.nextLine'), effectiveScopeLine: t('settings.permission.effectiveScopeLine'), fullHostWarningTitle: t('settings.permission.fullHostWarningTitle'), fullHostWarningBody: t('settings.permission.fullHostWarningBody'), fullHostAckLabel: t('settings.permission.fullHostAckLabel'), fullHostSaveFirst: t('settings.permission.fullHostSaveFirst'), confirming: t('settings.permission.confirming'), fullHostConfirmed: t('settings.permission.fullHostConfirmed'), confirmFullHost: t('settings.permission.confirmFullHost'), grantTitle: t('settings.permission.grantTitle'), grantMeta: t('settings.permission.grantMeta'), revoking: t('settings.permission.revoking'), revoke: t('settings.permission.revoke'), blockedSafely: t('settings.permission.blockedSafely'), degradedSafely: t('settings.permission.degradedSafely'), sessionInactive: t('settings.permission.sessionInactive'), nextStepFallback: t('settings.permission.nextStepFallback'), saving: t('settings.saving'), save: t('settings.permission.save'), saveNote: t('settings.changesApplyNewRuns'), notSet: t('settings.status.notSet') }}
                    />
                  </SettingsSection>
                  <SettingsSection id="approval-review-settings" eyebrow={t('settings.review.eyebrow')} title={t('settings.review.title')} description={t('settings.review.description')} status={approvalReviewSettingsUnavailable ? 'unavailable' : approvalReviewSettings?.status === 'blocked' ? 'degraded' : approvalReviewSettings?.status === 'degraded' ? 'degraded' : approvalReviewSettings?.status === 'ready' ? 'ready' : approvalReviewSettings ? 'idle' : 'loading'} statusLabel={approvalReviewSettingsUnavailable ? t('settings.status.unavailable') : approvalReviewSettings?.status ?? t('settings.status.loading')}>
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
                      copy={{ eyebrow: t('settings.review.eyebrow'), ariaLabel: t('settings.review.ariaLabel'), unavailableNote: t('settings.review.unavailableNote'), unpairedNote: t('settings.review.unpairedNote'), enableLabel: t('settings.review.enableLabel'), note: t('settings.review.note'), reviewerSourceLabel: t('settings.review.reviewerSourceLabel'), sourceSameAsRun: t('settings.review.sourceSameAsRun'), sourceDedicated: t('settings.review.sourceDedicated'), dedicatedProfileLabel: t('settings.review.dedicatedProfileLabel'), dedicatedHelp: t('settings.review.dedicatedHelp'), postureAriaLabel: t('settings.review.postureAriaLabel'), postureOffLabel: t('settings.review.postureOffLabel'), postureOffDescription: t('settings.review.postureOffDescription'), postureAdvisoryLabel: t('settings.review.postureAdvisoryLabel'), postureAdvisoryDescription: t('settings.review.postureAdvisoryDescription'), postureBoundedAutoLabel: t('settings.review.postureBoundedAutoLabel'), postureBoundedAutoDescription: t('settings.review.postureBoundedAutoDescription'), statusLabel: t('settings.grid.status'), revisionLabel: t('settings.grid.revision'), policyLabel: t('settings.grid.policy'), lastLatencyLabel: t('settings.grid.lastLatency'), statusUnavailable: t('settings.status.unavailable'), statusNotConfigured: t('settings.status.notConfigured'), notMeasured: t('settings.status.notMeasured'), lastErrorPrefix: t('settings.review.lastErrorPrefix'), limitsAriaLabel: t('settings.review.limitsAriaLabel'), maxLatencyLabel: t('settings.review.maxLatencyLabel'), maxRequestBytesLabel: t('settings.review.maxRequestBytesLabel'), maxResponseBytesLabel: t('settings.review.maxResponseBytesLabel'), cacheTtlLabel: t('settings.review.cacheTtlLabel'), scopeNote: t('settings.review.scopeNote'), saving: t('settings.saving'), save: t('settings.review.save'), probeHealth: t('settings.review.probeHealth'), saveNote: t('settings.changesApplyNewRuns') }}
                    />
                  </SettingsSection>
                  <SettingsSection id="capability-profile-settings" eyebrow={t('settings.capability.eyebrow')} title={t('settings.capability.title')} description={t('settings.capability.description')} status={capabilityProfileSettingsUnavailable ? 'unavailable' : capabilityProfileSettings?.resolution.status === 'blocked' ? 'degraded' : capabilityProfileSettings?.resolution.status === 'degraded' ? 'degraded' : capabilityProfileSettings ? 'ready' : 'loading'} statusLabel={capabilityProfileSettingsUnavailable ? t('settings.status.unavailable') : capabilityProfileSettings?.resolution.status ?? t('settings.status.loading')}>
                    {capabilityProfileSettingsUnavailable ? <p className="muted">{t('settings.capability.unavailableNote')}</p> : capabilityProfileSettings ? <>
                      <div className="capability-profile-cards" role="radiogroup" aria-label={t('settings.capability.profilesAriaLabel')}>
                        {([
                          ['preview', t('settings.capability.previewLabel'), t('settings.capability.previewDescription')],
                          ['workspace-coding', t('settings.capability.workspaceCodingLabel'), t('settings.capability.workspaceCodingDescription')],
                          ['advanced-local', t('settings.capability.advancedLocalLabel'), t('settings.capability.advancedLocalDescription')],
                          ['custom', t('settings.capability.customLabel'), t('settings.capability.customDescription')],
                        ] as const).map(([id, label, description]) => <button key={id} type="button" className="capability-profile-card" data-selected={capabilityProfileId === id ? 'true' : 'false'} role="radio" aria-checked={capabilityProfileId === id} disabled={capabilityBusy} onClick={() => setCapabilityProfileId(id)}><strong>{label}</strong><span>{description}</span></button>)}
                      </div>
                      {capabilityProfileId === 'advanced-local' && <label className="toggle-row"><input type="checkbox" checked={capabilityAcknowledged} disabled={capabilityBusy} onChange={(event) => setCapabilityAcknowledged(event.target.checked)} /><span>{t('settings.capability.ackLabel')}</span></label>}
                      <p className="muted">{t('settings.capability.resolutionLine', { requested: capabilityProfileSettings.resolution.requestedProfile.profileId, effective: capabilityProfileSettings.resolution.effectiveProfile?.profileId ?? t('settings.status.blockedInline'), reason: capabilityProfileSettings.resolution.reasonCode, revision: capabilityProfileSettings.currentRevision })}</p>
                      {capabilityProfileSettings.resolution.effectiveProfile && <p className="muted">{t('settings.capability.effectiveModesLine', { model: capabilityProfileSettings.resolution.effectiveProfile.modelMode, filesystem: capabilityProfileSettings.resolution.effectiveProfile.filesystemMode, shell: capabilityProfileSettings.resolution.effectiveProfile.shellMode, network: capabilityProfileSettings.resolution.effectiveProfile.networkMode, mcpSkill: capabilityProfileSettings.resolution.effectiveProfile.mcpSkillMode })}</p>}
                      <div className="inline-actions"><button type="button" disabled={capabilityBusy || !onPatchCapabilityProfileSettings || (capabilityProfileId === 'advanced-local' && !capabilityAcknowledged)} onClick={() => { void saveCapabilityProfile(); }}>{t('settings.capability.save')}</button><button className="reset-button" type="button" disabled={capabilityBusy || !onResetCapabilityProfileSettings} onClick={() => { void resetCapabilityProfile(); }}>{t('settings.capability.reset')}</button></div>
                    </> : <p className="muted">{t('settings.capability.unpairedNote')}</p>}
                  </SettingsSection>
                  <SettingsSection id="workspace-settings" eyebrow={t('settings.workspaces')} title={t('settings.workspace.title')} description={t('settings.workspace.description')} status={workspacesUnavailable ? 'unavailable' : workspaces ? 'ready' : 'loading'} statusLabel={workspacesUnavailable ? t('settings.status.unavailable') : workspaces ? t('settings.status.ready') : t('settings.status.loading')}>
                    <div className="workspace-setup" aria-label={t('settings.workspaceSetup')}>
                      <div className="eyebrow">{t('settings.workspaces')}</div>
                      {workspacesUnavailable ? <p className="muted">{t('settings.workspace.unavailableNote')}</p> : workspaces ? <>
                        <label>{t('settings.workspace')}<select value={profile.workspaceId} disabled={workspaceBusy} onChange={(event) => updateProfile({ workspaceId: event.target.value })}>{workspaces.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.label} · {workspace.id}{workspace.isDefault ? t('settings.workspace.defaultSuffix') : ''}</option>)}</select></label>
                        <p className="muted">{t('settings.workspace.pathNote')}</p>
                        {onAddWorkspace && <form onSubmit={(event) => { void addWorkspace(event); }}>
                          <label>{t('settings.workspace.idLabel')}<input value={workspaceIdInput} disabled={workspaceBusy} onChange={(event) => setWorkspaceIdInput(event.target.value)} placeholder="project-a" autoComplete="off" /></label>
                          <label>{t('settings.workspace.friendlyLabel')}<input value={workspaceLabelInput} disabled={workspaceBusy} onChange={(event) => setWorkspaceLabelInput(event.target.value)} placeholder="Project A" autoComplete="off" /></label>
                          <label>{t('settings.workspace.pathLabel')}<input value={workspacePathInput} disabled={workspaceBusy} onChange={(event) => setWorkspacePathInput(event.target.value)} placeholder="C:\\work\\project-a" autoComplete="off" /></label>
                          <label className="toggle-row"><input type="checkbox" checked={workspaceConfirmed} disabled={workspaceBusy} onChange={(event) => setWorkspaceConfirmed(event.target.checked)} /><span>{t('settings.workspace.confirmLabel')}</span></label>
                          <button type="submit" disabled={workspaceBusy || !workspaceIdInput.trim() || !workspacePathInput.trim() || !workspaceConfirmed}>{t('settings.workspace.add')}</button>
                        </form>}
                        {workspaces.workspaces.filter((workspace) => workspace.canRemove).map((workspace) => <div className="workspace-row" key={workspace.id}><span>{workspace.label} · {workspace.id}</span><button className="cancel-button" type="button" disabled={workspaceBusy} onClick={() => { void removeWorkspace(workspace.id); }}>{t('settings.workspace.remove')}</button></div>)}
                      </> : <p className="muted">{t('settings.workspace.unpairedNote')}</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="model-settings" eyebrow={t('settings.modelAccess')} title={t('settings.model.title')} description={t('settings.model.description')} status={modelSettingsUnavailable && deepSeekSettingsUnavailable ? 'unavailable' : modelSettings?.credentialState === 'required' || deepSeekSettings?.credentialState === 'required' ? 'degraded' : modelSettings?.configured || deepSeekSettings?.configured ? 'ready' : 'idle'} statusLabel={modelSettingsUnavailable && deepSeekSettingsUnavailable ? t('settings.status.unavailable') : modelSettings?.credentialState === 'required' || deepSeekSettings?.credentialState === 'required' ? t('settings.status.credentialRequired') : modelSettings?.configured || deepSeekSettings?.configured ? t('settings.status.ready') : t('settings.status.notConfigured')}>
                    <div className="context-tabs provider-preset" role="radiogroup" aria-label={t('settings.model.presetAriaLabel')}>
                      <button type="button" role="radio" aria-checked={providerPreset === 'deepseek'} aria-selected={providerPreset === 'deepseek'} className="context-tab" onClick={() => setProviderPreset('deepseek')}>{t('settings.model.presetDeepSeek')}</button>
                      <button type="button" role="radio" aria-checked={providerPreset === 'openai-compatible'} aria-selected={providerPreset === 'openai-compatible'} className="context-tab" onClick={() => setProviderPreset('openai-compatible')}>{t('settings.model.presetOpenAi')}</button>
                    </div>
                    {providerPreset === 'deepseek' ? (deepSeekSettingsUnavailable ? <p className="muted">{t('settings.model.deepseekUnavailableNote')}</p> : <form className="model-setup" onSubmit={(event) => { void submitDeepSeekSettings(event); }}>
                      <p className="muted">{t('settings.model.deepseekKeyNote')}</p>
                      <label>{t('settings.model.endpointProfile')}<select value={deepSeekEndpointProfile} disabled={deepSeekBusy} onChange={(event) => { const profileValue = event.target.value as DeepSeekSettingsInput['endpointProfile']; setDeepSeekEndpointProfile(profileValue); setDeepSeekEndpoint(profileValue === 'openai-responses' ? 'https://api.deepseek.com/v1/responses' : profileValue === 'anthropic-messages' ? 'https://api.deepseek.com/anthropic/v1/messages' : 'https://api.deepseek.com/v1/chat/completions'); }}><option value="openai-chat-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
                      <label>{t('settings.model.completeEndpoint')}<input type="url" value={deepSeekEndpoint} disabled={deepSeekBusy} onChange={(event) => setDeepSeekEndpoint(event.target.value)} placeholder="https://api.deepseek.com/v1/chat/completions" autoComplete="url" /></label>
                      <label>{t('settings.model.modelLabel')}<input value={deepSeekModel} disabled={deepSeekBusy} onChange={(event) => setDeepSeekModel(event.target.value)} placeholder="deepseek-v4-flash" autoComplete="off" /></label>
                      <label>{t('settings.model.apiKeyWriteOnly')}<input type="password" value={deepSeekApiKey} disabled={deepSeekBusy} onChange={(event) => setDeepSeekApiKey(event.target.value)} placeholder={t('settings.model.apiKeyPlaceholder')} autoComplete="new-password" /></label>
                      <div className="settings-run-fields"><label>{t('settings.model.thinking')}<select value={deepSeekThinking} disabled={deepSeekBusy} onChange={(event) => setDeepSeekThinking(event.target.value as DeepSeekSettingsInput['thinkingMode'])}><option value="off">{t('settings.option.off')}</option><option value="auto">{t('settings.model.thinkingAuto')}</option><option value="high">{t('settings.model.thinkingHigh')}</option><option value="max">{t('settings.model.thinkingMax')}</option></select></label><label>{t('settings.model.toolCalling')}<select value={deepSeekToolCalling} disabled={deepSeekBusy} onChange={(event) => setDeepSeekToolCalling(event.target.value as DeepSeekSettingsInput['toolCalling'])}><option value="enabled">{t('settings.option.enabled')}</option><option value="disabled">{t('settings.option.disabled')}</option></select></label><label>{t('settings.model.webSearch')}<select value={deepSeekSearch} disabled={deepSeekBusy || deepSeekEndpointProfile !== 'openai-responses'} onChange={(event) => setDeepSeekSearch(event.target.value as DeepSeekSettingsInput['webSearch'])}><option value="off">{t('settings.option.off')}</option><option value="provider-owned">{t('settings.model.webSearchProviderOwned')}</option></select></label><label>{t('settings.model.reviewer')}<select value={deepSeekReviewer} disabled={deepSeekBusy} onChange={(event) => setDeepSeekReviewer(event.target.value as DeepSeekSettingsInput['reviewer'])}><option value="off">{t('settings.option.off')}</option><option value="advisory">{t('settings.model.reviewerAdvisory')}</option></select></label></div>
                      <div className="inline-actions"><button type="submit" disabled={deepSeekBusy || !deepSeekApiKey.trim()}>{t('settings.model.saveDeepSeek')}</button><button type="button" disabled={deepSeekBusy || !onProbeDeepSeek || !deepSeekSettings?.configured} onClick={() => { void probeDeepSeekSettings(); }}>{t('settings.probe')}</button>{deepSeekSettings?.configured && <button className="cancel-button" type="button" disabled={deepSeekBusy} onClick={() => { void (async () => { await onClearDeepSeekSettings?.(); setDeepSeekApiKey(''); })(); }}>{t('settings.model.clear')}</button>}</div>
                      {(deepSeekProbe || deepSeekSettings?.lastProbe) && <p className="muted">{t('settings.model.probeLine', { status: (deepSeekProbe ?? deepSeekSettings?.lastProbe)?.status ?? '', detail: (deepSeekProbe ?? deepSeekSettings?.lastProbe)?.errorCode ?? t('settings.model.probeLatency', { ms: (deepSeekProbe ?? deepSeekSettings?.lastProbe)?.latencyMs ?? 'n/a' }) })}</p>}
                      {deepSeekSettings?.capability && <p className="muted">{t('settings.model.capabilityLine', { status: deepSeekSettings.capability.status, streaming: String(deepSeekSettings.capability.streaming), tools: String(deepSeekSettings.capability.toolCalls), reasoning: String(deepSeekSettings.capability.reasoning), revision: deepSeekSettings.capability.descriptorRevision })}</p>}
                    </form>) : (<>
                    <div className="settings-run-fields">
                      <label>{t('settings.modelProvider')}<input value={profile.model.provider} onChange={(event) => updateProfile({ model: { ...profile.model, provider: event.target.value } })} /></label>
                      <label>{t('settings.modelName')}<input value={profile.model.name} onChange={(event) => updateProfile({ model: { ...profile.model, name: event.target.value } })} /></label>
                    </div>
                    <div className="model-setup" aria-label={t('settings.model.setupAriaLabel')}>
                      {modelSettingsUnavailable ? <p className="muted">{t('settings.model.unavailableNote')}</p> : <>
                        <p className="muted">{modelSettings?.configured ? t('settings.model.configuredNote', { source: modelSettings.source }) : modelSettings?.credentialState === 'required' ? t('settings.model.credentialRequiredNote') : t('settings.model.setupNote')}</p>
                        {modelSettings?.baseUrl && <p className="muted">{modelSettings.providerId} · {modelSettings.baseUrl}{modelSettings.modelName ? ` · ${modelSettings.modelName}` : ''}</p>}
                        <form onSubmit={(event) => { void submitModelSettings(event); }}>
                          <label>{t('settings.providerUrl')}<input type="url" value={modelBaseUrl} onChange={(event) => setModelBaseUrl(event.target.value)} placeholder="https://api.deepseek.com" autoComplete="url" /></label>
                          <label>{t('settings.apiKey')}<input type="password" value={modelApiKey} onChange={(event) => setModelApiKey(event.target.value)} placeholder={modelSettings?.configured ? t('settings.model.replaceKeyPlaceholder') : t('settings.model.pasteKeyPlaceholder')} autoComplete="new-password" /></label>
                          <div className="inline-actions"><button type="submit" disabled={!modelApiKey}>{t('settings.saveProvider')}</button>{modelSettings?.configured && <button className="cancel-button" type="button" onClick={() => { void (async () => { await onClearModelSettings?.(); setModelApiKey(''); })(); }}>{t('settings.clearDaemonKey')}</button>}</div>
                        </form>
                        <form onSubmit={(event) => { void submitModelProbe(event); }}>
                          <label>{t('settings.modelListEndpoint')}<input type="url" value={modelProbeEndpoint} onChange={(event) => setModelProbeEndpoint(event.target.value)} placeholder="https://api.deepseek.com/models" autoComplete="url" /></label>
                          <div className="inline-actions"><button type="submit" disabled={!onProbeModel || modelProbeBusy || !modelProbeEndpoint.trim()}>{t('settings.probeModels')}</button>{modelProbe && <span className="muted">{modelProbe.status}{modelProbe.errorCode ? ` · ${modelProbe.errorCode}` : modelProbe.capabilities ? ` · ${modelProbe.capabilities.modelId}` : ''}</span>}</div>
                        </form>
                      </>}
                    </div>
                    </>)}
                  </SettingsSection>
                  <SettingsSection id="run-defaults" eyebrow={t('settings.defaults.eyebrow')} title={t('settings.defaults.title')} description={t('settings.defaults.description')} status="idle" statusLabel={t('settings.status.localDraft')}>
                    <div className="settings-run-fields">
                      <label>{t('settings.taskTrust')}<select value={profile.taskTrust} onChange={(event) => updateProfile({ taskTrust: event.target.value as RunProfile['taskTrust'] })}><option value="trusted-workspace">{t('settings.defaults.trustedWorkspace')}</option><option value="untrusted-content">{t('settings.defaults.untrustedContent')}</option></select></label>
                      <label>{t('settings.sandbox')}<select value={profile.sandbox.mode} onChange={(event) => updateSandboxMode(event.target.value as RunProfile['sandbox']['mode'])}><option value="read-only">{t('settings.defaults.readOnly')}</option><option value="workspace-write">{t('settings.defaults.workspaceWrite')}</option><option value="external-sandbox">{t('settings.defaults.externalSandbox')}</option></select></label>
                      <label>{t('settings.network')}<select value={'network' in profile.sandbox ? profile.sandbox.network : 'restricted'} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, network: event.target.value as 'restricted' | 'enabled' } as RunProfile['sandbox'] })}><option value="restricted">{t('settings.option.restricted')}</option><option value="enabled">{t('settings.option.enabled')}</option></select></label>
                      {profile.sandbox.mode === 'workspace-write' && <label>{t('settings.defaults.writableRoots')}<input value={profile.sandbox.writableRoots?.join(', ') ?? ''} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, writableRoots: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } })} /></label>}
                      {profile.sandbox.mode === 'external-sandbox' && <><label>{t('settings.defaults.runtime')}<select value={profile.sandbox.provider} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, provider: event.target.value as 'docker' | 'podman' | 'vm' } })}><option value="docker">Docker</option><option value="podman">Podman</option><option value="vm">VM</option></select></label><label>{t('settings.defaults.sandboxWritableRoots')}<input value={profile.sandbox.writableRoots?.join(', ') ?? ''} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, writableRoots: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } })} placeholder="src, tests" /></label></>}
                      <label>{t('settings.approval')}<select value={typeof profile.approval === 'string' ? profile.approval : 'on-request'} onChange={(event) => updateProfile({ approval: event.target.value as RunProfile['approval'] })}><option value="on-request">{t('settings.defaults.onRequest')}</option><option value="untrusted">{t('settings.defaults.untrusted')}</option><option value="never">{t('settings.defaults.never')}</option></select></label>
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
                  <SettingsSection id="memory-settings" eyebrow={t('settings.memory.eyebrow')} title={t('settings.memory.title')} description={t('settings.memory.description')} status={agentMemorySettingsUnavailable ? 'unavailable' : agentMemorySettings ? (agentMemorySettings.status.degraded ? 'degraded' : agentMemorySettings.status.available ? 'ready' : 'idle') : 'loading'} statusLabel={agentMemorySettingsUnavailable ? t('settings.status.unavailable') : agentMemorySettings?.status.degraded ? t('settings.status.degraded') : agentMemorySettings?.status.available ? t('settings.status.ready') : agentMemorySettings ? t('settings.status.disabled') : t('settings.status.loading')}>
                    <div className="tool-setup memory-setup" aria-label={t('settings.memory.ariaLabel')}>
                      <div className="eyebrow">{t('settings.memory.eyebrow')}</div>
                      {agentMemorySettingsUnavailable ? <p className="muted">{t('settings.memory.unavailableNote')}</p> : agentMemorySettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={memoryEnabled} disabled={memoryBusy} onChange={(event) => setMemoryEnabled(event.target.checked)} /><span>{t('settings.memory.enableLabel')}</span></label>
                        <p className="muted">{t('settings.memory.note')}</p>
                        <div className="inline-actions"><label>{t('settings.memory.modeLabel')}<select value={memoryMode} disabled={memoryBusy} onChange={(event) => setMemoryMode(event.target.value as AgentMemorySettingsMode)}><option value="memory-core">MemoryCore</option><option value="proxy">{t('settings.memory.modeProxy')}</option><option value="full-stack">{t('settings.memory.modeFullStack')}</option><option value="off">{t('settings.option.off')}</option></select></label><label>{t('settings.memory.intervalLabel')}<input type="number" min={5} max={1440} value={memoryIntervalMinutes} disabled={memoryBusy} onChange={(event) => setMemoryIntervalMinutes(Math.max(5, Math.min(1440, Number(event.target.value) || 60)))} /></label></div>
                        <div className="inline-actions"><label>{t('settings.memory.teamId')}<input value={memoryTeamId} disabled={memoryBusy} onChange={(event) => setMemoryTeamId(event.target.value)} /></label><label>{t('settings.memory.agentId')}<input value={memoryAgentId} disabled={memoryBusy} onChange={(event) => setMemoryAgentId(event.target.value)} /></label><label>{t('settings.memory.userId')}<input value={memoryUserId} disabled={memoryBusy} onChange={(event) => setMemoryUserId(event.target.value)} /></label></div>
                        <label>{t('settings.memory.upstreamRepo')}<input value={memoryUpstreamRepo} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRepo(event.target.value)} /></label>
                        <label>{t('settings.memory.upstreamRef')}<input value={memoryUpstreamRef} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRef(event.target.value)} /></label>
                        <label className="toggle-row"><input type="checkbox" checked={memoryUpstreamRefLocked} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRefLocked(event.target.checked)} /><span>{t('settings.memory.lockRef')}</span></label>
                        <label className="toggle-row"><input type="checkbox" checked={memoryAutoUpdate} disabled={memoryBusy} onChange={(event) => setMemoryAutoUpdate(event.target.checked)} /><span>{t('settings.memory.autoUpdate')}</span></label>
                        <label className="toggle-row"><input type="checkbox" checked={memoryFallback} disabled={memoryBusy} onChange={(event) => setMemoryFallback(event.target.checked)} /><span>{t('settings.memory.fallback')}</span></label>
                        <p className="muted">{t('settings.memory.statusLine', { state: agentMemorySettings.status.updateState, availability: agentMemorySettings.status.available ? t('settings.status.readyInline') : agentMemorySettings.status.degraded ? t('settings.status.degradedInline') : t('settings.status.disabledInline'), current: agentMemorySettings.currentRevision ?? t('settings.status.none'), previous: agentMemorySettings.previousRevision ?? t('settings.status.none') })}</p>
                        {agentMemoryOperations && <p className="muted">{t('settings.memory.healthLine', { latency: agentMemoryOperations.healthLatencyMs === null ? 'n/a' : `${agentMemoryOperations.healthLatencyMs} ms`, hits: agentMemoryOperations.recall.hits, misses: agentMemoryOperations.recall.misses, pending: agentMemoryOperations.writeQueue.pending, failed: agentMemoryOperations.writeQueue.failed })}</p>}
                        {agentMemoryOperations && agentMemoryOperations.updates.length > 0 && <p className="muted">{t('settings.memory.recentLine', { items: agentMemoryOperations.updates.slice(-3).map((update) => `${update.operation} ${update.outcome}`).join(' · ') })}</p>}
                        <div className="inline-actions"><button type="button" disabled={memoryBusy} onClick={() => { void saveAgentMemorySettings(); }}>{t('settings.memory.save')}</button><button type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onProbeAgentMemory); }}>{t('settings.probe')}</button><button type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onUpdateAgentMemory); }}>{t('settings.memory.update')}</button><button className="cancel-button" type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onRollbackAgentMemory); }}>{t('settings.memory.rollback')}</button></div>
                      </> : <p className="muted">{t('settings.memory.unpairedNote')}</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="knowledge-settings" eyebrow={t('settings.knowledge.eyebrow')} title={t('settings.knowledge.title')} description={t('settings.knowledge.description')} status={agentMemoryKnowledgeSettingsUnavailable ? 'unavailable' : agentMemoryKnowledgeSettings ? (agentMemoryKnowledgeSettings.degraded ? 'degraded' : agentMemoryKnowledgeSettings.available ? 'ready' : 'idle') : 'loading'} statusLabel={agentMemoryKnowledgeSettingsUnavailable ? t('settings.status.unavailable') : agentMemoryKnowledgeSettings?.degraded ? t('settings.status.degraded') : agentMemoryKnowledgeSettings?.available ? t('settings.status.ready') : agentMemoryKnowledgeSettings ? t('settings.status.notProbed') : t('settings.status.loading')}>
                    <div className="tool-setup knowledge-setup" aria-label={t('settings.knowledge.ariaLabel')}>
                      <div className="eyebrow">{t('settings.knowledge.eyebrow')}</div>
                      {agentMemoryKnowledgeSettingsUnavailable ? <p className="muted">{t('settings.knowledge.unavailableNote')}</p> : agentMemoryKnowledgeSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={knowledgeEnabled} disabled={knowledgeBusy} onChange={(event) => setKnowledgeEnabled(event.target.checked)} /><span>{t('settings.knowledge.enableLabel')}</span></label>
                        <p className="muted">{t('settings.knowledge.note')}</p>
                        <label>{t('settings.knowledge.resourceIdLabel')}<input value={knowledgeId} disabled={knowledgeBusy} onChange={(event) => setKnowledgeId(event.target.value)} placeholder="wiki_demo" autoComplete="off" /></label>
                        <label className="toggle-row"><input type="checkbox" checked={knowledgeAutoRetrieve} disabled={knowledgeBusy || !knowledgeEnabled} onChange={(event) => setKnowledgeAutoRetrieve(event.target.checked)} /><span>{t('settings.knowledge.autoRetrieveLabel')}</span></label>
                        <div className="inline-actions"><label>{t('settings.knowledge.maxItems')}<input type="number" min={1} max={64} value={knowledgeMaxItems} disabled={knowledgeBusy} onChange={(event) => setKnowledgeMaxItems(clampKnowledgeLimit(event.target.value, 1, 64, 8))} /></label><label>{t('settings.knowledge.maxBytes')}<input type="number" min={256} max={131072} value={knowledgeMaxBytes} disabled={knowledgeBusy} onChange={(event) => setKnowledgeMaxBytes(clampKnowledgeLimit(event.target.value, 256, 131072, 8192))} /></label><label>{t('settings.knowledge.timeout')}<input type="number" min={50} max={10000} value={knowledgeTimeoutMs} disabled={knowledgeBusy} onChange={(event) => setKnowledgeTimeoutMs(clampKnowledgeLimit(event.target.value, 50, 10000, 750))} /></label></div>
                        <p className="muted">{t('settings.knowledge.statusLine', { state: agentMemoryKnowledgeSettings.available ? t('settings.status.readyInline') : agentMemoryKnowledgeSettings.degraded ? `${t('settings.status.degradedInline')}${agentMemoryKnowledgeSettings.lastErrorCode ? ` · ${agentMemoryKnowledgeSettings.lastErrorCode}` : ''}` : t('settings.status.notProbedInline'), resource: agentMemoryKnowledgeSettings.resourceName ?? t('settings.status.resourceNotProbed'), revision: agentMemoryKnowledgeSettings.sourceRevision ?? t('settings.status.none') })}</p>
                        {agentMemoryKnowledgeSettings.tools.length > 0 && <p className="muted">{t('settings.knowledge.toolsLine', { tools: agentMemoryKnowledgeSettings.tools.map((tool) => tool.name).join(', ') })}</p>}
                        <div className="inline-actions"><button type="button" disabled={knowledgeBusy} onClick={() => { void saveAgentMemoryKnowledgeSettings(); }}>{t('settings.knowledge.save')}</button><button type="button" disabled={knowledgeBusy || !knowledgeEnabled} onClick={() => { void probeAgentMemoryKnowledge(); }}>{t('settings.knowledge.probe')}</button></div>
                      </> : <p className="muted">{t('settings.knowledge.unpairedNote')}</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="mcp-settings" eyebrow={t('settings.mcp.eyebrow')} title={t('settings.mcp.title')} description={t('settings.mcp.description')} status={mcpSettingsUnavailable ? 'unavailable' : mcpSettings ? 'idle' : 'loading'} statusLabel={mcpSettingsUnavailable ? t('settings.status.unavailable') : mcpSettings ? mcpSettings.status : t('settings.status.loading')}>
                    <div className="tool-setup mcp-setup" aria-label={t('settings.mcp.ariaLabel')}>
                      <div className="eyebrow">{t('settings.mcp.eyebrow')}</div>
                      {mcpSettingsUnavailable ? <p className="muted">{t('settings.mcp.unavailableNote')}</p> : mcpSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={mcpEnabled} disabled={mcpBusy} onChange={(event) => setMcpEnabled(event.target.checked)} /><span>{t('settings.mcp.enableLabel')}</span></label>
                        <p className="muted">{t('settings.mcp.note')}</p>
                        <div className="inline-actions"><label>{t('settings.mcp.serverId')}<input value={mcpServerId} disabled={mcpBusy} onChange={(event) => setMcpServerId(event.target.value)} /></label><label>{t('settings.mcp.serverVersion')}<input value={mcpServerVersion} disabled={mcpBusy} onChange={(event) => setMcpServerVersion(event.target.value)} /></label><label>{t('settings.mcp.transport')}<select value={mcpTransport} disabled={mcpBusy} onChange={(event) => setMcpTransport(event.target.value as 'stdio' | 'streamable-http')}><option value="stdio">stdio</option><option value="streamable-http">Streamable HTTP</option></select></label></div>
                        <label>{t('settings.mcp.endpointLabel')}<input value={mcpEndpointLabel} disabled={mcpBusy} onChange={(event) => setMcpEndpointLabel(event.target.value)} placeholder="Local MCP server" /></label>
                        <label>{t('settings.mcp.manifestRevision')}<input value={mcpManifestRevision} disabled={mcpBusy} onChange={(event) => setMcpManifestRevision(event.target.value)} /></label>
                        <label>{t('settings.mcp.capabilityRefs')}<input value={mcpCapabilityAllowlist} disabled={mcpBusy} onChange={(event) => setMcpCapabilityAllowlist(event.target.value)} placeholder="server/tool/name@1.0.0, …" /></label>
                        <p className="muted">{t('settings.mcp.statusLine', { status: mcpSettings.status, health: mcpSettings.health ?? t('settings.status.notProbedInline'), revision: mcpSettings.currentRevision ?? t('settings.status.none'), count: mcpSettings.capabilityCount, next: mcpSettings.nextAction })}{mcpSettings.lastErrorCode ? ` · ${mcpSettings.lastErrorCode}` : ''}</p>
                        <div className="inline-actions"><button type="button" disabled={mcpBusy} onClick={() => { void saveMcpSettings(); }}>{t('settings.mcp.save')}</button><button type="button" disabled={mcpBusy || !mcpEnabled} onClick={() => { void probeMcp(); }}>{t('settings.mcp.probe')}</button></div>
                      </> : <p className="muted">{t('settings.mcp.unpairedNote')}</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="filesystem-settings" eyebrow={t('settings.fs.eyebrow')} title={t('settings.fs.title')} description={t('settings.fs.description')} status={toolSettingsUnavailable ? 'unavailable' : toolSettings ? 'ready' : 'loading'} statusLabel={toolSettingsUnavailable ? t('settings.status.unavailable') : toolSettings ? t('settings.status.ready') : t('settings.status.loading')}>
                    <div className="tool-setup" aria-label={t('settings.fs.ariaLabel')}>
                      <div className="eyebrow">{t('settings.fs.eyebrow')}</div>
                      {toolSettingsUnavailable ? <p className="muted">{t('settings.fs.unavailableNote')}</p> : toolSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={toolSettings.filesystemEnabled} disabled={toolToggleBusy} onChange={(event) => { void toggleFilesystemTools(event.target.checked); }} /><span>{t('settings.fs.enableLabel')}</span></label>
                        <p className="muted">{t('settings.fs.note', { workspace: toolSettings.workspaceLabel })}</p>
                        {toolSettings.availableTools.length > 0 && <p className="muted">{t('settings.toolsAvailable', { tools: toolSettings.availableTools.join(', ') })}</p>}
                      </> : <p className="muted">{t('settings.fs.unpairedNote')}</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="git-settings" eyebrow={t('settings.git.eyebrow')} title={t('settings.git.title')} description={t('settings.git.description')} status={gitSettingsUnavailable ? 'unavailable' : gitSettings ? 'ready' : 'loading'} statusLabel={gitSettingsUnavailable ? t('settings.status.unavailable') : gitSettings ? t('settings.status.ready') : t('settings.status.loading')}>
                    <div className="tool-setup" aria-label={t('settings.git.ariaLabel')}>
                      <div className="eyebrow">{t('settings.git.eyebrow')}</div>
                      {gitSettingsUnavailable ? <p className="muted">{t('settings.git.unavailableNote')}</p> : gitSettings ? <>
                        <label className="toggle-row"><input type="checkbox" checked={gitSettings.enabled} disabled={gitToggleBusy} onChange={(event) => { void toggleGitTools(event.target.checked); }} /><span>{t('settings.git.enableLabel')}</span></label>
                        <p className="muted">{t('settings.git.note', { workspace: gitSettings.workspaceLabel })}</p>
                        {gitSettings.availableTools.length > 0 && <p className="muted">{t('settings.toolsAvailable', { tools: gitSettings.availableTools.join(', ') })}</p>}
                      </> : <p className="muted">{t('settings.git.unpairedNote')}</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="sandbox-settings" eyebrow={t('settings.sandbox.eyebrow')} title={t('settings.sandbox.title')} description={t('settings.sandbox.description')} status={sandboxSettingsUnavailable ? 'unavailable' : sandboxSettings ? (sandboxSettings.healthy ? 'ready' : sandboxSettings.detected ? 'degraded' : 'idle') : 'loading'} statusLabel={sandboxSettingsUnavailable ? t('settings.status.unavailable') : sandboxSettings?.healthy ? t('settings.status.ready') : sandboxSettings?.detected ? t('settings.status.degraded') : sandboxSettings ? t('settings.status.notProbed') : t('settings.status.loading')}>
                    <div className="tool-setup" aria-label={t('settings.sandbox.ariaLabel')}>
                      <div className="eyebrow">{t('settings.sandbox.eyebrow')}</div>
                      {sandboxSettingsUnavailable ? <p className="muted">{t('settings.sandbox.unavailableNote')}</p> : sandboxSettings ? <>
                        <p className="muted">{t('settings.sandbox.note')}</p>
                        <div className="inline-actions"><label>{t('settings.sandbox.providerLabel')}<select value={sandboxProvider} disabled={sandboxBusy} onChange={(event) => setSandboxProvider(event.target.value as 'docker' | 'podman')}><option value="docker">Docker</option><option value="podman">Podman</option></select></label><label>{t('settings.network')}<select value={sandboxNetwork} disabled={sandboxBusy} onChange={(event) => setSandboxNetwork(event.target.value as 'restricted' | 'enabled')}><option value="restricted">{t('settings.option.restricted')}</option><option value="enabled">{t('settings.sandbox.networkEnabledWarning')}</option></select></label><button type="button" disabled={sandboxBusy} onClick={() => { void probeSandbox(); }}>{t('settings.sandbox.probeRuntime')}</button></div>
                        <label>{t('settings.sandbox.imageDigest')}<input value={sandboxImageDigest} disabled={sandboxBusy} onChange={(event) => setSandboxImageDigest(event.target.value)} placeholder="registry.example/agent@sha256:..." /></label>
                        <p className="muted">{t('settings.sandbox.statusLine', { state: sandboxSettings.detected ? (sandboxSettings.healthy ? `${t('settings.status.healthyInline')}${sandboxSettings.capabilities?.version ? ` · ${sandboxSettings.capabilities.version}` : ''}` : t('settings.status.detectedUnhealthy')) : t('settings.status.notProbedInline'), network: sandboxNetwork, enabled: sandboxSettings.enabled ? t('settings.status.enabledInline') : t('settings.status.disabledInline') })}</p>
                        <button type="button" disabled={sandboxBusy || !sandboxSettings.healthy || !sandboxImageDigest} onClick={() => { void toggleSandbox(!sandboxSettings.enabled); }}>{sandboxSettings.enabled ? t('settings.sandbox.disableShell') : t('settings.sandbox.enableShell')}</button>
                      </> : <p className="muted">{t('settings.sandbox.unpairedNote')}</p>}
                    </div>
                  </SettingsSection>
                </div>
              </SettingsTabPanel>
              <SettingsTabPanel tabId="access" activeTab={settingsTab}>
                <div className="settings-grid">
                  <SettingsSection id="certificate-settings" eyebrow={t('settings.cert.eyebrow')} title={t('settings.cert.title')} description={t('settings.cert.description')} status={certificateStatus ? 'ready' : health?.transport.tlsRequired || certificateStatusUnavailable ? 'degraded' : 'idle'} statusLabel={certificateStatus ? t('settings.status.ready') : health?.transport.tlsRequired || certificateStatusUnavailable ? t('settings.status.required') : t('settings.status.loopback')}>
                    <div className="certificate-guidance">
                      <div className="eyebrow">{t('settings.cert.eyebrow')}</div>
                      {certificateStatus ? <><strong>{certificateStatus.subject}</strong><p className="muted">{t('settings.cert.validLine', { date: new Date(certificateStatus.validTo).toLocaleDateString(), days: certificateStatus.daysRemaining })}</p><p className="muted">{t('settings.cert.sanLine', { sans: certificateStatus.subjectAltNames.join(', ') || t('settings.status.notReported') })}</p></> : health?.transport.tlsRequired || certificateStatusUnavailable ? <p className="muted">{t('settings.cert.requiredNote')}</p> : <p className="muted">{t('settings.cert.loopbackNote')}</p>}
                    </div>
                  </SettingsSection>
                  <SettingsSection id="deployment-settings" eyebrow={t('settings.deploy.eyebrow')} title={t('settings.deploy.title')} description={t('settings.deploy.description')} status={deploymentReadiness?.status === 'ready' ? 'ready' : deploymentReadiness?.status === 'blocked' ? 'degraded' : deploymentReadinessUnavailable ? 'unavailable' : 'loading'} statusLabel={deploymentReadiness?.status ?? (deploymentReadinessUnavailable ? t('settings.status.unavailable') : t('settings.status.loading'))}>
                    <div className="deployment-readiness" data-status={deploymentReadiness?.status ?? 'unknown'}>
                      <div className="eyebrow">{t('settings.deploy.eyebrow')}</div>
                      {deploymentReadiness ? <><strong>{deploymentReadiness.status} · {deploymentReadiness.mode}</strong><p className="muted">{t('settings.deploy.reasonLine', { reason: deploymentReadiness.reasonCode, next: deploymentReadiness.nextStep })}</p></> : deploymentReadinessUnavailable ? <p className="muted">{t('settings.deploy.unavailableNote')}</p> : <p className="muted">{t('settings.deploy.loadingNote')}</p>}
                    </div>
                  </SettingsSection>
                </div>
              </SettingsTabPanel>
            </SettingsTabs>
          </SettingsSheet>
        </aside>
        <section className="main-column">
          {connected && providerSettingsLoaded && !modelConfigured && !setupOpen && <div className="setup-banner" role="status"><span>{t('setup.bannerText')}</span><Button variant="outline" onClick={() => setSetupForcedOpen(true)}>{t('setup.bannerAction')}</Button></div>}
          {(error || savedVisible) && <ToastViewport>{savedVisible && <Toast variant="success" title={t('settings.saved')} onDismiss={() => setSavedVisible(false)} />}{error && <Toast variant="error" title={error} {...(onDismissError ? { onDismiss: onDismissError } : {})} />}</ToastViewport>}
          {connected ? <ConversationShell run={run} events={events} thread={thread} message={message} profile={profile} composerRef={composerRef} copy={{ title: t('conversation.title'), hint: t('conversation.hint'), newMessage: t('conversation.newMessage'), inputLabel: t('conversation.inputLabel'), inputPlaceholder: t('conversation.inputPlaceholder'), startRun: t('conversation.startRun'), readyTitle: t('conversation.readyTitle'), readyDescription: t('conversation.readyDescription'), untrustedPolicy: t('conversation.untrustedPolicy'), trustedPolicy: t('conversation.trustedPolicy'), conversationEyebrow: t('shell.conversationEyebrow'), conversationStream: t('shell.conversationStream'), conversationTimeline: t('shell.conversationTimeline'), runConsole: t('shell.runConsole'), waitingOutput: t('shell.waitingOutput'), runDetails: t('shell.runDetails'), fileAuditTitle: t('shell.fileAuditTitle'), fileAuditClose: t('shell.fileAuditClose'), fileAuditEmpty: t('shell.fileAuditEmpty'), fileAuditContentLabel: t('shell.fileAuditContentLabel'), cancelRun: t('shell.cancelRun'), timeline: t('shell.timeline'), metricQueue: t('shell.queue'), metricActive: t('shell.active'), metricLease: t('shell.lease'), metricEvents: t('shell.events'), recoveryEyebrow: t('recovery.eyebrow'), recoveryTitle: t('recovery.title'), recoveryDescription: t('recovery.description'), recoveryAction: t('recovery.action'), approvalEyebrow: t('approval.eyebrow'), approvalMeta: t('approval.meta'), approvalSandboxLabel: t('approval.sandboxLabel'), approvalNetworkLabel: t('approval.networkLabel'), approvalImageLabel: t('approval.imageLabel'), approvalAllowOnce: t('approval.allowOnce'), approvalAllowAriaLabel: t('approval.allowAriaLabel'), approvalDeny: t('approval.deny'), approvalSessionNote: t('approval.sessionNote'), reviewReviewedLabel: t('approval.review.reviewed.label'), reviewAskedLabel: t('approval.review.asked.label'), reviewDeniedLabel: t('approval.review.denied.label'), reviewUnavailableLabel: t('approval.review.unavailable.label'), reviewReviewedDescription: t('approval.review.reviewed.description'), reviewAskedDescription: t('approval.review.asked.description'), reviewDeniedDescription: t('approval.review.denied.description'), reviewUnavailableDescription: t('approval.review.unavailable.description'), snapshotEyebrow: t('snapshot.eyebrow'), snapshotTitle: t('snapshot.title'), snapshotAriaLabel: t('snapshot.ariaLabel'), snapshotRequested: t('snapshot.requested'), snapshotEffective: t('snapshot.effective'), snapshotProfileRevision: t('snapshot.profileRevision'), snapshotPolicyRevision: t('snapshot.policyRevision'), snapshotScopeLabel: t('snapshot.scopeLabel'), snapshotBlocked: t('snapshot.blocked'), snapshotGrantExpiry: t('snapshot.grantExpiry'), snapshotActive: t('snapshot.active'), snapshotBlockedChip: t('snapshot.blockedChip'), reviewerEyebrow: t('reviewer.eyebrow'), reviewerOff: t('reviewer.off'), reviewerFrozen: t('reviewer.frozen'), quickApproval: t('composer.approval'), quickSandbox: t('composer.sandbox'), quickModel: t('composer.model'), approvalOnRequest: t('composer.approvalOnRequest'), approvalUntrusted: t('composer.approvalUntrusted'), approvalNever: t('composer.approvalNever'), sandboxReadOnly: t('composer.sandboxReadOnly'), sandboxWorkspaceWrite: t('composer.sandboxWorkspaceWrite'), sandboxExternal: t('composer.sandboxExternal') }} onMessageChange={setMessage} onSubmit={submitRun} onProfileChange={updateProfile} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} {...(capabilityProfileSettings ? { capabilityProfile: capabilityProfileSettings.resolution.effectiveProfile } : {})} /> : <section className="pairing-stage">
            <div className="panel pairing-card">
              <img className="brand-mark pairing-logo" src="/vibego-mark.svg" alt={t('brand.name')} />
              <h1>{accountExists ? t('connection.accountLoginTitle') : t('connection.accountCreateTitle')}</h1>
              <p className="muted">{accountExists ? t('connection.accountLoginDescription') : t('connection.accountCreateDescription')}</p>
              {health ? <form className="pairing-manual" onSubmit={submitAccount}>
                <label htmlFor="account-password">{t('connection.accountPasswordLabel')}</label>
                <input id="account-password" type="password" minLength={4} maxLength={128} required value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} autoComplete={accountExists ? 'current-password' : 'new-password'} />
                {!accountExists && <><label htmlFor="account-password-confirm">{t('connection.accountPasswordConfirmLabel')}</label><input id="account-password-confirm" type="password" minLength={4} maxLength={128} required value={accountPasswordConfirm} onChange={(event) => setAccountPasswordConfirm(event.target.value)} autoComplete="new-password" /></>}
                <p className="muted">{t('connection.accountPasswordHint')}</p>
                {accountFormError && <p className="account-form-error" role="alert">{accountFormError}</p>}
                <button type="submit">{accountExists ? t('connection.accountLoginAction') : t('connection.accountCreateAction')}</button>
              </form> : <p className="muted">{t('connection.readingDaemon')}</p>}
              <p className="muted pairing-guardrails">{[t('guardrails.untrusted'), t('guardrails.approval'), t('guardrails.sse')].join(' · ')}</p>
            </div>
          </section>}
        </section>
        {connected && <ContextRail open={contextOpen} goalProjection={goalProjection} goalProjectionLoading={goalProjectionLoading} goalProjectionUnavailable={goalProjectionUnavailable} goalProjectionRefreshing={goalProjectionRefreshing} {...(onRefreshGoalProjection ? { onRefreshGoalProjection } : {})} {...(onCreateGoal ? { onCreateGoal } : {})} {...(onAddTodo ? { onAddTodo } : {})} {...(onOpenGate ? { onOpenGate } : {})} {...(onResolveGate ? { onResolveGate } : {})} {...(onAttachEvidence ? { onAttachEvidence } : {})} {...(onPreflight ? { onPreflight } : {})} usageSummary={usageSummary} auditEvents={auditEvents} observabilityLoading={observabilityLoading} observabilityUnavailable={observabilityUnavailable} observabilityRefreshing={observabilityRefreshing} {...(onRefreshObservability ? { onRefreshObservability } : {})} {...(health ? { health } : {})} copy={{ ariaLabel: t('rail.contextAriaLabel'), connectionEyebrow: t('connection.eyebrow'), connectionTitle: t('rail.connectionTitle'), description: t('connection.tagline'), readingDaemon: t('connection.readingDaemon'), transport: 'transport', tls: 'TLS', sandbox: 'sandbox', safetyTitle: t('guardrails.title'), guardrails: [t('guardrails.untrusted'), t('guardrails.approval'), t('guardrails.sse')], tabGoals: t('rail.goals'), tabTelemetry: t('rail.telemetry'), tabWorkspace: t('rail.workspace') }} />}
      </section>
      <SetupWizard open={setupOpen} {...(workspaces ? { workspaces } : {})} activeWorkspaceId={profile.workspaceId} {...(deepSeekProbe ? { deepSeekProbe } : {})} copy={{ title: t('setup.title'), stepProvider: t('setup.stepProvider'), stepWorkspace: t('setup.stepWorkspace'), stepDone: t('setup.stepDone'), providerTitle: t('setup.providerTitle'), providerDescription: t('setup.providerDescription'), providerPickerAriaLabel: t('setup.providerPickerAriaLabel'), providerDeepSeekLabel: t('setup.providerDeepSeekLabel'), providerDeepSeekDescription: t('setup.providerDeepSeekDescription'), providerRecommendedBadge: t('setup.providerRecommendedBadge'), providerCustomLabel: t('setup.providerCustomLabel'), providerCustomDescription: t('setup.providerCustomDescription'), baseUrl: t('setup.baseUrl'), endpointProfile: t('setup.endpointProfile'), endpoint: t('setup.endpoint'), model: t('setup.model'), apiKey: t('setup.apiKey'), probe: t('setup.probe'), saveAndContinue: t('setup.saveAndContinue'), continueLabel: t('setup.continueLabel'), skip: t('setup.skip'), workspaceTitle: t('setup.workspaceTitle'), workspaceDescription: t('setup.workspaceDescription'), doneTitle: t('setup.doneTitle'), doneDescription: t('setup.doneDescription'), startTask: t('setup.startTask'), close: t('setup.close') }} onConfigureDeepSeek={async (input) => { await onConfigureDeepSeek?.(input); }} {...(onConfigureModel ? { onConfigureModel: async (input) => { await onConfigureModel(input); } } : {})} {...(onProbeDeepSeek ? { onProbeDeepSeek: () => onProbeDeepSeek() } : {})} onSelectWorkspace={(workspaceId) => updateProfile({ workspaceId })} onClose={closeSetup} />
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
