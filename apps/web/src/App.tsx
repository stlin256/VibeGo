import type { FormEvent, JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_RUN_PROFILE, type AgentMemorySettingsMode, type AgentMemorySettingsPatchInput, type AgentMemorySettingsStatus, type CertificateStatus, type GitSettingsStatus, type HealthResponse, type ModelSettingsInput, type ModelSettingsStatus, type SandboxSettingsStatus, type ToolSettingsStatus, type WorkspaceRegistryStatus, type RunProfile, type RunSnapshot, type StoredEvent } from './api.js';
import type { GoalProjectionListResponse } from './api.js';
import { GoalProjectionPanel } from './GoalProjectionPanel.js';
import './styles.css';

export interface AppProps {
  health?: HealthResponse;
  run?: RunSnapshot;
  events?: readonly StoredEvent[];
  error?: string;
  onPair?: (code: string) => void;
  onCreateRun?: (message: string) => void;
  onCancel?: () => void;
  onApprove?: (approvalId: string, decision: 'allow' | 'deny') => void;
  onRetry?: () => void;
  profile?: RunProfile;
  onProfileChange?: (profile: RunProfile) => void;
  onResetProfile?: () => void;
  certificateStatus?: CertificateStatus;
  certificateStatusUnavailable?: boolean;
  modelSettings?: ModelSettingsStatus;
  modelSettingsUnavailable?: boolean;
  onConfigureModel?: (input: ModelSettingsInput) => Promise<void> | void;
  onClearModelSettings?: () => Promise<void> | void;
  agentMemorySettings?: AgentMemorySettingsStatus;
  agentMemorySettingsUnavailable?: boolean;
  onPatchAgentMemorySettings?: (input: AgentMemorySettingsPatchInput) => Promise<void> | void;
  onProbeAgentMemory?: () => Promise<void> | void;
  onUpdateAgentMemory?: () => Promise<void> | void;
  onRollbackAgentMemory?: () => Promise<void> | void;
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
}

