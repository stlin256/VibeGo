import { StrictMode, useEffect, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, DEFAULT_RUN_PROFILE, type CertificateStatus, type HealthResponse, type RunProfile, type RunSnapshot, type StoredEvent, type RunConfigInput } from './api.js';
import { App } from './App.js';

const client = new ApiClient(import.meta.env.VITE_READY4VIBE_API_BASE_URL ?? '');

function RuntimeApp(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse>();
  const [run, setRun] = useState<RunSnapshot>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string>();
  const [profile, setProfile] = useState<RunProfile>(DEFAULT_RUN_PROFILE);
  const [certificateStatus, setCertificateStatus] = useState<CertificateStatus>();
  const [certificateStatusUnavailable, setCertificateStatusUnavailable] = useState(false);

  const refreshCertificateStatus = async (): Promise<void> => {
    try {
      setCertificateStatus(await client.certificateStatus());
      setCertificateStatusUnavailable(false);
    } catch (reason) {
      setCertificateStatus(undefined);
      setCertificateStatusUnavailable(isCertificateStatusUnavailable(reason));
    }
  };

  useEffect(() => {
    void client.health().then((nextHealth) => {
      setHealth(nextHealth);
      if (!nextHealth.auth.pairingRequired) void refreshCertificateStatus();
    }).catch((reason: unknown) => setError(safeError(reason)));
  }, []);

  const pair = async (code: string): Promise<void> => {
    try {
      await client.completePairing(code);
      setError(undefined);
      setHealth(await client.health());
      await refreshCertificateStatus();
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

  return <App {...(health ? { health } : {})} {...(run ? { run } : {})} events={events} {...(error ? { error } : {})} profile={profile} {...(certificateStatus ? { certificateStatus } : {})} certificateStatusUnavailable={certificateStatusUnavailable} onProfileChange={setProfile} onResetProfile={() => setProfile(DEFAULT_RUN_PROFILE)} onPair={pair} onCreateRun={createRun} onCancel={cancel} onApprove={approve} onRetry={retry} />;
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

createRoot(document.getElementById('root')!).render(<StrictMode><RuntimeApp /></StrictMode>);
