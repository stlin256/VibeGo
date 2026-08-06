import { useState, type FormEvent, type JSX } from 'react';
import type { DeepSeekProbeResult, DeepSeekSettingsInput, ModelSettingsInput, WorkspaceRegistryStatus } from '../../api.js';
import { Button } from '../ui/index.js';

export interface SetupWizardCopy {
  readonly title: string;
  readonly stepProvider: string;
  readonly stepWorkspace: string;
  readonly stepDone: string;
  readonly providerTitle: string;
  readonly providerDescription: string;
  readonly providerPickerAriaLabel: string;
  readonly providerDeepSeekLabel: string;
  readonly providerDeepSeekDescription: string;
  readonly providerRecommendedBadge: string;
  readonly providerCustomLabel: string;
  readonly providerCustomDescription: string;
  readonly endpointProfile: string;
  readonly endpoint: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly probe: string;
  readonly saveAndContinue: string;
  readonly continueLabel: string;
  readonly skip: string;
  readonly workspaceTitle: string;
  readonly workspaceDescription: string;
  readonly doneTitle: string;
  readonly doneDescription: string;
  readonly startTask: string;
  readonly close: string;
}

export interface SetupWizardProps {
  readonly open: boolean;
  readonly workspaces?: WorkspaceRegistryStatus | undefined;
  readonly activeWorkspaceId: string;
  readonly deepSeekProbe?: DeepSeekProbeResult | undefined;
  readonly copy: SetupWizardCopy;
  readonly onConfigureDeepSeek: (input: DeepSeekSettingsInput) => Promise<void> | void;
  readonly onConfigureModel?: ((input: ModelSettingsInput) => Promise<void> | void) | undefined;
  readonly onProbeDeepSeek?: (() => Promise<void> | void) | undefined;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onClose: () => void;
}

type WizardStep = 0 | 1 | 2;
type ProviderChoice = 'deepseek' | 'openai-compatible';

const ENDPOINT_BY_PROFILE: Record<DeepSeekSettingsInput['endpointProfile'], string> = {
  'openai-chat-completions': 'https://api.deepseek.com/v1/chat/completions',
  'openai-responses': 'https://api.deepseek.com/v1/responses',
  'anthropic-messages': 'https://api.deepseek.com/anthropic/v1/messages',
};

