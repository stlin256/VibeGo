import { StrictMode, useEffect, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, type HealthResponse, type RunSnapshot, type StoredEvent, type RunConfigInput } from './api.js';
import { App } from './App.js';

const client = new ApiClient(import.meta.env.VITE_READY4VIBE_API_BASE_URL ?? '');

function RuntimeApp(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse>();
  const [run, setRun] = useState<RunSnapshot>();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void client.health().then(setHealth).catch((reason: unknown) => setError(safeError(reason)));
  }, []);

  const pair = async (code: string): Promise<void> => {
    try {
      await client.completePairing(code);
      setError(undefined);
      setHealth(await client.health());
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
        workspaceId: 'default', userMessage: message, model: { provider: 'configured-default', name: 'deepseek-v4-flash' }, taskTrust: 'trusted-workspace', sandbox: { mode: 'read-only', network: 'restricted' }, approval: 'on-request', limits: { maxTurns: 12, maxWallTimeMs: 600_000, maxModelInputTokens: 8_000, maxModelOutputTokens: 4_000, maxToolCalls: 50, maxOutputBytes: 2_000_000, maxContextBytes: 64_000 }, createdBySessionId: 'web-memory-session', clientRequestId: crypto.randomUUID(),
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

  return <App {...(health ? { health } : {})} {...(run ? { run } : {})} events={events} {...(error ? { error } : {})} onPair={pair} onCreateRun={createRun} onCancel={cancel} onApprove={approve} onRetry={retry} />;
}

function readTextDelta(payload: unknown): string {
  return typeof payload === 'object' && payload !== null && 'text' in payload && typeof payload.text === 'string' ? payload.text : '';
}

function safeError(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') return `请求失败：${reason.code}`;
  return '请求失败，请检查 daemon 连接。';
}

createRoot(document.getElementById('root')!).render(<StrictMode><RuntimeApp /></StrictMode>);