export function App({ health, run, events = [], error, onPair, onCreateRun, onCancel, onApprove, onRetry, profile = DEFAULT_RUN_PROFILE, onProfileChange, onResetProfile, certificateStatus, certificateStatusUnavailable = false, modelSettings, modelSettingsUnavailable = false, onConfigureModel, onClearModelSettings, agentMemorySettings, agentMemorySettingsUnavailable = false, onPatchAgentMemorySettings, onProbeAgentMemory, onUpdateAgentMemory, onRollbackAgentMemory, toolSettings, toolSettingsUnavailable = false, onSetFilesystemToolsEnabled, gitSettings, gitSettingsUnavailable = false, onSetGitToolsEnabled, sandboxSettings, sandboxSettingsUnavailable = false, onProbeSandbox, onSetSandboxSettings, workspaces, workspacesUnavailable = false, onAddWorkspace, onRemoveWorkspace, goalProjection, goalProjectionLoading = false, goalProjectionUnavailable = false, goalProjectionRefreshing = false, onRefreshGoalProjection }: AppProps): JSX.Element {
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [modelBaseUrl, setModelBaseUrl] = useState('https://api.deepseek.com');
  const [modelApiKey, setModelApiKey] = useState('');
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryMode, setMemoryMode] = useState<AgentMemorySettingsMode>('memory-core');
  const [memoryTeamId, setMemoryTeamId] = useState('vibego');
  const [memoryAgentId, setMemoryAgentId] = useState('vibego-local-agent');
  const [memoryUserId, setMemoryUserId] = useState('local-user');
  const [memoryUpstreamRepo, setMemoryUpstreamRepo] = useState('https://github.com/TencentCloud/TencentDB-Agent-Memory');
  const [memoryUpstreamRef, setMemoryUpstreamRef] = useState('feat/server_team');
  const [memoryAutoUpdate, setMemoryAutoUpdate] = useState(true);
  const [memoryIntervalMinutes, setMemoryIntervalMinutes] = useState(60);
  const [memoryFallback, setMemoryFallback] = useState(true);
  const [memoryBusy, setMemoryBusy] = useState(false);
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
  const [contextOpen, setContextOpen] = useState(true);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (modelSettings?.baseUrl) setModelBaseUrl(modelSettings.baseUrl);
  }, [modelSettings?.baseUrl]);
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
    setMemoryAutoUpdate(settings.autoUpdate);
    setMemoryIntervalMinutes(settings.updateIntervalMinutes);
    setMemoryFallback(settings.fallbackToDirectProvider);
  }, [agentMemorySettings?.settings]);
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
  const saveAgentMemorySettings = async (): Promise<void> => {
    if (!onPatchAgentMemorySettings) return;
    setMemoryBusy(true);
    try {
      await onPatchAgentMemorySettings({ enabled: memoryEnabled, mode: memoryMode, teamId: memoryTeamId, agentId: memoryAgentId, userId: memoryUserId, upstreamRepo: memoryUpstreamRepo, upstreamRef: memoryUpstreamRef, autoUpdate: memoryAutoUpdate, updateIntervalMinutes: memoryIntervalMinutes, fallbackToDirectProvider: memoryFallback });
    } catch { /* Parent renders a safe error and keeps the draft for retry. */ } finally { setMemoryBusy(false); }
  };
  const runAgentMemoryAction = async (action?: () => Promise<void> | void): Promise<void> => {
    if (!action) return;
    setMemoryBusy(true);
    try { await action(); } catch { /* Parent renders a safe error. */ } finally { setMemoryBusy(false); }
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
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setSettingsOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><img className="brand-mark" src="/vibego-mark.svg" alt="VibeGo" /><span>Vibe<span className="brand-go">Go</span></span></div>
        <div className="topbar-actions">
          <button className="topbar-button primary-task-button" type="button" onClick={startNewTask}>New task</button>
          <button className="topbar-button context-toggle" type="button" aria-expanded={contextOpen} onClick={() => setContextOpen((current) => !current)}>{contextOpen ? 'Hide details' : 'Details'}</button>
          <button className="topbar-button settings-toggle" type="button" aria-expanded={settingsOpen} aria-controls="settings-drawer" onClick={() => setSettingsOpen(true)}>Settings</button>
          <div className="connection-pill" data-connected={connected}>{connected ? '已连接' : '等待配对'}</div>
        </div>
      </header>
      <section className="content-grid">
        <nav className="workspace-rail" aria-label="Workspace navigation">
          <div className="eyebrow">WORKSPACE</div>
          <strong className="workspace-rail-name">{workspaces?.workspaces.find((workspace) => workspace.id === profile.workspaceId)?.label ?? profile.workspaceId}</strong>
          <p className="muted">Local session</p>
          <button className="rail-new-button" type="button" onClick={startNewTask}>＋ New task</button>
          <div className="rail-section-label">RECENT</div>
          <div className="rail-session active"><span className="session-dot" />Current task</div>
          <div className="rail-session"><span className="session-dot muted-dot" />No other runs</div>
          <button className="rail-settings-button" type="button" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
        </nav>
        <aside className="sidebar" aria-label="连接与运行摘要">
          <section id="settings-drawer" className="panel settings-panel" data-open={settingsOpen} aria-label="Run settings">
            <div className="settings-drawer-header"><div><div className="eyebrow">SETTINGS</div><h2>Run profile</h2></div><button className="drawer-close" type="button" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>Close</button></div>
            <p className="muted">Configure this run from the console; no config file editing is required.</p>
            <div className="settings-grid">
              <div className="workspace-setup" aria-label="Workspace setup">
                <div className="eyebrow">WORKSPACES</div>
                {workspacesUnavailable ? <p className="muted">Workspace setup is unavailable until the daemon exposes the authenticated registry.</p> : workspaces ? <>
                  <label>Workspace<select value={profile.workspaceId} disabled={workspaceBusy} onChange={(event) => updateProfile({ workspaceId: event.target.value })}>{workspaces.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.label} · {workspace.id}{workspace.isDefault ? ' · default' : ''}</option>)}</select></label>
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
              <label>Model provider<input value={profile.model.provider} onChange={(event) => updateProfile({ model: { ...profile.model, provider: event.target.value } })} /></label>
              <label>Model name<input value={profile.model.name} onChange={(event) => updateProfile({ model: { ...profile.model, name: event.target.value } })} /></label>
              <div className="model-setup" aria-label="Model provider setup">
                <div className="eyebrow">MODEL ACCESS</div>
                {modelSettingsUnavailable ? <p className="muted">Model setup is unavailable until the daemon exposes the authenticated settings adapter.</p> : <>
                  <p className="muted">{modelSettings?.configured ? `Configured via ${modelSettings.source}. The key is held by the daemon and is never shown here.` : 'Set up a provider here; no .env or YAML editing is required.'}</p>
                  {modelSettings?.configured && <p className="muted">{modelSettings.providerId} · {modelSettings.baseUrl ?? 'URL hidden'}{modelSettings.modelName ? ` · ${modelSettings.modelName}` : ''}</p>}
                  <form onSubmit={(event) => { void submitModelSettings(event); }}>
                    <label>Provider URL<input type="url" value={modelBaseUrl} onChange={(event) => setModelBaseUrl(event.target.value)} placeholder="https://api.deepseek.com" autoComplete="url" /></label>
                    <label>API key<input type="password" value={modelApiKey} onChange={(event) => setModelApiKey(event.target.value)} placeholder={modelSettings?.configured ? 'Enter a replacement key' : 'Paste once; never stored in browser'} autoComplete="new-password" /></label>
                    <div className="inline-actions"><button type="submit" disabled={!modelApiKey}>Save provider</button>{modelSettings?.configured && <button className="cancel-button" type="button" onClick={() => { void (async () => { await onClearModelSettings?.(); setModelApiKey(''); })(); }}>Clear daemon key</button>}</div>
                  </form>
                </>}
              </div>
              <div className="tool-setup memory-setup" aria-label="Agent memory setup">
                <div className="eyebrow">AGENT MEMORY</div>
                {agentMemorySettingsUnavailable ? <p className="muted">Agent memory settings are unavailable; normal runs are unaffected.</p> : agentMemorySettings ? <>
                  <label className="toggle-row"><input type="checkbox" checked={memoryEnabled} disabled={memoryBusy} onChange={(event) => setMemoryEnabled(event.target.checked)} /><span>Enable optional long-term memory</span></label>
                  <p className="muted">Memory is an untrusted retrieval enhancement. It never grants tools, bypasses approval, or changes Goal/run facts.</p>
                  <div className="inline-actions"><label>Mode<select value={memoryMode} disabled={memoryBusy} onChange={(event) => setMemoryMode(event.target.value as AgentMemorySettingsMode)}><option value="memory-core">MemoryCore</option><option value="proxy">Proxy (later)</option><option value="full-stack">Full stack (later)</option><option value="off">Off</option></select></label><label>Interval (min)<input type="number" min={5} max={1440} value={memoryIntervalMinutes} disabled={memoryBusy} onChange={(event) => setMemoryIntervalMinutes(Math.max(5, Math.min(1440, Number(event.target.value) || 60)))} /></label></div>
                  <div className="inline-actions"><label>Team ID<input value={memoryTeamId} disabled={memoryBusy} onChange={(event) => setMemoryTeamId(event.target.value)} /></label><label>Agent ID<input value={memoryAgentId} disabled={memoryBusy} onChange={(event) => setMemoryAgentId(event.target.value)} /></label><label>User ID<input value={memoryUserId} disabled={memoryBusy} onChange={(event) => setMemoryUserId(event.target.value)} /></label></div>
                  <label>Upstream repository<input value={memoryUpstreamRepo} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRepo(event.target.value)} /></label>
                  <label>Upstream ref<input value={memoryUpstreamRef} disabled={memoryBusy} onChange={(event) => setMemoryUpstreamRef(event.target.value)} /></label>
                  <label className="toggle-row"><input type="checkbox" checked={memoryAutoUpdate} disabled={memoryBusy} onChange={(event) => setMemoryAutoUpdate(event.target.checked)} /><span>Allow scheduled upstream checks</span></label>
                  <label className="toggle-row"><input type="checkbox" checked={memoryFallback} disabled={memoryBusy} onChange={(event) => setMemoryFallback(event.target.checked)} /><span>Fall back to direct provider when memory is unavailable</span></label>
                  <p className="muted">Status: {agentMemorySettings.status.updateState} · {agentMemorySettings.status.available ? 'ready' : agentMemorySettings.status.degraded ? 'degraded' : 'disabled'} · current {agentMemorySettings.currentRevision ?? 'none'} · previous {agentMemorySettings.previousRevision ?? 'none'}</p>
                  <div className="inline-actions"><button type="button" disabled={memoryBusy} onClick={() => { void saveAgentMemorySettings(); }}>Save memory settings</button><button type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onProbeAgentMemory); }}>Probe</button><button type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onUpdateAgentMemory); }}>Update</button><button className="cancel-button" type="button" disabled={memoryBusy} onClick={() => { void runAgentMemoryAction(onRollbackAgentMemory); }}>Roll back</button></div>
                </> : <p className="muted">Pair with the daemon to configure optional memory.</p>}
              </div>
              <div className="tool-setup" aria-label="Filesystem tool setup">
                <div className="eyebrow">TOOL ACCESS</div>
                {toolSettingsUnavailable ? <p className="muted">Tool settings are unavailable until the daemon exposes the authenticated adapter.</p> : toolSettings ? <>
                  <label className="toggle-row"><input type="checkbox" checked={toolSettings.filesystemEnabled} disabled={toolToggleBusy} onChange={(event) => { void toggleFilesystemTools(event.target.checked); }} /><span>Enable guarded filesystem tools</span></label>
                  <p className="muted">Workspace: {toolSettings.workspaceLabel}. Reads are bounded; writes still require approval. Shell, MCP, and network tools remain disabled here; Git reads have a separate toggle.</p>
                  {toolSettings.availableTools.length > 0 && <p className="muted">Available: {toolSettings.availableTools.join(', ')}</p>}
                </> : <p className="muted">Pair with the daemon to configure guarded filesystem tools.</p>}
              </div>
              <div className="tool-setup" aria-label="Git read-only tool setup">
                <div className="eyebrow">GIT READ-ONLY TOOLS</div>
                {gitSettingsUnavailable ? <p className="muted">Git settings are unavailable until the daemon exposes the authenticated adapter.</p> : gitSettings ? <>
                  <label className="toggle-row"><input type="checkbox" checked={gitSettings.enabled} disabled={gitToggleBusy} onChange={(event) => { void toggleGitTools(event.target.checked); }} /><span>Enable Git read-only tools</span></label>
                  <p className="muted">Workspace: {gitSettings.workspaceLabel}. This exposes only bounded status, diff, and log reads; commits, checkout, reset, patch writes, remotes, and arbitrary Git flags remain unavailable.</p>
                  {gitSettings.availableTools.length > 0 && <p className="muted">Available: {gitSettings.availableTools.join(', ')}</p>}
                </> : <p className="muted">Pair with the daemon to configure Git read-only tools.</p>}
              </div>
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
              <label>Task trust<select value={profile.taskTrust} onChange={(event) => updateProfile({ taskTrust: event.target.value as RunProfile['taskTrust'] })}><option value="trusted-workspace">Trusted workspace</option><option value="untrusted-content">Untrusted content</option></select></label>
              <label>Sandbox<select value={profile.sandbox.mode} onChange={(event) => updateSandboxMode(event.target.value as RunProfile['sandbox']['mode'])}><option value="read-only">Read-only</option><option value="workspace-write">Workspace write</option><option value="external-sandbox">External sandbox</option></select></label>
              <label>Network<select value={'network' in profile.sandbox ? profile.sandbox.network : 'restricted'} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, network: event.target.value as 'restricted' | 'enabled' } as RunProfile['sandbox'] })}><option value="restricted">Restricted</option><option value="enabled">Enabled</option></select></label>
              {profile.sandbox.mode === 'workspace-write' && <label>Writable roots<input value={profile.sandbox.writableRoots?.join(', ') ?? ''} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, writableRoots: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } })} /></label>}
              {profile.sandbox.mode === 'external-sandbox' && <><label>Runtime<select value={profile.sandbox.provider} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, provider: event.target.value as 'docker' | 'podman' | 'vm' } })}><option value="docker">Docker</option><option value="podman">Podman</option><option value="vm">VM</option></select></label><label>Sandbox writable roots<input value={profile.sandbox.writableRoots?.join(', ') ?? ''} onChange={(event) => updateProfile({ sandbox: { ...profile.sandbox, writableRoots: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } })} placeholder="src, tests" /></label></>}
              <label>Approval<select value={typeof profile.approval === 'string' ? profile.approval : 'on-request'} onChange={(event) => updateProfile({ approval: event.target.value as RunProfile['approval'] })}><option value="on-request">On request</option><option value="untrusted">Untrusted tasks</option><option value="never">Never (read-only only)</option></select></label>
              <label>Max turns<input type="number" min={1} max={50} value={profile.limits.maxTurns} onChange={(event) => updateLimit('maxTurns', event.target.value)} /></label>
              <label>Wall time (ms)<input type="number" min={1} max={1800000} value={profile.limits.maxWallTimeMs} onChange={(event) => updateLimit('maxWallTimeMs', event.target.value)} /></label>
              <label>Model input tokens<input type="number" min={1} value={profile.limits.maxModelInputTokens} onChange={(event) => updateLimit('maxModelInputTokens', event.target.value)} /></label>
              <label>Model output tokens<input type="number" min={1} value={profile.limits.maxModelOutputTokens} onChange={(event) => updateLimit('maxModelOutputTokens', event.target.value)} /></label>
              <label>Max tool calls<input type="number" min={1} max={200} value={profile.limits.maxToolCalls} onChange={(event) => updateLimit('maxToolCalls', event.target.value)} /></label>
              <label>Max output bytes<input type="number" min={1} value={profile.limits.maxOutputBytes} onChange={(event) => updateLimit('maxOutputBytes', event.target.value)} /></label>
              <label>Max context bytes<input type="number" min={1} value={profile.limits.maxContextBytes} onChange={(event) => updateLimit('maxContextBytes', event.target.value)} /></label>
            </div>
            <button className="reset-button" type="button" onClick={onResetProfile}>Reset conservative defaults</button>
            <div className="certificate-guidance">
              <div className="eyebrow">TLS STATUS</div>
              {certificateStatus ? <><strong>{certificateStatus.subject}</strong><p className="muted">Valid to {new Date(certificateStatus.validTo).toLocaleDateString()} · {certificateStatus.daysRemaining} days remaining</p><p className="muted">SAN: {certificateStatus.subjectAltNames.join(', ') || 'not reported'}</p></> : health?.transport.tlsRequired || certificateStatusUnavailable ? <p className="muted">Certificate setup is required for this TLS transport. Use the daemon certificate adapter; private keys are never entered or shown in this browser.</p> : <p className="muted">Loopback HTTP is active for local development. Pairing and future TLS setup remain available.</p>}
            </div>
          </section>
          {!connected && <>
            <section className="panel connection-panel">
              <div className="eyebrow">CONNECTION</div>
              <h1>连接你的本地工作区</h1>
              <p className="muted">Vibe Coding，随时随地；执行有边界，进度可继续。</p>
              {health ? <dl className="summary-list"><div><dt>transport</dt><dd>{health.transport.kind}</dd></div><div><dt>TLS</dt><dd>{health.transport.tlsRequired ? 'required' : 'off'}</dd></div><div><dt>sandbox</dt><dd>{health.sandbox.availableModes.join(' · ')}</dd></div></dl> : <p className="muted">正在读取 daemon 状态…</p>}
            </section>
            <section className="panel pairing-panel"><div className="eyebrow">PAIRING</div><h2>输入一次性配对码</h2><p className="muted">配对完成后 token 只保存在当前页面内。</p><form onSubmit={submitPairing}><label htmlFor="pairing-code">Pairing code</label><input id="pairing-code" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} autoComplete="off" inputMode="text" /><button type="submit">连接 daemon</button></form></section>
            <section className="panel safety-panel"><div className="eyebrow">GUARDRAILS</div><ul><li>不可信任务强制 external sandbox</li><li>写入与命令按策略请求审批</li><li>事件流可按 seq 断线续传</li></ul></section>
          </>}
        </aside>
        <section className="main-column">
          {error && <div className="error-banner" role="alert">{error}</div>}
          {connected ? <>
            <section className="conversation-column" aria-label="Conversation and run timeline">
              <section className="panel conversation-stream" aria-label="Conversation stream">
                <div className="conversation-stream-header"><div><div className="eyebrow">CONVERSATION</div><h1>What should agent do next?</h1></div><span className="muted conversation-hint">One task at a time · local workspace</span></div>
                {run ? <RunConsole run={run} events={events} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} /> : <div className="empty-state"><span className="empty-icon">⌁</span><h2>Ready for your next task</h2><p className="muted">Describe a change, test, or explanation below. The agent’s plan, output, approvals, and recovery stay in this conversation.</p></div>}
              </section>
              <section className="panel composer-panel"><div className="eyebrow">NEW MESSAGE</div><form onSubmit={submitRun}><textarea ref={composerRef} aria-label="Task input" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask for a change, a test run, or an explanation…" rows={3} /><div className="composer-footer"><span className="muted">{profile.taskTrust === 'untrusted-content' ? 'untrusted content · external sandbox' : 'trusted workspace · read-only'}</span><button type="submit">Start run</button></div></form></section>
            </section>
          </> : <section className="panel empty-state"><span className="empty-icon">◎</span><h2>先完成安全配对</h2><p className="muted">daemon 默认不会把 token 放进 URL、cookie 或本地存储。</p></section>}
        </section>
        {connected && <aside className="context-rail" data-open={contextOpen} aria-label="Run context">
          <GoalProjectionPanel {...(goalProjection ? { projection: goalProjection } : {})} loading={goalProjectionLoading} unavailable={goalProjectionUnavailable} refreshing={goalProjectionRefreshing} {...(onRefreshGoalProjection ? { onRefresh: onRefreshGoalProjection } : {})} />
          <section className="panel connection-panel">
            <div className="eyebrow">CONNECTION</div>
            <h2>Connected workspace</h2>
            <p className="muted">Vibe Coding，随时随地；执行有边界，进度可继续。</p>
            {health ? <dl className="summary-list"><div><dt>transport</dt><dd>{health.transport.kind}</dd></div><div><dt>TLS</dt><dd>{health.transport.tlsRequired ? 'required' : 'off'}</dd></div><div><dt>sandbox</dt><dd>{health.sandbox.availableModes.join(' · ')}</dd></div></dl> : <p className="muted">正在读取 daemon 状态…</p>}
          </section>
          <section className="panel safety-panel"><div className="eyebrow">GUARDRAILS</div><ul><li>不可信任务强制 external sandbox</li><li>写入与命令按策略请求审批</li><li>事件流可按 seq 断线续传</li></ul></section>
        </aside>}
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

