import { describe, expect, it } from 'vitest';
import { applyLocaleToDocument, createTranslator, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, loadLocale, localeFromLanguage, messageKeys, resetLocale, resolveLocale, saveLocale, type LocaleStorage } from './locale.js';

function storage(initial: Record<string, string> = {}): LocaleStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

describe('Web locale adapter', () => {
  it('accepts only the bounded supported locales and falls back safely', () => {
    expect(resolveLocale('zh-CN')).toBe('zh-CN');
    expect(resolveLocale('fr-FR')).toBe(DEFAULT_LOCALE);
    expect(localeFromLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(localeFromLanguage('en-US')).toBe(DEFAULT_LOCALE);
  });

  it('prefers an explicit stored locale and rejects oversized or secret-shaped values', () => {
    const preferred = storage({ [LOCALE_STORAGE_KEY]: 'zh-CN' });
    expect(loadLocale(preferred, 'en-US')).toBe('zh-CN');
    const invalid = storage({ [LOCALE_STORAGE_KEY]: 'apiKey=secret' });
    expect(loadLocale(invalid, 'zh-CN')).toBe('zh-CN');
    const oversized = storage({ [LOCALE_STORAGE_KEY]: 'zh-CN'.repeat(20) });
    expect(loadLocale(oversized, 'en-US')).toBe('en-US');
  });

  it('persists only the versioned locale value and can reset it', () => {
    const target = storage();
    saveLocale('zh-CN', target);
    expect(target.values.get(LOCALE_STORAGE_KEY)).toBe('zh-CN');
    expect(JSON.stringify(target.values)).not.toMatch(/api[_-]?key|token|secret/iu);
    resetLocale(target);
    expect(target.values.has(LOCALE_STORAGE_KEY)).toBe(false);
  });

  it('returns translated values and stable English fallback without exposing message keys', () => {
    const translate = createTranslator('zh-CN');
    expect(translate('nav.newTask')).toBe('＋ 新任务');
    expect(translate('conversation.startRun')).toBe('开始运行');
    expect(translate('settings.modelProvider')).toBe('模型提供方');
    expect(translate('guardrails.untrusted')).toBe('不可信任务强制使用外部沙箱');
    expect(translate('locale.english')).toBe('English');
    expect(translate('nav.newTask')).not.toContain('nav.newTask');
    expect((translate as (key: string) => string)('missing.message')).toBe('Unavailable');
  });

  it('updates only the document language and does not carry execution state', () => {
    const target = { documentElement: { lang: '' } } as Pick<Document, 'documentElement'>;
    applyLocaleToDocument('zh-CN', target);
    expect(target.documentElement.lang).toBe('zh-CN');
    applyLocaleToDocument('en-US', target);
    expect(target.documentElement.lang).toBe('en-US');
  });

  it('interpolates named params and leaves unknown placeholders intact', () => {
    const translate = createTranslator('zh-CN');
    expect(translate('error.requestFailedWithCode', { code: 'RUN_FAILED' })).toBe('请求失败：RUN_FAILED');
    expect(translate('snapshot.blocked', { reason: 'policy-denied' })).toBe('原因：policy-denied。daemon 不会静默放宽本次运行。');
    expect(createTranslator('en-US')('error.requestFailedWithCode', { code: 'PAIRING_EXPIRED' })).toBe('Request failed: PAIRING_EXPIRED');
    expect(translate('error.requestFailedWithCode')).toBe('请求失败：{code}');
  });

  it('resolves every catalog key in both locales without falling back to the placeholder', () => {
    for (const key of messageKeys()) {
      expect(createTranslator('en-US')(key)).not.toBe('Unavailable');
      expect(createTranslator('zh-CN')(key)).not.toBe('Unavailable');
    }
  });

  it('keeps Chinese copy out of the English catalog for the main flow', () => {
    const translate = createTranslator('en-US');
    for (const key of messageKeys()) {
      if (key === 'locale.chinese') continue; // language names stay in their own script
      expect(translate(key)).not.toMatch(/[\u4e00-\u9fff]/u);
    }
  });
});
