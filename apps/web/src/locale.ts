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
  | 'rail.goals'
  | 'rail.telemetry'
  | 'rail.workspace'
  | 'connection.connected'
  | 'connection.awaitingPairing'
  | 'settings.title'
  | 'settings.eyebrow'
  | 'settings.close'
  | 'settings.description'
  | 'settings.workspaces'
  | 'settings.workspaceSetup'
  | 'settings.workspace'
  | 'settings.modelProvider'
  | 'settings.modelName'
  | 'settings.modelAccess'
  | 'settings.providerUrl'
  | 'settings.apiKey'
  | 'settings.saveProvider'
  | 'settings.clearDaemonKey'
  | 'settings.modelListEndpoint'
  | 'settings.probeModels'
  | 'settings.taskTrust'
  | 'settings.sandbox'
  | 'settings.network'
  | 'settings.approval'
  | 'settings.maxTurns'
  | 'settings.wallTime'
  | 'settings.modelInputTokens'
  | 'settings.modelOutputTokens'
  | 'settings.maxToolCalls'
  | 'settings.maxOutputBytes'
  | 'settings.maxContextBytes'
  | 'settings.resetDefaults'
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
  | 'guardrails.title'
  | 'guardrails.untrusted'
  | 'guardrails.approval'
  | 'guardrails.sse'
  | 'locale.label'
  | 'locale.english'
  | 'locale.chinese'
  | 'theme.toggle'
  | 'theme.light'
  | 'theme.dark'
  | 'error.requestFailed'
  | 'error.requestFailedWithCode'
  | 'connection.eyebrow'
  | 'connection.tagline'
  | 'connection.readingDaemon'
  | 'connection.pairingEyebrow'
  | 'connection.pairingCodeLabel'
  | 'empty.pairingTitle'
  | 'empty.pairingDescription'
  | 'conversation.untrustedPolicy'
  | 'conversation.trustedPolicy'
  | 'shell.conversationEyebrow'
  | 'shell.conversationStream'
  | 'shell.conversationTimeline'
  | 'shell.runConsole'
  | 'shell.waitingOutput'
  | 'shell.cancelRun'
  | 'shell.timeline'
  | 'shell.queue'
  | 'shell.active'
  | 'shell.lease'
  | 'shell.events'
  | 'workspace.navigationLabel'
  | 'workspace.eyebrow'
  | 'workspace.recent'
  | 'settings.tabsAriaLabel'
  | 'settings.tabRun'
  | 'settings.tabTools'
  | 'settings.tabAccess'
  | 'rail.contextAriaLabel'
  | 'rail.connectionTitle'
  | 'accessibility.sidebarLabel'
  | 'recovery.eyebrow'
  | 'recovery.title'
  | 'recovery.description'
  | 'recovery.action'
  | 'approval.eyebrow'
  | 'approval.meta'
  | 'approval.sandboxLabel'
  | 'approval.networkLabel'
  | 'approval.imageLabel'
  | 'approval.allowOnce'
  | 'approval.allowAriaLabel'
  | 'approval.deny'
  | 'approval.sessionNote'
  | 'approval.review.reviewed.label'
  | 'approval.review.asked.label'
  | 'approval.review.denied.label'
  | 'approval.review.unavailable.label'
  | 'approval.review.reviewed.description'
  | 'approval.review.asked.description'
  | 'approval.review.denied.description'
  | 'approval.review.unavailable.description'
  | 'snapshot.eyebrow'
  | 'snapshot.title'
  | 'snapshot.ariaLabel'
  | 'snapshot.requested'
  | 'snapshot.effective'
  | 'snapshot.profileRevision'
  | 'snapshot.policyRevision'
  | 'snapshot.scopeLabel'
  | 'snapshot.blocked'
  | 'snapshot.grantExpiry'
  | 'snapshot.active'
  | 'snapshot.blockedChip'
  | 'reviewer.eyebrow'
  | 'reviewer.off'
  | 'reviewer.frozen'
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
  'rail.goals': 'Goals',
  'rail.telemetry': 'Telemetry',
  'rail.workspace': 'Workspace',
  'connection.connected': 'Connected',
  'connection.awaitingPairing': 'Awaiting pairing',
  'settings.title': 'Run profile',
  'settings.eyebrow': 'SETTINGS',
  'settings.close': 'Close settings',
  'settings.description': 'Configure this run from the console; no config file editing is required.',
  'settings.workspaces': 'WORKSPACES',
  'settings.workspaceSetup': 'Workspace setup',
  'settings.workspace': 'Workspace',
  'settings.modelProvider': 'Model provider',
  'settings.modelName': 'Model name',
  'settings.modelAccess': 'MODEL ACCESS',
  'settings.providerUrl': 'Provider URL',
  'settings.apiKey': 'API key',
  'settings.saveProvider': 'Save provider',
  'settings.clearDaemonKey': 'Clear daemon key',
  'settings.modelListEndpoint': 'Model list endpoint',
  'settings.probeModels': 'Probe models',
  'settings.taskTrust': 'Task trust',
  'settings.sandbox': 'Sandbox',
  'settings.network': 'Network',
  'settings.approval': 'Approval',
  'settings.maxTurns': 'Max turns',
  'settings.wallTime': 'Wall time (ms)',
  'settings.modelInputTokens': 'Model input tokens',
  'settings.modelOutputTokens': 'Model output tokens',
  'settings.maxToolCalls': 'Max tool calls',
  'settings.maxOutputBytes': 'Max output bytes',
  'settings.maxContextBytes': 'Max context bytes',
  'settings.resetDefaults': 'Reset conservative defaults',
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
  'guardrails.title': 'GUARDRAILS',
  'guardrails.untrusted': 'Untrusted tasks require an external sandbox',
  'guardrails.approval': 'Writes and commands request approval by policy',
  'guardrails.sse': 'Event streams resume from their sequence number',
  'locale.label': 'Language',
  'locale.english': 'English',
  'locale.chinese': '简体中文',
  'theme.toggle': 'Toggle theme',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'error.requestFailed': 'Request failed. Check the daemon connection.',
  'error.requestFailedWithCode': 'Request failed: {code}',
  'connection.eyebrow': 'CONNECTION',
  'connection.tagline': 'Vibe coding anywhere — bounded execution, resumable progress.',
  'connection.readingDaemon': 'Reading daemon status…',
  'connection.pairingEyebrow': 'PAIRING',
  'connection.pairingCodeLabel': 'Pairing code',
  'empty.pairingTitle': 'Complete secure pairing first',
  'empty.pairingDescription': 'The daemon never puts tokens in the URL, cookies, or local storage.',
  'conversation.untrustedPolicy': 'untrusted content · external sandbox',
  'conversation.trustedPolicy': 'trusted workspace · read-only',
  'shell.conversationEyebrow': 'CONVERSATION',
  'shell.conversationStream': 'Conversation stream',
  'shell.conversationTimeline': 'Conversation and run timeline',
  'shell.runConsole': 'RUN CONSOLE',
  'shell.waitingOutput': 'Waiting for model output…',
  'shell.cancelRun': 'Request cancel',
  'shell.timeline': 'Run timeline',
  'shell.queue': 'queue',
  'shell.active': 'active',
  'shell.lease': 'lease',
  'shell.events': 'events',
  'workspace.navigationLabel': 'Workspace navigation',
  'workspace.eyebrow': 'WORKSPACE',
  'workspace.recent': 'RECENT',
  'settings.tabsAriaLabel': 'Settings sections',
  'settings.tabRun': 'Run',
  'settings.tabTools': 'Tools',
  'settings.tabAccess': 'Access',
  'rail.contextAriaLabel': 'Run context',
  'rail.connectionTitle': 'Connected workspace',
  'accessibility.sidebarLabel': 'Connection and run summary',
  'recovery.eyebrow': 'RECOVERY REQUIRED',
  'recovery.title': 'This run stopped safely after a daemon restart.',
  'recovery.description': 'Retry creates a new run from the original safety policy; interrupted tool calls are never replayed.',
  'recovery.action': 'Retry as new run',
  'approval.eyebrow': 'APPROVAL REQUIRED',
  'approval.meta': '{risk} · {bytes} bytes · expires {time}',
  'approval.sandboxLabel': 'sandbox',
  'approval.networkLabel': 'network',
  'approval.imageLabel': 'image',
  'approval.allowOnce': 'Allow once',
  'approval.allowAriaLabel': 'Allow this approval once',
  'approval.deny': 'Deny',
  'approval.sessionNote': 'Session-wide grants are managed in Permission settings.',
  'approval.review.reviewed.label': 'REVIEWED',
  'approval.review.asked.label': 'ASKED',
  'approval.review.denied.label': 'DENIED',
  'approval.review.unavailable.label': 'REVIEW UNAVAILABLE',
  'approval.review.reviewed.description': 'The bounded reviewer matched this exact low-risk key; the daemon policy still controls the one-time action.',
  'approval.review.asked.description': 'The reviewer kept this request on the user approval path.',
  'approval.review.denied.description': 'The reviewer denied this request; no capability is widened.',
  'approval.review.unavailable.description': 'The review could not complete; the normal deterministic approval gate remains active.',
  'snapshot.eyebrow': 'PERMISSION SNAPSHOT',
  'snapshot.title': 'Frozen for this run',
  'snapshot.ariaLabel': 'Frozen permission snapshot',
  'snapshot.requested': 'requested',
  'snapshot.effective': 'effective',
  'snapshot.profileRevision': 'profile revision',
  'snapshot.policyRevision': 'policy revision',
  'snapshot.scopeLabel': 'Scope',
  'snapshot.blocked': 'Reason: {reason}. The daemon will not silently widen this run.',
  'snapshot.grantExpiry': 'Session grant expiry',
  'snapshot.active': 'active',
  'snapshot.blockedChip': 'blocked',
  'reviewer.eyebrow': 'APPROVAL REVIEW SNAPSHOT',
  'reviewer.off': 'off',
  'reviewer.frozen': 'revision {rev} · policy {policy} · frozen for this run',
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
  'rail.goals': '目标',
  'rail.telemetry': '遥测',
  'rail.workspace': '工作区',
  'connection.connected': '已连接',
  'connection.awaitingPairing': '等待配对',
  'settings.title': '运行配置',
  'settings.eyebrow': '设置',
  'settings.close': '关闭设置',
  'settings.description': '直接在控制台配置本次运行，无需编辑配置文件。',
  'settings.workspaces': '工作区',
  'settings.workspaceSetup': '工作区设置',
  'settings.workspace': '工作区',
  'settings.modelProvider': '模型提供方',
  'settings.modelName': '模型名称',
  'settings.modelAccess': '模型访问',
  'settings.providerUrl': '提供方 URL',
  'settings.apiKey': 'API key',
  'settings.saveProvider': '保存提供方',
  'settings.clearDaemonKey': '清除 daemon key',
  'settings.modelListEndpoint': '模型列表 endpoint',
  'settings.probeModels': '探测模型',
  'settings.taskTrust': '任务信任级别',
  'settings.sandbox': '沙箱',
  'settings.network': '网络',
  'settings.approval': '审批',
  'settings.maxTurns': '最大轮数',
  'settings.wallTime': '最长时间（毫秒）',
  'settings.modelInputTokens': '模型输入 token',
  'settings.modelOutputTokens': '模型输出 token',
  'settings.maxToolCalls': '最大工具调用数',
  'settings.maxOutputBytes': '最大输出字节数',
  'settings.maxContextBytes': '最大上下文字节数',
  'settings.resetDefaults': '恢复保守默认值',
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
  'guardrails.title': '安全边界',
  'guardrails.untrusted': '不可信任务强制使用外部沙箱',
  'guardrails.approval': '写入与命令按策略请求审批',
  'guardrails.sse': '事件流可按序号断线续传',
  'locale.label': '语言',
  'theme.toggle': '切换主题',
  'theme.light': '亮色',
  'theme.dark': '暗色',
  'error.requestFailed': '请求失败，请检查 daemon 连接。',
  'error.requestFailedWithCode': '请求失败：{code}',
  'connection.eyebrow': '连接',
  'connection.tagline': 'Vibe Coding，随时随地；执行有边界，进度可继续。',
  'connection.readingDaemon': '正在读取 daemon 状态…',
  'connection.pairingEyebrow': '配对',
  'connection.pairingCodeLabel': '配对码',
  'empty.pairingTitle': '先完成安全配对',
  'empty.pairingDescription': 'daemon 默认不会把 token 放进 URL、cookie 或本地存储。',
  'conversation.untrustedPolicy': '不可信内容 · 外部沙箱',
  'conversation.trustedPolicy': '受信工作区 · 只读',
  'shell.conversationEyebrow': '对话',
  'shell.conversationStream': '对话流',
  'shell.conversationTimeline': '对话与运行时间线',
  'shell.runConsole': '运行控制台',
  'shell.waitingOutput': '等待模型输出…',
  'shell.cancelRun': '请求取消',
  'shell.timeline': '运行时间线',
  'shell.queue': '队列',
  'shell.active': '活跃',
  'shell.lease': '租约',
  'shell.events': '事件',
  'workspace.navigationLabel': '工作区导航',
  'workspace.eyebrow': '工作区',
  'workspace.recent': '最近',
  'settings.tabsAriaLabel': '设置分区',
  'settings.tabRun': '运行',
  'settings.tabTools': '工具',
  'settings.tabAccess': '访问',
  'rail.contextAriaLabel': '运行上下文',
  'rail.connectionTitle': '已连接的工作区',
  'accessibility.sidebarLabel': '连接与运行摘要',
  'recovery.eyebrow': '需要恢复',
  'recovery.title': 'daemon 重启后，本次运行已安全停止。',
  'recovery.description': '重试会按原始安全策略创建新运行；被中断的工具调用绝不会重放。',
  'recovery.action': '以新运行重试',
  'approval.eyebrow': '需要审批',
  'approval.meta': '{risk} · {bytes} 字节 · 到期时间 {time}',
  'approval.sandboxLabel': '沙箱',
  'approval.networkLabel': '网络',
  'approval.imageLabel': '镜像',
  'approval.allowOnce': '允许一次',
  'approval.allowAriaLabel': '仅允许本次审批',
  'approval.deny': '拒绝',
  'approval.sessionNote': '会话级授权在权限设置中管理。',
  'approval.review.reviewed.label': '已评审',
  'approval.review.asked.label': '转人工',
  'approval.review.denied.label': '已拒绝',
  'approval.review.unavailable.label': '评审不可用',
  'approval.review.reviewed.description': '有界评审器命中了这条低风险的精确键；一次性动作仍由 daemon 策略控制。',
  'approval.review.asked.description': '评审器将该请求保留在用户审批路径上。',
  'approval.review.denied.description': '评审器拒绝了该请求；未扩大任何能力。',
  'approval.review.unavailable.description': '评审未能完成；常规的确定性审批门禁仍然生效。',
  'snapshot.eyebrow': '权限快照',
  'snapshot.title': '本次运行已冻结',
  'snapshot.ariaLabel': '冻结的权限快照',
  'snapshot.requested': '请求',
  'snapshot.effective': '生效',
  'snapshot.profileRevision': '档案版本',
  'snapshot.policyRevision': '策略版本',
  'snapshot.scopeLabel': '作用域',
  'snapshot.blocked': '原因：{reason}。daemon 不会静默放宽本次运行。',
  'snapshot.grantExpiry': '会话授权到期',
  'snapshot.active': '生效中',
  'snapshot.blockedChip': '已阻止',
  'reviewer.eyebrow': '审批评审快照',
  'reviewer.off': '关闭',
  'reviewer.frozen': '版本 {rev} · 策略 {policy} · 本次运行已冻结',
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

export type MessageParams = Readonly<Record<string, string | number>>;

export function createTranslator(locale: Locale): (key: MessageKey, params?: MessageParams) => string {
  const selected = CATALOGS[resolveLocale(locale)];
  return (key: MessageKey, params?: MessageParams): string => {
    const template = selected[key] ?? EN_US[key] ?? 'Unavailable';
    if (!params) return template;
    return template.replace(/\{([a-zA-Z]+)\}/g, (match: string, name: string) => (name in params ? String(params[name]) : match));
  };
}

export type Translator = ReturnType<typeof createTranslator>;

/** Keys present in the base catalog; every locale must resolve all of them. */
export function messageKeys(): readonly MessageKey[] {
  return Object.keys(EN_US) as MessageKey[];
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