const MAX_TOOL_OUTPUT_CARDS = 24;
const MAX_TOOL_OUTPUT_DISPLAY_BYTES = 128 * 1024;

interface ToolOutputView {
  readonly seq: number;
  readonly callId: string;
  readonly toolId: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly content: string;
}

function ToolOutputInspector({ events }: { events: readonly StoredEvent[] }): JSX.Element | null {
  const outputs = collectToolOutputs(events);
  if (outputs.length === 0) return null;
  return <section className="tool-output-list" aria-label="Tool outputs"><div className="eyebrow">TOOL OUTPUTS</div>{outputs.map((output) => <details className="tool-output-card" key={`${output.seq}-${output.callId}`}><summary><span>{output.toolId}</span><span>{output.bytes} bytes{output.truncated ? ' · server truncated' : ''}{output.content.length < output.bytes ? ' · display truncated' : ''}</span></summary><pre>{output.content}</pre></details>)}</section>;
}

function collectToolOutputs(events: readonly StoredEvent[]): ToolOutputView[] {
  const toolIds = new Map<string, string>();
  const outputs: ToolOutputView[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const callId = typeof payload.callId === 'string' ? payload.callId : undefined;
    const toolId = typeof payload.toolId === 'string' ? payload.toolId : undefined;
    if ((event.type === 'tool.requested' || event.type === 'tool.started') && callId && toolId) toolIds.set(callId, toolId);
    if (event.type !== 'tool.output' || !callId || typeof payload.content !== 'string') continue;
    const rawBytes = payload.bytes;
    const bytes = typeof rawBytes === 'number' && Number.isSafeInteger(rawBytes) && rawBytes >= 0 ? rawBytes : new TextEncoder().encode(payload.content).byteLength;
    const truncated = payload.truncated === true;
    outputs.push({ seq: event.seq, callId, toolId: toolIds.get(callId) ?? toolId ?? 'Tool output', bytes, truncated, content: truncateToolOutput(formatToolOutput(payload.content)) });
  }
  return outputs.slice(-MAX_TOOL_OUTPUT_CARDS);
}

