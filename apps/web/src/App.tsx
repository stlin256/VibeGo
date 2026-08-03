import type { FormEvent, JSX } from 'react';
import { useEffect, useState } from 'react';
import { DEFAULT_RUN_PROFILE, type CertificateStatus, type GitSettingsStatus, type HealthResponse, type ModelSettingsInput, type ModelSettingsStatus, type SandboxSettingsStatus, type ToolSettingsStatus, type WorkspaceRegistryStatus, type RunProfile, type RunSnapshot, type StoredEvent } from './api.js';
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
}

export function App({ health, run, events = [], error, onPair, onCreateRun, onCancel, onApprove, onRetry, profile = DEFAULT_RUN_PROFILE, onProfileChange, onResetProfile, certificateStatus, certificateStatusUnavailable = false, modelSettings, modelSettingsUnavailable = false, onConfigureModel, onClearModelSettings, toolSettings, toolSettingsUnavailable = false, onSetFilesystemToolsEnabled, gitSettings, gitSettingsUnavailable = false, onSetGitToolsEnabled, sandboxSettings, sandboxSettingsUnavailable = false, onProbeSandbox, onSetSandboxSettings, workspaces, workspacesUnavailable = false, onAddWorkspace, onRemoveWorkspace }: AppProps): JSX.Element {
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
  const [modelBaseUrl, setModelBaseUrl] = useState('https://api.deepseek.com');
  const [modelApiKey, setModelApiKey] = useState('');
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
  useEffect(() => {
    if (modelSettings?.baseUrl) setModelBaseUrl(modelSettings.baseUrl);
  }, [modelSettings?.baseUrl]);
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
  useEffect(() => {
    if (!workspaces || workspaces.workspaces.some((workspace) => workspace.id === profile.workspaceId)) return;
    const fallback = workspaces.workspaces.find((workspace) => workspace.isDefault) ?? workspaces.workspaces[0];
    if (fallback) updateProfile({ workspaceId: fallback.id });
  }, [profile.workspaceId, workspaces]);
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
        <div className="connection-pill" data-connected={connected}>{connected ? '已连接' : '等待配对'}</div>
      </header>
      <section className="content-grid">
        <aside className="sidebar" aria-label="连接与运行摘要">
          <section className="panel settings-panel">
            <div className="eyebrow">SETTINGS</div>
            <h2>Run profile</h2>
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
          <section className="panel connection-panel">
            <div className="eyebrow">CONNECTION</div>
            <h1>连接你的本地工作区</h1>
            <p className="muted">Vibe Coding，随时随地；执行有边界，进度可继续。</p>
            {health ? <dl className="summary-list"><div><dt>transport</dt><dd>{health.transport.kind}</dd></div><div><dt>TLS</dt><dd>{health.transport.tlsRequired ? 'required' : 'off'}</dd></div><div><dt>sandbox</dt><dd>{health.sandbox.availableModes.join(' · ')}</dd></div></dl> : <p className="muted">正在读取 daemon 状态…</p>}
          </section>
          {!connected && <section className="panel pairing-panel"><div className="eyebrow">PAIRING</div><h2>输入一次性配对码</h2><p className="muted">配对完成后 token 只保存在当前页面内。</p><form onSubmit={submitPairing}><label htmlFor="pairing-code">Pairing code</label><input id="pairing-code" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} autoComplete="off" inputMode="text" /><button type="submit">连接 daemon</button></form></section>}
          <section className="panel safety-panel"><div className="eyebrow">GUARDRAILS</div><ul><li>不可信任务强制 external sandbox</li><li>写入与命令按策略请求审批</li><li>事件流可按 seq 断线续传</li></ul></section>
        </aside>
        <section className="main-column">
          {error && <div className="error-banner" role="alert">{error}</div>}
          {connected ? <>
            <section className="panel composer-panel"><div className="eyebrow">NEW RUN</div><h2>告诉 agent 下一步做什么</h2><form onSubmit={submitRun}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="例如：运行测试，定位失败原因并给出最小修复。" rows={4} /><div className="composer-footer"><span className="muted">默认：trusted workspace · read-only</span><button type="submit">开始 run</button></div></form></section>
            {run ? <RunConsole run={run} events={events} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} /> : <section className="panel empty-state"><span className="empty-icon">⌁</span><h2>还没有活动 run</h2><p className="muted">提交一个任务，实时查看 agent 的计划、输出和审批。</p></section>}
          </> : <section className="panel empty-state"><span className="empty-icon">◎</span><h2>先完成安全配对</h2><p className="muted">daemon 默认不会把 token 放进 URL、cookie 或本地存储。</p></section>}
        </section>
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

function RunConsole({ run, events, onCancel, onApprove, onRetry }: { run: RunSnapshot; events: readonly StoredEvent[]; onCancel: (() => void) | undefined; onApprove: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined; onRetry: (() => void) | undefined }): JSX.Element {
  return <section className="panel run-panel"><div className="run-header"><div><div className="eyebrow">RUN CONSOLE</div><h2>{run.runId}</h2></div><div className="status-chip" data-status={run.status}>{run.status}</div></div><div className="run-metrics"><div><span>queue</span><strong>{run.scheduler.queuePosition ?? '—'}</strong></div><div><span>active</span><strong>{run.scheduler.activeRunCount}</strong></div><div><span>lease</span><strong>{run.scheduler.workspaceLease ?? '—'}</strong></div><div><span>events</span><strong>{run.lastEventSeq}</strong></div></div>{run.status === 'needs-recovery' && <div className="recovery-card"><div><div className="eyebrow">RECOVERY REQUIRED</div><strong>This run stopped safely after a daemon restart.</strong><p className="muted">Retry creates a new run from the original safety policy; interrupted tool calls are never replayed.</p></div><button type="button" onClick={onRetry}>Retry as new run</button></div>}{run.status !== 'needs-recovery' && (run.approvals ?? []).map((approval) => <div className="approval-card" key={approval.approvalId}><div><div className="eyebrow">APPROVAL REQUIRED</div><strong>{approval.toolId}@{approval.toolVersion}</strong><p className="muted">{approval.risk} · {approval.argumentBytes} bytes · expires {new Date(approval.expiresAt).toLocaleTimeString()}</p>{approval.details && <p className="muted">sandbox: {approval.details.sandboxProvider ?? run.config.sandbox.mode}{approval.details.network ? ` · network: ${approval.details.network}` : ''}{approval.details.sandboxImageDigest ? ` · image: ${approval.details.sandboxImageDigest}` : ''}</p>}</div><div className="approval-actions"><button type="button" onClick={() => onApprove?.(approval.approvalId, 'allow')}>Allow</button><button className="cancel-button" type="button" onClick={() => onApprove?.(approval.approvalId, 'deny')}>Deny</button></div></div>)}<pre className="output-view">{run.output || '等待模型输出…'}</pre><div className="event-list">{events.map((event) => <div className="event-row" key={`${event.runId}-${event.seq}`}><span>{event.seq}</span><span>{event.type}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div>)}</div>{!['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery'].includes(run.status) && <button className="cancel-button" type="button" onClick={onCancel}>请求取消</button>}</section>;
}
