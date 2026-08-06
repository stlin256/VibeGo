import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationHeader, type ConversationHeaderCopy } from './ConversationHeader.js';

const copy: ConversationHeaderCopy = {
  brandName: 'VibeGo',
  brandPrefix: 'Vibe',
  brandSuffix: 'Go',
  newTask: '＋ New task',
  hideDetails: 'Hide details',
  showDetails: 'Details',
  settings: '⚙ Settings',
  localeLabel: 'Language',
  localeEnglish: 'English',
  localeChinese: '简体中文',
  themeToggle: 'Toggle theme',
  themeLight: 'Light',
  themeDark: 'Dark',
  connected: 'Connected',
  awaitingPairing: 'Awaiting pairing',
};

describe('ConversationHeader', () => {
  it('renders the connected brand, actions, locale control and context state through typed props', () => {
    const html = renderToStaticMarkup(<ConversationHeader connected contextOpen settingsOpen locale="en-US" theme="light" copy={copy} onNewTask={() => undefined} onToggleContext={() => undefined} onOpenSettings={() => undefined} onLocaleChange={() => undefined} onToggleTheme={() => undefined} />);
    expect(html).toContain('class="topbar"');
    expect(html).toContain('alt="VibeGo"');
    expect(html).toContain('Vibe<span class="brand-go">Go</span>');
    expect(html).toContain('aria-label="Hide details"');
    expect(html).toContain('aria-controls="settings-drawer"');
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('aria-label="Toggle theme"');
    expect(html).toContain('title="Dark"');
    expect(html).toContain('☾');
    expect(html).toContain('data-connected="true"');
    expect(html).toContain('Connected');
    expect(html).toContain('ui-button');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users\\|\/home\//iu);
  });

  it('keeps awaiting-pairing status and details action explicit without server data', () => {
    const html = renderToStaticMarkup(<ConversationHeader connected={false} contextOpen={false} settingsOpen={false} locale="zh-CN" theme="dark" copy={copy} onNewTask={() => undefined} onToggleContext={() => undefined} onOpenSettings={() => undefined} />);
    // The review-panel toggle is only offered once connected.
    expect(html).not.toContain('context-toggle');
    expect(html).toContain('title="Light"');
    expect(html).toContain('☀');
    expect(html).toContain('data-connected="false"');
    expect(html).toContain('Awaiting pairing');
    expect(html).toContain('value="zh-CN"');
    expect(html).not.toContain('raw event');
    expect(html).not.toMatch(/sk-[a-z0-9]{20,}/iu);
  });
});
