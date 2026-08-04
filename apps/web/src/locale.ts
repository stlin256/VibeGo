export type Locale = 'en-US' | 'zh-CN';

export const DEFAULT_LOCALE: Locale = 'en-US';
export const LOCALE_STORAGE_KEY = 'vibego.locale.v1';
const MAX_STORED_LOCALE_BYTES = 32;

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type MessageKey =
  | 'brand.name'
  | 'nav.newTask'
  | 'nav.hideDetails'
  | 'nav.showDetails'
  | 'nav.settings'
  | 'nav.localSession'
  | 'nav.currentTask'
  | 'nav.noOtherRuns'
  | 'connection.connected'
  | 'connection.awaitingPairing'
  | 'settings.title'
  | 'settings.close'
  | 'settings.description'
  | 'connection.workspaceTitle'
  | 'connection.pairingTitle'
  | 'connection.pairingDescription'
  | 'connection.pairingAction'
  | 'conversation.title'
  | 'conversation.hint'
  | 'conversation.newMessage'
  | 'conversation.inputLabel'
  | 'conversation.inputPlaceholder'
  | 'conversation.startRun'
  | 'conversation.readyTitle'
  | 'conversation.readyDescription'
  | 'locale.label'
  | 'locale.english'
  | 'locale.chinese'
  | 'accessibility.statusLabel';

type Catalog = Readonly<Record<MessageKey, string>>;

const EN_US: Catalog = {
  'brand.name': 'VibeGo',
  'nav.newTask': '＋ New task',
  'nav.hideDetails': 'Hide details',
  'nav.showDetails': 'Details',
  'nav.settings': '⚙ Settings',
  'nav.localSession': 'Local session',
  'nav.currentTask': 'Current task',
  'nav.noOtherRuns': 'No other runs',
  'connection.connected': 'Connected',
  'connection.awaitingPairing': 'Awaiting pairing',
  'settings.title': 'Run profile',
  'settings.close': 'Close settings',
  'settings.description': 'Configure this run from the console; no config file editing is required.',
  'connection.workspaceTitle': 'Connect your local workspace',
  'connection.pairingTitle': 'Enter one-time pairing code',
  'connection.pairingDescription': 'After pairing, the token stays only in this page.',
  'connection.pairingAction': 'Connect daemon',
  'conversation.title': 'What should the agent do next?',
  'conversation.hint': 'One task at a time · local workspace',
  'conversation.newMessage': 'NEW MESSAGE',
  'conversation.inputLabel': 'Task input',
  'conversation.inputPlaceholder': 'Ask for a change, a test run, or an explanation…',
  'conversation.startRun': 'Start run',
  'conversation.readyTitle': 'Ready for your next task',
  'conversation.readyDescription': 'Describe a change, test, or explanation below. The agent’s plan, output, approvals, and recovery stay in this conversation.',
  'locale.label': 'Language',
  'locale.english': 'English',
  'locale.chinese': '简体中文',
  'accessibility.statusLabel': 'Live status',
};

const ZH_CN: Catalog = {
  ...EN_US,
  'nav.newTask': '＋ 新任务',
  'nav.hideDetails': '隐藏详情',
  'nav.showDetails': '详情',
  'nav.settings': '⚙ 设置',
  'nav.localSession': '本地会话',
  'nav.currentTask': '当前任务',
  'nav.noOtherRuns': '暂无其他运行',
  'connection.connected': '已连接',
  'connection.awaitingPairing': '等待配对',
  'settings.title': '运行配置',
  'settings.close': '关闭设置',
  'settings.description': '直接在控制台配置本次运行，无需编辑配置文件。',
  'connection.workspaceTitle': '连接你的本地工作区',
  'connection.pairingTitle': '输入一次性配对码',
  'connection.pairingDescription': '配对完成后 token 只保存在当前页面内。',
  'connection.pairingAction': '连接 daemon',
  'conversation.title': '接下来让 agent 做什么？',
  'conversation.hint': '一次处理一个任务 · 本地工作区',
  'conversation.newMessage': '新消息',
  'conversation.inputLabel': '任务输入',
  'conversation.inputPlaceholder': '描述要修改的内容、测试或需要解释的问题…',
  'conversation.startRun': '开始运行',
  'conversation.readyTitle': '准备好处理下一个任务',
  'conversation.readyDescription': '在下方描述修改、测试或解释需求。agent 的计划、输出、审批和恢复信息都会留在当前对话中。',
  'locale.label': '语言',
  'accessibility.statusLabel': '实时状态',
};

const CATALOGS: Record<Locale, Catalog> = { 'en-US': EN_US, 'zh-CN': ZH_CN };

export function isLocale(value: unknown): value is Locale {
  return value === 'en-US' || value === 'zh-CN';
}

export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function localeFromLanguage(language: unknown): Locale {
  return typeof language === 'string' && language.toLowerCase().startsWith('zh') ? 'zh-CN' : DEFAULT_LOCALE;
}

export function createTranslator(locale: Locale): (key: MessageKey) => string {
  const selected = CATALOGS[resolveLocale(locale)];
  return (key: MessageKey): string => selected[key] ?? EN_US[key] ?? 'Unavailable';
}

export function loadLocale(storage: LocaleStorage | undefined = browserStorage(), language: unknown = browserLanguage()): Locale {
  if (storage) {
    try {
      const raw = storage.getItem(LOCALE_STORAGE_KEY);
      if (raw !== null && new TextEncoder().encode(raw).byteLength <= MAX_STORED_LOCALE_BYTES) {
        if (isLocale(raw)) return raw;
      }
    } catch { /* disabled storage falls back to browser language */ }
  }
  return localeFromLanguage(language);
}

export function saveLocale(locale: Locale, storage: LocaleStorage | undefined = browserStorage()): void {
  if (!storage) return;
  try { storage.setItem(LOCALE_STORAGE_KEY, resolveLocale(locale)); } catch { /* best effort; UI remains usable */ }
}

export function resetLocale(storage: LocaleStorage | undefined = browserStorage()): void {
  try { storage?.removeItem(LOCALE_STORAGE_KEY); } catch { /* best effort */ }
}

export function applyLocaleToDocument(locale: Locale, target: Pick<Document, 'documentElement'> | undefined = browserDocument()): void {
  if (target?.documentElement) target.documentElement.lang = resolveLocale(locale);
}

function browserStorage(): LocaleStorage | undefined {
  try { return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage; } catch { return undefined; }
}

function browserLanguage(): string | undefined {
  try { return typeof navigator === 'undefined' ? undefined : navigator.language; } catch { return undefined; }
}

function browserDocument(): Pick<Document, 'documentElement'> | undefined {
  try { return typeof document === 'undefined' ? undefined : document; } catch { return undefined; }
}