function formatToolOutput(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    const record = asRecord(parsed);
    if (record && (typeof record.stdout === 'string' || typeof record.stderr === 'string')) {
      const sections: string[] = [];
      if (typeof record.stdout === 'string' && record.stdout.length > 0) sections.push(record.stdout);
      if (typeof record.stderr === 'string' && record.stderr.length > 0) sections.push(`[stderr]\n${record.stderr}`);
      if (typeof record.exitCode === 'number') sections.push(`[exit code: ${record.exitCode}]`);
      return sections.join('\n');
    }
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2) ?? content;
  } catch {
    return content;
  }
}

function truncateToolOutput(value: string): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= MAX_TOOL_OUTPUT_DISPLAY_BYTES) return value;
  return `${new TextDecoder().decode(encoded.slice(0, MAX_TOOL_OUTPUT_DISPLAY_BYTES))}\n… [display truncated]`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function RunConsole({ run, events, onCancel, onApprove, onRetry }: { run: RunSnapshot; events: readonly StoredEvent[]; onCancel: (() => void) | undefined; onApprove: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined; onRetry: (() => void) | undefined }): JSX.Element {
  return <section className="panel run-panel"><div className="run-header"><div><div className="eyebrow">RUN CONSOLE</div><h2>{run.runId}</h2></div><div className="status-chip" data-status={run.status}>{run.status}</div></div><div className="run-metrics"><div><span>queue</span><strong>{run.scheduler.queuePosition ?? '—'}</strong></div><div><span>active</span><strong>{run.scheduler.activeRunCount}</strong></div><div><span>lease</span><strong>{run.scheduler.workspaceLease ?? '—'}</strong></div><div><span>events</span><strong>{run.lastEventSeq}</strong></div></div>{run.status === 'needs-recovery' && <div className="recovery-card"><div><div className="eyebrow">RECOVERY REQUIRED</div><strong>This run stopped safely after a daemon restart.</strong><p className="muted">Retry creates a new run from the original safety policy; interrupted tool calls are never replayed.</p></div><button type="button" onClick={onRetry}>Retry as new run</button></div>}{run.status !== 'needs-recovery' && (run.approvals ?? []).map((approval) => <div className="approval-card" key={approval.approvalId}><div><div className="eyebrow">APPROVAL REQUIRED</div><strong>{approval.toolId}@{approval.toolVersion}</strong><p className="muted">{approval.risk} · {approval.argumentBytes} bytes · expires {new Date(approval.expiresAt).toLocaleTimeString()}</p>{approval.details && <p className="muted">sandbox: {approval.details.sandboxProvider ?? run.config.sandbox.mode}{approval.details.network ? ` · network: ${approval.details.network}` : ''}{approval.details.sandboxImageDigest ? ` · image: ${approval.details.sandboxImageDigest}` : ''}</p>}</div><div className="approval-actions"><button type="button" onClick={() => onApprove?.(approval.approvalId, 'allow')}>Allow</button><button className="cancel-button" type="button" onClick={() => onApprove?.(approval.approvalId, 'deny')}>Deny</button></div></div>)}<ToolOutputInspector events={events} /><pre className="output-view">{run.output || '等待模型输出…'}</pre><div className="event-list">{events.map((event) => <div className="event-row" key={`${event.runId}-${event.seq}`}><span>{event.seq}</span><span>{event.type}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div>)}</div>{!['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery'].includes(run.status) && <button className="cancel-button" type="button" onClick={onCancel}>请求取消</button>}</section>;
}