/** First-run setup: pick a provider preset (DeepSeek deep adaptation or any OpenAI-compatible endpoint), then workspace, then done. All authority stays in the App callbacks; the key transits once and is never kept in wizard state after save. */
export function SetupWizard({ open, workspaces, activeWorkspaceId, deepSeekProbe, copy, onConfigureDeepSeek, onConfigureModel, onProbeDeepSeek, onSelectWorkspace, onClose }: SetupWizardProps): JSX.Element | null {
  const [step, setStep] = useState<WizardStep>(0);
  const [provider, setProvider] = useState<ProviderChoice>('deepseek');
  const [endpointProfile, setEndpointProfile] = useState<DeepSeekSettingsInput['endpointProfile']>('openai-chat-completions');
  const [endpoint, setEndpoint] = useState(ENDPOINT_BY_PROFILE['openai-chat-completions']);
  const [model, setModel] = useState('deepseek-v4-flash');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const steps = [copy.stepProvider, copy.stepWorkspace, copy.stepDone];
  const customAvailable = Boolean(onConfigureModel);

  const submitProvider = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      if (provider === 'deepseek') {
        await onConfigureDeepSeek({
          endpointProfile,
          endpoint,
          model,
          apiKey,
          thinkingMode: 'auto',
          toolCalling: 'enabled',
          webSearch: 'off',
          reviewer: 'off',
        });
      } else if (onConfigureModel) {
        await onConfigureModel({ provider: 'openai-compatible', baseUrl, apiKey, model });
      }
      setApiKey('');
      setSaved(true);
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = provider === 'deepseek'
    ? Boolean(apiKey.trim() && endpoint.trim() && model.trim())
    : customAvailable && Boolean(apiKey.trim() && baseUrl.trim() && model.trim());

  return (
    <div className="setup-wizard-backdrop">
      <div className="setup-wizard" role="dialog" aria-modal="true" aria-label={copy.title}>
        <header className="setup-wizard-header">
          <h2>{copy.title}</h2>
          <Button variant="ghost" size="icon" aria-label={copy.close} onClick={onClose}>×</Button>
        </header>
        <ol className="setup-steps">
          {steps.map((label, index) => (
            <li key={label} className="setup-step" data-index={index + 1} data-active={step === index} data-complete={step > index}>{label}</li>
          ))}
        </ol>
        {step === 0 && (
          <form className="setup-wizard-body" onSubmit={(event) => { void submitProvider(event); }}>
            <h3>{copy.providerTitle}</h3>
            <p className="muted">{copy.providerDescription}</p>
            <div className="setup-provider-grid" role="radiogroup" aria-label={copy.providerPickerAriaLabel}>
              <button type="button" className="setup-provider-card" data-selected={provider === 'deepseek' ? 'true' : 'false'} role="radio" aria-checked={provider === 'deepseek'} disabled={busy} onClick={() => setProvider('deepseek')}>
                <span className="setup-provider-card-heading"><strong>{copy.providerDeepSeekLabel}</strong><span className="permission-safe-badge">{copy.providerRecommendedBadge}</span></span>
                <span>{copy.providerDeepSeekDescription}</span>
              </button>
              <button type="button" className="setup-provider-card" data-selected={provider === 'openai-compatible' ? 'true' : 'false'} role="radio" aria-checked={provider === 'openai-compatible'} disabled={busy || !customAvailable} onClick={() => setProvider('openai-compatible')}>
                <span className="setup-provider-card-heading"><strong>{copy.providerCustomLabel}</strong></span>
                <span>{copy.providerCustomDescription}</span>
              </button>
            </div>
            {provider === 'deepseek' ? (
              <>
                <label>{copy.endpointProfile}
                  <select value={endpointProfile} disabled={busy} onChange={(event) => { const next = event.target.value as DeepSeekSettingsInput['endpointProfile']; setEndpointProfile(next); setEndpoint(ENDPOINT_BY_PROFILE[next]); }}>
                    <option value="openai-chat-completions">OpenAI Chat Completions</option>
                    <option value="openai-responses">OpenAI Responses</option>
                    <option value="anthropic-messages">Anthropic Messages</option>
                  </select>
                </label>
                <label>{copy.endpoint}<input type="url" value={endpoint} disabled={busy} onChange={(event) => setEndpoint(event.target.value)} autoComplete="url" /></label>
                <label>{copy.model}<input value={model} disabled={busy} onChange={(event) => setModel(event.target.value)} autoComplete="off" /></label>
                <label>{copy.apiKey}<input type="password" value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" /></label>
              </>
            ) : (
              <>
                <label>{copy.baseUrl}<input type="url" value={baseUrl} disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com" autoComplete="url" /></label>
                <label>{copy.model}<input value={model} disabled={busy} onChange={(event) => setModel(event.target.value)} autoComplete="off" /></label>
                <label>{copy.apiKey}<input type="password" value={apiKey} disabled={busy} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" /></label>
              </>
            )}
            {(deepSeekProbe || saved) && provider === 'deepseek' && <p className="muted" role="status">{deepSeekProbe ? `Probe: ${deepSeekProbe.status} · ${deepSeekProbe.errorCode ?? `latency ${deepSeekProbe.latencyMs ?? 'n/a'} ms`}` : ''}</p>}
            <div className="setup-wizard-actions">
              <Button variant="ghost" type="button" onClick={onClose}>{copy.skip}</Button>
              <span className="setup-wizard-action-group">
                {saved && provider === 'deepseek' && onProbeDeepSeek && <Button variant="outline" type="button" disabled={busy} onClick={() => { void onProbeDeepSeek(); }}>{copy.probe}</Button>}
                <Button type="submit" disabled={busy || !canSubmit}>{copy.saveAndContinue}</Button>
              </span>
            </div>
          </form>
        )}
        {step === 1 && (
          <div className="setup-wizard-body">
            <h3>{copy.workspaceTitle}</h3>
            <p className="muted">{copy.workspaceDescription}</p>
            <div className="setup-workspace-list" role="radiogroup" aria-label={copy.workspaceTitle}>
              {(workspaces?.workspaces ?? []).map((workspace) => (
                <label key={workspace.id} className="setup-workspace-option" data-selected={workspace.id === activeWorkspaceId}>
                  <input type="radio" name="setup-workspace" checked={workspace.id === activeWorkspaceId} onChange={() => onSelectWorkspace(workspace.id)} />
                  <span><strong>{workspace.label}</strong><span className="muted setup-workspace-path">{workspace.id}{workspace.isDefault ? ' · default' : ''}</span></span>
                </label>
              ))}
            </div>
            <div className="setup-wizard-actions">
              <span />
              <Button onClick={() => setStep(2)}>{copy.continueLabel}</Button>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="setup-wizard-body">
            <h3>{copy.doneTitle}</h3>
            <p className="muted">{copy.doneDescription}</p>
            <div className="setup-wizard-actions">
              <span />
              <Button onClick={onClose}>{copy.startTask}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
