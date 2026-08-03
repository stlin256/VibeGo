import type { FormEvent, JSX } from 'react';
import { useState } from 'react';
import type { HealthResponse, RunSnapshot, StoredEvent } from './api.js';
import './styles.css';

export interface AppProps {
  health?: HealthResponse;
  run?: RunSnapshot;
  events?: readonly StoredEvent[];
  error?: string;
  onPair?: (code: string) => void;
  onCreateRun?: (message: string) => void;
  onCancel?: () => void;
}

export function App({ health, run, events = [], error, onPair, onCreateRun, onCancel }: AppProps): JSX.Element {
  const [pairingCode, setPairingCode] = useState('');
  const [message, setMessage] = useState('');
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><img className="brand-mark" src="/vibego-mark.svg" alt="VibeGo" /><span>Vibe<span className="brand-go">Go</span></span></div>
        <div className="connection-pill" data-connected={connected}>{connected ? '已连接' : '等待配对'}</div>
      </header>
      <section className="content-grid">
        <aside className="sidebar" aria-label="连接与运行摘要">
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
            {run ? <RunConsole run={run} events={events} onCancel={onCancel} /> : <section className="panel empty-state"><span className="empty-icon">⌁</span><h2>还没有活动 run</h2><p className="muted">提交一个任务，实时查看 agent 的计划、输出和审批。</p></section>}
          </> : <section className="panel empty-state"><span className="empty-icon">◎</span><h2>先完成安全配对</h2><p className="muted">daemon 默认不会把 token 放进 URL、cookie 或本地存储。</p></section>}
        </section>
      </section>
    </main>
  );
}

function RunConsole({ run, events, onCancel }: { run: RunSnapshot; events: readonly StoredEvent[]; onCancel: (() => void) | undefined }): JSX.Element {
  return <section className="panel run-panel"><div className="run-header"><div><div className="eyebrow">RUN CONSOLE</div><h2>{run.runId}</h2></div><div className="status-chip" data-status={run.status}>{run.status}</div></div><div className="run-metrics"><div><span>queue</span><strong>{run.scheduler.queuePosition ?? '—'}</strong></div><div><span>active</span><strong>{run.scheduler.activeRunCount}</strong></div><div><span>lease</span><strong>{run.scheduler.workspaceLease ?? '—'}</strong></div><div><span>events</span><strong>{run.lastEventSeq}</strong></div></div><pre className="output-view">{run.output || '等待模型输出…'}</pre><div className="event-list">{events.map((event) => <div className="event-row" key={`${event.runId}-${event.seq}`}><span>{event.seq}</span><span>{event.type}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div>)}</div>{!['completed', 'failed', 'cancelled', 'timed-out'].includes(run.status) && <button className="cancel-button" type="button" onClick={onCancel}>请求取消</button>}</section>;
}
