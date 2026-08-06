import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetupWizard, type SetupWizardCopy } from './SetupWizard.js';

const copy: SetupWizardCopy = {
  title: 'Set up VibeGo',
  stepProvider: 'Model',
  stepWorkspace: 'Workspace',
  stepDone: 'Done',
  providerTitle: 'Connect a model provider',
  providerDescription: 'The key goes to the daemon once.',
  endpointProfile: 'Endpoint profile',
  endpoint: 'Endpoint',
  model: 'Model',
  apiKey: 'API key',
  probe: 'Probe',
  saveAndContinue: 'Save and continue',
  continueLabel: 'Continue',
  skip: 'Skip for now',
  workspaceTitle: 'Choose a workspace',
  workspaceDescription: 'Runs stay inside this folder.',
  doneTitle: 'All set',
  doneDescription: 'Model and workspace are configured.',
  startTask: 'Start first task',
  close: 'Close setup',
};

describe('SetupWizard', () => {
  it('renders the provider step with stepper and copy-driven labels when open', () => {
    const html = renderToStaticMarkup(<SetupWizard open activeWorkspaceId="default" copy={copy} onConfigureDeepSeek={() => undefined} onSelectWorkspace={() => undefined} onClose={() => undefined} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Set up VibeGo');
    expect(html).toContain('data-active="true"');
    expect(html).toContain('Connect a model provider');
    expect(html).toContain('type="password"');
    expect(html).toContain('Save and continue');
    expect(html).not.toMatch(/sk-[a-z0-9]{10,}/iu);
  });

  it('renders nothing while closed and keeps the key out of markup', () => {
    const html = renderToStaticMarkup(<SetupWizard open={false} activeWorkspaceId="default" copy={copy} onConfigureDeepSeek={() => undefined} onSelectWorkspace={() => undefined} onClose={() => undefined} />);
    expect(html).toBe('');
  });
});
