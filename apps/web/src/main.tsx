import { StrictMode, useEffect, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, DEFAULT_RUN_PROFILE, loadRunProfile, resetRunProfile, saveRunProfile, type CertificateStatus, type HealthResponse, type ModelSettingsInput, type ModelSettingsStatus, type SandboxSettingsStatus, type ToolSettingsStatus, type RunProfile, type RunSnapshot, type StoredEvent, type RunConfigInput } from './api.js';
import { App } from './App.js';

const client = new ApiClient(import.meta.env.VITE_READY4VIBE_API_BASE_URL ?? '');

function RuntimeApp(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse>();
  const [run, setRun] = useState<RunSnapshot>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string>();
  const [profile, setProfile] = useState<RunProfile>(() => loadRunProfile());
  const [certificateStatus, setCertificateStatus] = useState<CertificateStatus>();
  const [certificateStatusUnavailable, setCertificateStatusUnavailable] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettingsStatus>();
  const [modelSettingsUnavailable, setModelSettingsUnavailable] = useState(false);
  const [toolSettings, setToolSettings] = useState<ToolSettingsStatus>();
  const [toolSettingsUnavailable, setToolSettingsUnavailable] = useState(false);
  const [sandboxSettings, setSandboxSettings] = useState<SandboxSettingsStatus>();
  const [sandboxSettingsUnavailable, setSandboxSettingsUnavailable] = useState(false);

  useEffect(() => {
    saveRunProfile(profile);
  }, [profile]);

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

  useEffect(() => {
    void client.health().then((nextHealth) => {
      setHealth(nextHealth);
      if (!nextHealth.auth.pairingRequired) {
        void refreshCertificateStatus();
        void refreshModelSettings();
        void refreshToolSettings();
        void refreshSandboxSettings();
      }
    }).catch((reason: unknown) => setError(safeError(reason)));
  }, []);

  const pair = async (code: string): Promise<void> => {
    try {
      await client.completePairing(code);
      setError(undefined);
      setHealth(await client.health());
      await refreshCertificateStatus();
      await refreshModelSettings();
      await refreshToolSettings();
      await refreshSandboxSettings();
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

  const clearModelSettings = async (): Promise<void> => {
    try {
      const status = await client.clearModelSettings();
      setModelSettings(status);
      setModelSettingsUnavailable(false);
      setError(undefined);
    } catch (reason) { setError(safeError(reason)); }
  };

  const setFilesystemToolsEnabled = async (enabled: boolean): Promise<void> => {
    try {
      setToolSettings(await client.setFilesystemToolsEnabled(enabled));
      setToolSettingsUnavailable(false);
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

  const resetProfile = (): void => {
    resetRunProfile();
    setProfile(DEFAULT_RUN_PROFILE);
  };

  return <App {...(health ? { health } : {})} {...(run ? { run } : {})} events={events} {...(error ? { error } : {})} profile={profile} {...(certificateStatus ? { certificateStatus } : {})} certificateStatusUnavailable={certificateStatusUnavailable} {...(modelSettings ? { modelSettings } : {})} modelSettingsUnavailable={modelSettingsUnavailable} {...(toolSettings ? { toolSettings } : {})} toolSettingsUnavailable={toolSettingsUnavailable} {...(sandboxSettings ? { sandboxSettings } : {})} sandboxSettingsUnavailable={sandboxSettingsUnavailable} onProfileChange={setProfile} onResetProfile={resetProfile} onPair={pair} onCreateRun={createRun} onCancel={cancel} onApprove={approve} onRetry={retry} onConfigureModel={configureModel} onClearModelSettings={clearModelSettings} onSetFilesystemToolsEnabled={setFilesystemToolsEnabled} onProbeSandbox={probeSandbox} onSetSandboxSettings={setSandboxSettingsFromWeb} />;
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

function isToolSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'TOOL_SETTINGS_UNAVAILABLE';
}

function isSandboxSettingsUnavailable(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'SANDBOX_SETTINGS_UNAVAILABLE';
}

createRoot(document.getElementById('root')!).render(<StrictMode><RuntimeApp /></StrictMode>);
