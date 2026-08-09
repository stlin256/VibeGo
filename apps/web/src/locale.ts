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
  | 'shell.runDetails'
  | 'shell.fileAuditTitle'
  | 'shell.fileAuditClose'
  | 'shell.fileAuditEmpty'
  | 'shell.fileAuditContentLabel'
  | 'shell.stopRun'
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
  | 'connection.pairingAuto'
  | 'connection.pairingAutoHint'
  | 'connection.pairingManualDivider'
  | 'connection.accountCreateTitle'
  | 'connection.accountCreateDescription'
  | 'connection.accountCreateAction'
  | 'connection.accountLoginTitle'
  | 'connection.accountLoginDescription'
  | 'connection.accountLoginAction'
  | 'connection.accountPasswordLabel'
  | 'connection.accountPasswordConfirmLabel'
  | 'connection.accountPasswordHint'
  | 'connection.accountPasswordMismatch'
  | 'setup.title'
  | 'setup.stepProvider'
  | 'setup.stepWorkspace'
  | 'setup.stepDone'
  | 'setup.providerTitle'
  | 'setup.providerDescription'
  | 'setup.providerPickerAriaLabel'
  | 'setup.providerDeepSeekLabel'
  | 'setup.providerDeepSeekDescription'
  | 'setup.providerRecommendedBadge'
  | 'setup.providerCustomLabel'
  | 'setup.providerCustomDescription'
  | 'setup.baseUrl'
  | 'setup.endpointProfile'
  | 'setup.endpoint'
  | 'setup.model'
  | 'setup.apiKey'
  | 'setup.probe'
  | 'setup.saveAndContinue'
  | 'setup.continueLabel'
  | 'setup.skip'
  | 'setup.workspaceTitle'
  | 'setup.workspaceDescription'
  | 'setup.doneTitle'
  | 'setup.doneDescription'
  | 'setup.startTask'
  | 'setup.bannerText'
  | 'setup.bannerAction'
  | 'setup.close'
  | 'composer.approval'
  | 'composer.sandbox'
  | 'composer.model'
  | 'composer.approvalOnRequest'
  | 'composer.approvalUntrusted'
  | 'composer.approvalNever'
  | 'composer.sandboxReadOnly'
  | 'composer.sandboxWorkspaceWrite'
  | 'composer.sandboxExternal'
  | 'settings.status.unavailable'
  | 'settings.status.ready'
  | 'settings.status.loading'
  | 'settings.status.degraded'
  | 'settings.status.notConfigured'
  | 'settings.status.credentialRequired'
  | 'settings.status.notProbed'
  | 'settings.status.required'
  | 'settings.status.loopback'
  | 'settings.status.disabled'
  | 'settings.status.localDraft'
  | 'settings.status.readyInline'
  | 'settings.status.degradedInline'
  | 'settings.status.disabledInline'
  | 'settings.status.enabledInline'
  | 'settings.status.blockedInline'
  | 'settings.status.none'
  | 'settings.status.notProbedInline'
  | 'settings.status.unavailableInline'
  | 'settings.status.loadingInline'
  | 'settings.status.notPaired'
  | 'settings.status.notSet'
  | 'settings.status.notMeasured'
  | 'settings.status.notReported'
  | 'settings.status.resourceNotProbed'
  | 'settings.status.healthyInline'
  | 'settings.status.detectedUnhealthy'
  | 'settings.option.enabled'
  | 'settings.option.disabled'
  | 'settings.option.off'
  | 'settings.option.restricted'
  | 'settings.saving'
  | 'settings.saved'
  | 'settings.probe'
  | 'settings.changesApplyNewRuns'
  | 'settings.grid.status'
  | 'settings.grid.revision'
  | 'settings.grid.requested'
  | 'settings.grid.effective'
  | 'settings.grid.policy'
  | 'settings.grid.lastLatency'
  | 'settings.toolsAvailable'
  | 'settings.permission.eyebrow'
  | 'settings.permission.title'
  | 'settings.permission.description'
  | 'settings.permission.ariaLabel'
  | 'settings.permission.profilesAriaLabel'
  | 'settings.permission.postureAriaLabel'
  | 'settings.permission.postureEyebrow'
  | 'settings.permission.unavailableNote'
  | 'settings.permission.unpairedNote'
  | 'settings.permission.workspaceCodingLabel'
  | 'settings.permission.workspaceCodingDescription'
  | 'settings.permission.fullHostLabel'
  | 'settings.permission.fullHostDescription'
  | 'settings.permission.safeBadge'
  | 'settings.permission.riskBadge'
  | 'settings.permission.boundedAutoLabel'
  | 'settings.permission.boundedAutoDescription'
  | 'settings.permission.sessionAutoLabel'
  | 'settings.permission.sessionAutoDescription'
  | 'settings.permission.explicitLabel'
  | 'settings.permission.explicitDescription'
  | 'settings.permission.fullHostPostureHint'
  | 'settings.permission.reasonLine'
  | 'settings.permission.nextLine'
  | 'settings.permission.effectiveScopeLine'
  | 'settings.permission.fullHostWarningTitle'
  | 'settings.permission.fullHostWarningBody'
  | 'settings.permission.fullHostAckLabel'
  | 'settings.permission.fullHostSaveFirst'
  | 'settings.permission.confirming'
  | 'settings.permission.fullHostConfirmed'
  | 'settings.permission.confirmFullHost'
  | 'settings.permission.grantTitle'
  | 'settings.permission.grantMeta'
  | 'settings.permission.revoking'
  | 'settings.permission.revoke'
  | 'settings.permission.blockedSafely'
  | 'settings.permission.degradedSafely'
  | 'settings.permission.sessionInactive'
  | 'settings.permission.nextStepFallback'
  | 'settings.permission.save'
  | 'settings.review.eyebrow'
  | 'settings.review.title'
  | 'settings.review.description'
  | 'settings.review.ariaLabel'
  | 'settings.review.unavailableNote'
  | 'settings.review.unpairedNote'
  | 'settings.review.enableLabel'
  | 'settings.review.note'
  | 'settings.review.reviewerSourceLabel'
  | 'settings.review.sourceSameAsRun'
  | 'settings.review.sourceDedicated'
  | 'settings.review.dedicatedProfileLabel'
  | 'settings.review.dedicatedHelp'
  | 'settings.review.postureAriaLabel'
  | 'settings.review.postureOffLabel'
  | 'settings.review.postureOffDescription'
  | 'settings.review.postureAdvisoryLabel'
  | 'settings.review.postureAdvisoryDescription'
  | 'settings.review.postureBoundedAutoLabel'
  | 'settings.review.postureBoundedAutoDescription'
  | 'settings.review.lastErrorPrefix'
  | 'settings.review.limitsAriaLabel'
  | 'settings.review.maxLatencyLabel'
  | 'settings.review.maxRequestBytesLabel'
  | 'settings.review.maxResponseBytesLabel'
  | 'settings.review.cacheTtlLabel'
  | 'settings.review.scopeNote'
  | 'settings.review.save'
  | 'settings.review.probeHealth'
  | 'settings.capability.eyebrow'
  | 'settings.capability.title'
  | 'settings.capability.description'
  | 'settings.capability.unavailableNote'
  | 'settings.capability.profilesAriaLabel'
  | 'settings.capability.previewLabel'
  | 'settings.capability.previewDescription'
  | 'settings.capability.workspaceCodingLabel'
  | 'settings.capability.workspaceCodingDescription'
  | 'settings.capability.advancedLocalLabel'
  | 'settings.capability.advancedLocalDescription'
  | 'settings.capability.customLabel'
  | 'settings.capability.customDescription'
  | 'settings.capability.ackLabel'
  | 'settings.capability.resolutionLine'
  | 'settings.capability.effectiveModesLine'
  | 'settings.capability.save'
  | 'settings.capability.reset'
  | 'settings.capability.unpairedNote'
  | 'settings.workspace.title'
  | 'settings.workspace.description'
  | 'settings.workspace.unavailableNote'
  | 'settings.workspace.defaultSuffix'
  | 'settings.workspace.pathNote'
  | 'settings.workspace.idLabel'
  | 'settings.workspace.friendlyLabel'
  | 'settings.workspace.pathLabel'
  | 'settings.workspace.pathPlaceholder'
  | 'settings.workspace.confirmLabel'
  | 'settings.workspace.add'
  | 'settings.workspace.createLabel'
  | 'settings.workspace.createPlaceholder'
  | 'settings.workspace.create'
  | 'settings.workspace.remove'
  | 'settings.workspace.unpairedNote'
  | 'settings.model.title'
  | 'settings.model.description'
  | 'settings.model.presetAriaLabel'
  | 'settings.model.presetDeepSeek'
  | 'settings.model.presetOpenAi'
  | 'settings.model.deepseekUnavailableNote'
  | 'settings.model.deepseekKeyNote'
  | 'settings.model.endpointProfile'
  | 'settings.model.completeEndpoint'
  | 'settings.model.modelLabel'
  | 'settings.model.apiKeyWriteOnly'
  | 'settings.model.apiKeyPlaceholder'
  | 'settings.model.thinking'
  | 'settings.model.thinkingAuto'
  | 'settings.model.thinkingHigh'
  | 'settings.model.thinkingMax'
  | 'settings.model.toolCalling'
  | 'settings.model.webSearch'
  | 'settings.model.webSearchProviderOwned'
  | 'settings.model.reviewer'
  | 'settings.model.reviewerAdvisory'
  | 'settings.model.saveDeepSeek'
  | 'settings.model.clear'
  | 'settings.model.probeLine'
  | 'settings.model.probeLatency'
  | 'settings.model.capabilityLine'
  | 'settings.model.setupAriaLabel'
  | 'settings.model.unavailableNote'
  | 'settings.model.configuredNote'
  | 'settings.model.credentialRequiredNote'
  | 'settings.model.setupNote'
  | 'settings.model.replaceKeyPlaceholder'
  | 'settings.model.pasteKeyPlaceholder'
  | 'settings.defaults.eyebrow'
  | 'settings.defaults.title'
  | 'settings.defaults.description'
  | 'settings.defaults.trustedWorkspace'
  | 'settings.defaults.untrustedContent'
  | 'settings.defaults.readOnly'
  | 'settings.defaults.workspaceWrite'
  | 'settings.defaults.externalSandbox'
  | 'settings.defaults.writableRoots'
  | 'settings.defaults.runtime'
  | 'settings.defaults.sandboxWritableRoots'
  | 'settings.defaults.onRequest'
  | 'settings.defaults.untrusted'
  | 'settings.defaults.never'
  | 'settings.memory.eyebrow'
  | 'settings.memory.title'
  | 'settings.memory.description'
  | 'settings.memory.ariaLabel'
  | 'settings.memory.unavailableNote'
  | 'settings.memory.enableLabel'
  | 'settings.memory.note'
  | 'settings.memory.modeLabel'
  | 'settings.memory.modeProxy'
  | 'settings.memory.modeFullStack'
  | 'settings.memory.intervalLabel'
  | 'settings.memory.teamId'
  | 'settings.memory.agentId'
  | 'settings.memory.userId'
  | 'settings.memory.upstreamRepo'
  | 'settings.memory.upstreamRef'
  | 'settings.memory.lockRef'
  | 'settings.memory.autoUpdate'
  | 'settings.memory.fallback'
  | 'settings.memory.statusLine'
  | 'settings.memory.healthLine'
  | 'settings.memory.recentLine'
  | 'settings.memory.save'
  | 'settings.memory.update'
  | 'settings.memory.rollback'
  | 'settings.memory.unpairedNote'
  | 'settings.knowledge.eyebrow'
  | 'settings.knowledge.title'
  | 'settings.knowledge.description'
  | 'settings.knowledge.ariaLabel'
  | 'settings.knowledge.unavailableNote'
  | 'settings.knowledge.enableLabel'
  | 'settings.knowledge.note'
  | 'settings.knowledge.resourceIdLabel'
  | 'settings.knowledge.autoRetrieveLabel'
  | 'settings.knowledge.maxItems'
  | 'settings.knowledge.maxBytes'
  | 'settings.knowledge.timeout'
  | 'settings.knowledge.statusLine'
  | 'settings.knowledge.toolsLine'
  | 'settings.knowledge.save'
  | 'settings.knowledge.probe'
  | 'settings.knowledge.unpairedNote'
  | 'settings.mcp.eyebrow'
  | 'settings.mcp.title'
  | 'settings.mcp.description'
  | 'settings.mcp.ariaLabel'
  | 'settings.mcp.unavailableNote'
  | 'settings.mcp.enableLabel'
  | 'settings.mcp.note'
  | 'settings.mcp.serverId'
  | 'settings.mcp.serverVersion'
  | 'settings.mcp.transport'
  | 'settings.mcp.endpointLabel'
  | 'settings.mcp.manifestRevision'
  | 'settings.mcp.capabilityRefs'
  | 'settings.mcp.statusLine'
  | 'settings.mcp.save'
  | 'settings.mcp.probe'
  | 'settings.mcp.unpairedNote'
  | 'settings.fs.eyebrow'
  | 'settings.fs.title'
  | 'settings.fs.description'
  | 'settings.fs.ariaLabel'
  | 'settings.fs.unavailableNote'
  | 'settings.fs.enableLabel'
  | 'settings.fs.note'
  | 'settings.fs.unpairedNote'
  | 'settings.git.eyebrow'
  | 'settings.git.title'
  | 'settings.git.description'
  | 'settings.git.ariaLabel'
  | 'settings.git.unavailableNote'
  | 'settings.git.enableLabel'
  | 'settings.git.note'
  | 'settings.git.unpairedNote'
  | 'settings.sandbox.eyebrow'
  | 'settings.sandbox.title'
  | 'settings.sandbox.description'
  | 'settings.sandbox.ariaLabel'
  | 'settings.sandbox.unavailableNote'
  | 'settings.sandbox.note'
  | 'settings.sandbox.providerLabel'
  | 'settings.sandbox.networkEnabledWarning'
  | 'settings.sandbox.probeRuntime'
  | 'settings.sandbox.imageDigest'
  | 'settings.sandbox.statusLine'
  | 'settings.sandbox.enableShell'
  | 'settings.sandbox.disableShell'
  | 'settings.sandbox.unpairedNote'
  | 'settings.cert.eyebrow'
  | 'settings.cert.title'
  | 'settings.cert.description'
  | 'settings.cert.validLine'
  | 'settings.cert.sanLine'
  | 'settings.cert.requiredNote'
  | 'settings.cert.loopbackNote'
  | 'settings.deploy.eyebrow'
  | 'settings.deploy.title'
  | 'settings.deploy.description'
  | 'settings.deploy.reasonLine'
  | 'settings.deploy.unavailableNote'
  | 'settings.deploy.loadingNote'
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
  'shell.runDetails': 'Run details',
  'shell.fileAuditTitle': 'FILE REFERENCE',
  'shell.fileAuditClose': 'Close file reference panel',
  'shell.fileAuditEmpty': 'No tool activity recorded for this path in the current run.',
  'shell.fileAuditContentLabel': 'Captured content',
  'shell.stopRun': 'Stop',
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
  'connection.pairingAuto': 'Connect automatically',
  'connection.pairingAutoHint': 'Reads a one-time code from the local daemon — nothing to type.',
  'connection.pairingManualDivider': 'or enter a pairing code',
  'connection.accountCreateTitle': 'Create your account',
  'connection.accountCreateDescription': 'Set a password for this VibeGo instance. It is stored only on this machine.',
  'connection.accountCreateAction': 'Create account',
  'connection.accountLoginTitle': 'Sign in',
  'connection.accountLoginDescription': 'Enter your password to continue.',
  'connection.accountLoginAction': 'Sign in',
  'connection.accountPasswordLabel': 'Password',
  'connection.accountPasswordConfirmLabel': 'Confirm password',
  'connection.accountPasswordHint': 'At least 4 characters.',
  'connection.accountPasswordMismatch': 'Passwords do not match.',
  'setup.title': 'Set up VibeGo',
  'setup.stepProvider': 'Model',
  'setup.stepWorkspace': 'Workspace',
  'setup.stepDone': 'Done',
  'setup.providerTitle': 'Connect a model provider',
  'setup.providerDescription': 'Pick a provider preset; the key is sent to the daemon once and is never stored in the browser.',
  'setup.providerPickerAriaLabel': 'Model provider presets',
  'setup.providerDeepSeekLabel': 'DeepSeek',
  'setup.providerDeepSeekDescription': 'Deep adaptation: thinking modes, tool calling and connection probe.',
  'setup.providerRecommendedBadge': 'Recommended',
  'setup.providerCustomLabel': 'OpenAI-compatible endpoint',
  'setup.providerCustomDescription': 'Any OpenAI-compatible service with a custom base URL and model.',
  'setup.baseUrl': 'Base URL',
  'setup.endpointProfile': 'Endpoint profile',
  'setup.endpoint': 'Endpoint',
  'setup.model': 'Model',
  'setup.apiKey': 'API key',
  'setup.probe': 'Probe',
  'setup.saveAndContinue': 'Save and continue',
  'setup.continueLabel': 'Continue',
  'setup.skip': 'Skip for now',
  'setup.workspaceTitle': 'Choose a workspace',
  'setup.workspaceDescription': 'Runs stay inside this folder; you can change it later in Settings.',
  'setup.doneTitle': 'All set',
  'setup.doneDescription': 'Model and workspace are configured. Describe your first task to get started.',
  'setup.startTask': 'Start first task',
  'setup.bannerText': 'No model configured yet — runs need a saved provider.',
  'setup.bannerAction': 'Set up now',
  'setup.close': 'Close setup',
  'composer.approval': 'Approval',
  'composer.sandbox': 'Sandbox',
  'composer.model': 'Model',
  'composer.approvalOnRequest': 'On request',
  'composer.approvalUntrusted': 'Untrusted',
  'composer.approvalNever': 'Never',
  'composer.sandboxReadOnly': 'Read-only',
  'composer.sandboxWorkspaceWrite': 'Workspace write',
  'composer.sandboxExternal': 'External',
  'settings.status.unavailable': 'Not available',
  'settings.status.ready': 'Ready',
  'settings.status.loading': 'Loading',
  'settings.status.degraded': 'Degraded',
  'settings.status.notConfigured': 'Not configured',
  'settings.status.credentialRequired': 'Credential required',
  'settings.status.notProbed': 'Not probed',
  'settings.status.required': 'Required',
  'settings.status.loopback': 'Loopback',
  'settings.status.disabled': 'Disabled',
  'settings.status.localDraft': 'Local draft',
  'settings.status.readyInline': 'ready',
  'settings.status.degradedInline': 'degraded',
  'settings.status.disabledInline': 'disabled',
  'settings.status.enabledInline': 'enabled',
  'settings.status.blockedInline': 'blocked',
  'settings.status.none': 'none',
  'settings.status.notProbedInline': 'not probed',
  'settings.status.unavailableInline': 'unavailable',
  'settings.status.loadingInline': 'loading',
  'settings.status.notPaired': 'not paired',
  'settings.status.notSet': 'not set',
  'settings.status.notMeasured': 'not measured',
  'settings.status.notReported': 'not reported',
  'settings.status.resourceNotProbed': 'resource not probed',
  'settings.status.healthyInline': 'healthy',
  'settings.status.detectedUnhealthy': 'detected but unhealthy',
  'settings.option.enabled': 'Enabled',
  'settings.option.disabled': 'Disabled',
  'settings.option.off': 'Off',
  'settings.option.restricted': 'Restricted',
  'settings.saving': 'Saving…',
  'settings.saved': 'Saved',
  'settings.probe': 'Probe',
  'settings.changesApplyNewRuns': 'Changes apply to new runs only.',
  'settings.grid.status': 'Status',
  'settings.grid.revision': 'Revision',
  'settings.grid.requested': 'Requested',
  'settings.grid.effective': 'Effective',
  'settings.grid.policy': 'Policy',
  'settings.grid.lastLatency': 'Last latency',
  'settings.toolsAvailable': 'Available: {tools}',
  'settings.permission.eyebrow': 'PERMISSION PROFILE',
  'settings.permission.title': 'Permission profile',
  'settings.permission.description': 'Choose the daemon-owned capability posture for new runs. Existing runs keep their frozen snapshot.',
  'settings.permission.ariaLabel': 'Permission profile settings',
  'settings.permission.profilesAriaLabel': 'Permission profiles',
  'settings.permission.postureAriaLabel': 'Approval posture',
  'settings.permission.postureEyebrow': 'APPROVAL POSTURE',
  'settings.permission.unavailableNote': 'Permission settings are unavailable; existing run controls remain fail-closed and unchanged.',
  'settings.permission.unpairedNote': 'Pair with the daemon to review permission profiles. Workspace coding remains the safe default.',
  'settings.permission.workspaceCodingLabel': 'Workspace coding',
  'settings.permission.workspaceCodingDescription': 'Workspace-only files, network off, and bounded approvals for routine work.',
  'settings.permission.fullHostLabel': 'Full host',
  'settings.permission.fullHostDescription': 'High risk: host files and processes. Trusted sessions only; never a default.',
  'settings.permission.safeBadge': 'SAFE DEFAULT',
  'settings.permission.riskBadge': 'HIGH RISK',
  'settings.permission.boundedAutoLabel': 'Bounded auto',
  'settings.permission.boundedAutoDescription': 'Routine exact-key workspace operations can proceed without repeated prompts.',
  'settings.permission.sessionAutoLabel': 'Session auto',
  'settings.permission.sessionAutoDescription': 'A confirmed trusted session may reuse a bounded host grant.',
  'settings.permission.explicitLabel': 'Ask every time',
  'settings.permission.explicitDescription': 'Keep the inline Allow/Deny decision visible for each approval.',
  'settings.permission.fullHostPostureHint': 'Full host requires explicit or session-scoped approval.',
  'settings.permission.reasonLine': 'Reason: {reason}',
  'settings.permission.nextLine': ' · Next: {next}',
  'settings.permission.effectiveScopeLine': 'Effective scope: {filesystem} · process {process} · network {network} · posture {posture}',
  'settings.permission.fullHostWarningTitle': 'Full host access is trusted-only and never automatic.',
  'settings.permission.fullHostWarningBody': 'It may expose host files and processes. It does not enable network, MCP, Skill, Goal, Scheduler, Approval, or Sandbox bypass. Untrusted tasks remain blocked.',
  'settings.permission.fullHostAckLabel': 'I understand the full-host risk for this trusted session.',
  'settings.permission.fullHostSaveFirst': 'Save the full-host profile first, then confirm this session.',
  'settings.permission.confirming': 'Confirming…',
  'settings.permission.fullHostConfirmed': 'Full-host session confirmed',
  'settings.permission.confirmFullHost': 'Confirm full-host session',
  'settings.permission.grantTitle': 'Trusted session grant',
  'settings.permission.grantMeta': 'Expires {time} · Uses {used}/{max}',
  'settings.permission.revoking': 'Revoking…',
  'settings.permission.revoke': 'Revoke full-host session',
  'settings.permission.blockedSafely': 'Blocked safely.',
  'settings.permission.degradedSafely': 'Degraded safely.',
  'settings.permission.sessionInactive': 'Session access is no longer active.',
  'settings.permission.nextStepFallback': 'Review the daemon status and choose the safer workspace profile.',
  'settings.permission.save': 'Save permission profile',
  'settings.review.eyebrow': 'LLM APPROVAL REVIEW',
  'settings.review.title': 'Approval review',
  'settings.review.description': 'Optional bounded review for exact low-risk approvals. It never replaces deterministic policy or the user.',
  'settings.review.ariaLabel': 'Approval review settings',
  'settings.review.unavailableNote': 'Approval review settings are unavailable. Existing deterministic approval remains unchanged.',
  'settings.review.unpairedNote': 'Pair with the daemon to configure bounded approval review.',
  'settings.review.enableLabel': 'Enable bounded approval review',
  'settings.review.note': 'When enabled, a bounded model call may review exact low-risk requests. It can add latency and provider cost; it never grants capabilities or replaces the user for high-risk work.',
  'settings.review.reviewerSourceLabel': 'Reviewer source',
  'settings.review.sourceSameAsRun': 'Use current run model',
  'settings.review.sourceDedicated': 'Dedicated reviewer (degraded until configured)',
  'settings.review.dedicatedProfileLabel': 'Dedicated profile ID',
  'settings.review.dedicatedHelp': 'Only a non-secret daemon profile ID is accepted. Credentials and endpoints stay in the daemon.',
  'settings.review.postureAriaLabel': 'Approval review posture',
  'settings.review.postureOffLabel': 'Off',
  'settings.review.postureOffDescription': 'Keep every approval on the normal user path.',
  'settings.review.postureAdvisoryLabel': 'Advisory',
  'settings.review.postureAdvisoryDescription': 'Explain low-risk requests; you still choose Allow once.',
  'settings.review.postureBoundedAutoLabel': 'Bounded auto',
  'settings.review.postureBoundedAutoDescription': 'Only exact trusted low-risk keys may be auto-resolved through the existing ApprovalBroker.',
  'settings.review.lastErrorPrefix': 'Last safe error: {code}. ',
  'settings.review.limitsAriaLabel': 'Bounded reviewer limits',
  'settings.review.maxLatencyLabel': 'Max latency (ms)',
  'settings.review.maxRequestBytesLabel': 'Max request bytes',
  'settings.review.maxResponseBytesLabel': 'Max response bytes',
  'settings.review.cacheTtlLabel': 'Cache TTL (ms)',
  'settings.review.scopeNote': 'Always asks you for destructive, network, full-host, untrusted, ambiguous or unavailable-sandbox requests. Session-wide grants are managed in Permission settings.',
  'settings.review.save': 'Save approval review',
  'settings.review.probeHealth': 'Probe health',
  'settings.capability.eyebrow': 'CAPABILITY PROFILE',
  'settings.capability.title': 'Capability profile',
  'settings.capability.description': 'Choose a bounded intent; the daemon resolves the effective permissions.',
  'settings.capability.unavailableNote': 'Capability profile settings are unavailable; existing run controls remain unchanged.',
  'settings.capability.profilesAriaLabel': 'Capability profiles',
  'settings.capability.previewLabel': 'Preview',
  'settings.capability.previewDescription': 'Inspect the conversation with no side-effecting tools.',
  'settings.capability.workspaceCodingLabel': 'Workspace coding',
  'settings.capability.workspaceCodingDescription': 'Workspace-scoped coding with approval and no implicit host shell.',
  'settings.capability.advancedLocalLabel': 'Advanced local',
  'settings.capability.advancedLocalDescription': 'Opt-in host-restricted shell (pwsh on Windows, bash on Linux/macOS); explicit acknowledgement is required.',
  'settings.capability.customLabel': 'Custom',
  'settings.capability.customDescription': 'Keep individually selected capability modes under daemon policy.',
  'settings.capability.ackLabel': 'I understand host-restricted execution requires explicit approval and never falls back silently.',
  'settings.capability.resolutionLine': 'Requested: {requested} · Effective: {effective} · reason: {reason} · revision: {revision}',
  'settings.capability.effectiveModesLine': 'Effective modes: model {model} · filesystem {filesystem} · shell {shell} · network {network} · MCP/Skill {mcpSkill}',
  'settings.capability.save': 'Save capability profile',
  'settings.capability.reset': 'Reset to Preview',
  'settings.capability.unpairedNote': 'Pair with the daemon to choose a capability profile.',
  'settings.workspace.title': 'Workspace',
  'settings.workspace.description': 'Select the daemon workspace used by new runs.',
  'settings.workspace.unavailableNote': 'Workspace setup is unavailable until the daemon exposes the authenticated registry.',
  'settings.workspace.defaultSuffix': ' · default',
  'settings.workspace.pathNote': 'Added paths are on the daemon machine. The path is used only by the daemon and is never shown in status, events, or browser storage.',
  'settings.workspace.idLabel': 'Workspace id',
  'settings.workspace.friendlyLabel': 'Friendly label',
  'settings.workspace.pathLabel': 'Path on daemon machine',
  'settings.workspace.pathPlaceholder': 'project-a',
  'settings.workspace.confirmLabel': 'I understand this grants guarded tools access to that directory.',
  'settings.workspace.add': 'Add workspace',
  'settings.workspace.createLabel': 'New project',
  'settings.workspace.createPlaceholder': 'New project name',
  'settings.workspace.create': 'Create project',
  'settings.workspace.remove': 'Remove',
  'settings.workspace.unpairedNote': 'Pair with the daemon to configure workspaces.',
  'settings.model.title': 'Model provider',
  'settings.model.description': 'DeepSeek is the deeply adapted preset; any OpenAI-compatible endpoint also works.',
  'settings.model.presetAriaLabel': 'Provider preset',
  'settings.model.presetDeepSeek': 'DeepSeek (deep adaptation)',
  'settings.model.presetOpenAi': 'OpenAI-compatible endpoint',
  'settings.model.deepseekUnavailableNote': 'DeepSeek settings are unavailable; the existing provider surface remains unchanged.',
  'settings.model.deepseekKeyNote': 'The API key is sent once to the daemon and is never returned or stored in browser state. Changes apply only to new runs.',
  'settings.model.endpointProfile': 'Endpoint profile',
  'settings.model.completeEndpoint': 'Complete endpoint',
  'settings.model.modelLabel': 'Model',
  'settings.model.apiKeyWriteOnly': 'API key (write-only)',
  'settings.model.apiKeyPlaceholder': 'Paste once; never displayed',
  'settings.model.thinking': 'Thinking',
  'settings.model.thinkingAuto': 'Auto',
  'settings.model.thinkingHigh': 'High (probe required)',
  'settings.model.thinkingMax': 'Max (probe required)',
  'settings.model.toolCalling': 'Tool calling',
  'settings.model.webSearch': 'Web search',
  'settings.model.webSearchProviderOwned': 'Provider-owned (Approval + network)',
  'settings.model.reviewer': 'Reviewer',
  'settings.model.reviewerAdvisory': 'Advisory',
  'settings.model.saveDeepSeek': 'Save DeepSeek',
  'settings.model.clear': 'Clear',
  'settings.model.probeLine': 'Probe: {status} · {detail}',
  'settings.model.probeLatency': 'latency {ms} ms',
  'settings.model.capabilityLine': 'Capability: {status} · streaming {streaming} · tools {tools} · reasoning {reasoning} · revision {revision}',
  'settings.model.setupAriaLabel': 'Model provider setup',
  'settings.model.unavailableNote': 'Model setup is unavailable until the daemon exposes the authenticated settings adapter.',
  'settings.model.configuredNote': 'Configured via {source}. The key is held by the daemon and is never shown here.',
  'settings.model.credentialRequiredNote': 'Saved endpoint restored; enter the key again to enable new runs. The key is never persisted.',
  'settings.model.setupNote': 'Set up a provider here; no .env or YAML editing is required.',
  'settings.model.replaceKeyPlaceholder': 'Enter a replacement key',
  'settings.model.pasteKeyPlaceholder': 'Paste once; never stored in browser',
  'settings.defaults.eyebrow': 'RUN DEFAULTS',
  'settings.defaults.title': 'Safety and limits',
  'settings.defaults.description': 'Conservative defaults apply to new runs only.',
  'settings.defaults.trustedWorkspace': 'Trusted workspace',
  'settings.defaults.untrustedContent': 'Untrusted content',
  'settings.defaults.readOnly': 'Read-only',
  'settings.defaults.workspaceWrite': 'Workspace write',
  'settings.defaults.externalSandbox': 'External sandbox',
  'settings.defaults.writableRoots': 'Writable roots',
  'settings.defaults.runtime': 'Runtime',
  'settings.defaults.sandboxWritableRoots': 'Sandbox writable roots',
  'settings.defaults.onRequest': 'On request',
  'settings.defaults.untrusted': 'Untrusted tasks',
  'settings.defaults.never': 'Never (read-only only)',
  'settings.memory.eyebrow': 'AGENT MEMORY',
  'settings.memory.title': 'Long-term memory',
  'settings.memory.description': 'Optional untrusted retrieval; it never grants tools or permissions.',
  'settings.memory.ariaLabel': 'Agent memory setup',
  'settings.memory.unavailableNote': 'Agent memory settings are unavailable; normal runs are unaffected.',
  'settings.memory.enableLabel': 'Enable optional long-term memory',
  'settings.memory.note': 'Memory is an untrusted retrieval enhancement. It never grants tools, bypasses approval, or changes Goal/run facts.',
  'settings.memory.modeLabel': 'Mode',
  'settings.memory.modeProxy': 'Proxy (later)',
  'settings.memory.modeFullStack': 'Full stack (later)',
  'settings.memory.intervalLabel': 'Interval (min)',
  'settings.memory.teamId': 'Team ID',
  'settings.memory.agentId': 'Agent ID',
  'settings.memory.userId': 'User ID',
  'settings.memory.upstreamRepo': 'Upstream repository',
  'settings.memory.upstreamRef': 'Upstream ref',
  'settings.memory.lockRef': 'Lock ref to an immutable commit SHA',
  'settings.memory.autoUpdate': 'Allow scheduled upstream checks',
  'settings.memory.fallback': 'Fall back to direct provider when memory is unavailable',
  'settings.memory.statusLine': 'Status: {state} · {availability} · current {current} · previous {previous}',
  'settings.memory.healthLine': 'Health {latency} · recall hits {hits} / misses {misses} · write queue {pending} pending ({failed} failed)',
  'settings.memory.recentLine': 'Recent: {items}',
  'settings.memory.save': 'Save memory settings',
  'settings.memory.update': 'Update',
  'settings.memory.rollback': 'Roll back',
  'settings.memory.unpairedNote': 'Pair with the daemon to configure optional memory.',
  'settings.knowledge.eyebrow': 'KNOWLEDGE RETRIEVAL',
  'settings.knowledge.title': 'Knowledge retrieval',
  'settings.knowledge.description': 'Explicit bounded Wiki/CodeGraph context only; never a tool permission.',
  'settings.knowledge.ariaLabel': 'Agent memory knowledge setup',
  'settings.knowledge.unavailableNote': 'Knowledge settings are unavailable; normal runs are unaffected.',
  'settings.knowledge.enableLabel': 'Enable optional knowledge resource',
  'settings.knowledge.note': 'Only explicit, bounded Wiki/CodeGraph retrieval is allowed. Results are untrusted context and never become tools or permissions.',
  'settings.knowledge.resourceIdLabel': 'Resource ID',
  'settings.knowledge.autoRetrieveLabel': 'Retrieve once for each new run',
  'settings.knowledge.maxItems': 'Max items',
  'settings.knowledge.maxBytes': 'Max bytes',
  'settings.knowledge.timeout': 'Timeout (ms)',
  'settings.knowledge.statusLine': 'Status: {state} · {resource} · revision {revision}',
  'settings.knowledge.toolsLine': 'Read-only tools: {tools}',
  'settings.knowledge.save': 'Save knowledge settings',
  'settings.knowledge.probe': 'Probe knowledge',
  'settings.knowledge.unpairedNote': 'Pair with the daemon to configure optional knowledge retrieval.',
  'settings.mcp.eyebrow': 'MCP / SKILL',
  'settings.mcp.title': 'MCP capability bridge',
  'settings.mcp.description': 'Optional capabilities remain untrusted until explicit activation review.',
  'settings.mcp.ariaLabel': 'MCP and Skill setup',
  'settings.mcp.unavailableNote': 'MCP settings are unavailable; normal runs are unaffected.',
  'settings.mcp.enableLabel': 'Enable optional MCP integration',
  'settings.mcp.note': 'MCP stays outside the default run path. Capabilities remain untrusted until a later explicit activation review.',
  'settings.mcp.serverId': 'Server ID',
  'settings.mcp.serverVersion': 'Server version',
  'settings.mcp.transport': 'Transport',
  'settings.mcp.endpointLabel': 'Endpoint label',
  'settings.mcp.manifestRevision': 'Manifest revision',
  'settings.mcp.capabilityRefs': 'Capability references',
  'settings.mcp.statusLine': 'Status: {status} · {health} · revision {revision} · capabilities {count} · next {next}',
  'settings.mcp.save': 'Save MCP settings',
  'settings.mcp.probe': 'Probe MCP',
  'settings.mcp.unpairedNote': 'Pair with the daemon to configure optional MCP/Skill status.',
  'settings.fs.eyebrow': 'TOOL ACCESS',
  'settings.fs.title': 'Guarded filesystem',
  'settings.fs.description': 'Bounded reads and approval-gated writes.',
  'settings.fs.ariaLabel': 'Filesystem tool setup',
  'settings.fs.unavailableNote': 'Tool settings are unavailable until the daemon exposes the authenticated adapter.',
  'settings.fs.enableLabel': 'Enable guarded filesystem tools',
  'settings.fs.note': 'Workspace: {workspace}. Reads are bounded; writes still require approval. Shell, MCP, and network tools remain disabled here; Git reads have a separate toggle.',
  'settings.fs.unpairedNote': 'Pair with the daemon to configure guarded filesystem tools.',
  'settings.git.eyebrow': 'GIT READ-ONLY TOOLS',
  'settings.git.title': 'Git read-only tools',
  'settings.git.description': 'Status, diff, and log only; no write operations.',
  'settings.git.ariaLabel': 'Git read-only tool setup',
  'settings.git.unavailableNote': 'Git settings are unavailable until the daemon exposes the authenticated adapter.',
  'settings.git.enableLabel': 'Enable Git read-only tools',
  'settings.git.note': 'Workspace: {workspace}. This exposes only bounded status, diff, and log reads; commits, checkout, reset, patch writes, remotes, and arbitrary Git flags remain unavailable.',
  'settings.git.unpairedNote': 'Pair with the daemon to configure Git read-only tools.',
  'settings.sandbox.eyebrow': 'EXTERNAL SANDBOX',
  'settings.sandbox.title': 'External sandbox',
  'settings.sandbox.description': 'Docker/Podman shell is opt-in and isolated; a host shell is separately available via the advanced-local capability profile.',
  'settings.sandbox.ariaLabel': 'External sandbox setup',
  'settings.sandbox.unavailableNote': 'External sandbox settings are unavailable until the authenticated adapter is ready.',
  'settings.sandbox.note': 'Docker/Podman shell is off by default. Probe the runtime, then enable it explicitly. A host shell (PowerShell on Windows, bash on Linux/macOS) is available through the advanced-local capability profile; it requires acknowledgement and every command needs approval.',
  'settings.sandbox.providerLabel': 'Provider',
  'settings.sandbox.networkEnabledWarning': 'Enabled (warning)',
  'settings.sandbox.probeRuntime': 'Probe runtime',
  'settings.sandbox.imageDigest': 'Image digest',
  'settings.sandbox.statusLine': 'Status: {state} · configured network: {network} · {enabled}',
  'settings.sandbox.enableShell': 'Enable external shell',
  'settings.sandbox.disableShell': 'Disable external shell',
  'settings.sandbox.unpairedNote': 'Pair with the daemon to configure external sandbox execution.',
  'settings.cert.eyebrow': 'TLS STATUS',
  'settings.cert.title': 'Certificate',
  'settings.cert.description': 'Private keys stay in the daemon certificate adapter.',
  'settings.cert.validLine': 'Valid to {date} · {days} days remaining',
  'settings.cert.sanLine': 'SAN: {sans}',
  'settings.cert.requiredNote': 'Certificate setup is required for this TLS transport. Use the daemon certificate adapter; private keys are never entered or shown in this browser.',
  'settings.cert.loopbackNote': 'Loopback HTTP is active for local development. Pairing and future TLS setup remain available.',
  'settings.deploy.eyebrow': 'DEPLOYMENT STATUS',
  'settings.deploy.title': 'Access readiness',
  'settings.deploy.description': 'LAN and future Tailscale/SSH/public modes remain explicit and fail-closed.',
  'settings.deploy.reasonLine': 'Reason: {reason} · Next: {next}',
  'settings.deploy.unavailableNote': 'Deployment readiness is unavailable; existing pairing and run controls remain usable.',
  'settings.deploy.loadingNote': 'Reading deployment readiness…',
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
  'shell.runDetails': '运行详情',
  'shell.fileAuditTitle': '文件引用',
  'shell.fileAuditClose': '关闭文件引用面板',
  'shell.fileAuditEmpty': '当前运行中没有记录到这个路径的工具活动。',
  'shell.fileAuditContentLabel': '捕获的内容',
  'shell.stopRun': '停止',
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
  'connection.pairingAuto': '一键连接',
  'connection.pairingAutoHint': '自动从本机 daemon 读取一次性配对码，无需输入。',
  'connection.pairingManualDivider': '或手动输入配对码',
  'connection.accountCreateTitle': '创建账号',
  'connection.accountCreateDescription': '为这台机器上的 VibeGo 设置登录密码，密码只保存在本机。',
  'connection.accountCreateAction': '创建账号',
  'connection.accountLoginTitle': '登录',
  'connection.accountLoginDescription': '输入密码以继续。',
  'connection.accountLoginAction': '登录',
  'connection.accountPasswordLabel': '密码',
  'connection.accountPasswordConfirmLabel': '确认密码',
  'connection.accountPasswordHint': '至少 4 个字符。',
  'connection.accountPasswordMismatch': '两次输入的密码不一致。',
  'setup.title': '初始设置',
  'setup.stepProvider': '模型',
  'setup.stepWorkspace': '工作区',
  'setup.stepDone': '完成',
  'setup.providerTitle': '连接模型提供方',
  'setup.providerDescription': '选择一个提供方预设；API key 只发送一次给 daemon，不会保存在浏览器中。',
  'setup.providerPickerAriaLabel': '模型提供方预设',
  'setup.providerDeepSeekLabel': 'DeepSeek',
  'setup.providerDeepSeekDescription': '深度适配：思考模式、工具调用与连接探测。',
  'setup.providerRecommendedBadge': '推荐',
  'setup.providerCustomLabel': 'OpenAI 兼容端点',
  'setup.providerCustomDescription': '任意 OpenAI 兼容服务，自定义 Base URL 与模型。',
  'setup.baseUrl': 'Base URL',
  'setup.endpointProfile': 'Endpoint 类型',
  'setup.endpoint': 'Endpoint',
  'setup.model': '模型',
  'setup.apiKey': 'API key',
  'setup.probe': '探测',
  'setup.saveAndContinue': '保存并继续',
  'setup.continueLabel': '继续',
  'setup.skip': '暂时跳过',
  'setup.workspaceTitle': '选择工作区',
  'setup.workspaceDescription': '运行只会在这个文件夹内进行，之后可在设置中更改。',
  'setup.doneTitle': '一切就绪',
  'setup.doneDescription': '模型和工作区已配置完成。描述你的第一个任务即可开始。',
  'setup.startTask': '开始第一个任务',
  'setup.bannerText': '尚未配置模型——保存提供方后才能开始运行。',
  'setup.bannerAction': '立即设置',
  'setup.close': '关闭设置',
  'composer.approval': '审批',
  'composer.sandbox': '沙箱',
  'composer.model': '模型',
  'composer.approvalOnRequest': '按需',
  'composer.approvalUntrusted': '不可信任务',
  'composer.approvalNever': '从不',
  'composer.sandboxReadOnly': '只读',
  'composer.sandboxWorkspaceWrite': '工作区可写',
  'composer.sandboxExternal': '外部沙箱',
  'settings.status.unavailable': '不可用',
  'settings.status.ready': '就绪',
  'settings.status.loading': '加载中',
  'settings.status.degraded': '已降级',
  'settings.status.notConfigured': '未配置',
  'settings.status.credentialRequired': '需要凭据',
  'settings.status.notProbed': '未探测',
  'settings.status.required': '必需',
  'settings.status.loopback': '回环',
  'settings.status.disabled': '已禁用',
  'settings.status.localDraft': '本地草稿',
  'settings.status.readyInline': '就绪',
  'settings.status.degradedInline': '已降级',
  'settings.status.disabledInline': '已禁用',
  'settings.status.enabledInline': '已启用',
  'settings.status.blockedInline': '已阻止',
  'settings.status.none': '无',
  'settings.status.notProbedInline': '未探测',
  'settings.status.unavailableInline': '不可用',
  'settings.status.loadingInline': '加载中',
  'settings.status.notPaired': '未配对',
  'settings.status.notSet': '未设置',
  'settings.status.notMeasured': '未测量',
  'settings.status.notReported': '未报告',
  'settings.status.resourceNotProbed': '资源未探测',
  'settings.status.healthyInline': '运行正常',
  'settings.status.detectedUnhealthy': '已检测到但异常',
  'settings.option.enabled': '启用',
  'settings.option.disabled': '禁用',
  'settings.option.off': '关闭',
  'settings.option.restricted': '受限',
  'settings.saving': '保存中…',
  'settings.saved': '已保存',
  'settings.probe': '探测',
  'settings.changesApplyNewRuns': '更改仅对新运行生效。',
  'settings.grid.status': '状态',
  'settings.grid.revision': '版本',
  'settings.grid.requested': '请求',
  'settings.grid.effective': '生效',
  'settings.grid.policy': '策略',
  'settings.grid.lastLatency': '最近延迟',
  'settings.toolsAvailable': '可用：{tools}',
  'settings.permission.eyebrow': '运行安全',
  'settings.permission.title': '权限档案',
  'settings.permission.description': '为新运行选择由 daemon 管理的能力姿态。已有运行保留其冻结快照。',
  'settings.permission.ariaLabel': '权限档案设置',
  'settings.permission.profilesAriaLabel': '权限档案',
  'settings.permission.postureAriaLabel': '审批姿态',
  'settings.permission.postureEyebrow': '审批姿态',
  'settings.permission.unavailableNote': '权限设置不可用；现有运行控制保持失败即关闭且不变。',
  'settings.permission.unpairedNote': '与 daemon 配对后即可查看权限档案。工作区编码仍是安全默认值。',
  'settings.permission.workspaceCodingLabel': '工作区编码',
  'settings.permission.workspaceCodingDescription': '仅限工作区文件、关闭网络，日常工作使用有界审批。',
  'settings.permission.fullHostLabel': '完全主机',
  'settings.permission.fullHostDescription': '高风险：可访问主机文件与进程。仅限受信会话；绝不做默认值。',
  'settings.permission.safeBadge': '安全默认',
  'settings.permission.riskBadge': '高风险',
  'settings.permission.boundedAutoLabel': '有界自动',
  'settings.permission.boundedAutoDescription': '常规的精确键工作区操作可继续进行，无需重复询问。',
  'settings.permission.sessionAutoLabel': '会话自动',
  'settings.permission.sessionAutoDescription': '已确认的受信会话可复用有界的主机授权。',
  'settings.permission.explicitLabel': '每次都询问',
  'settings.permission.explicitDescription': '每次审批都显示内联的允许/拒绝决定。',
  'settings.permission.fullHostPostureHint': '完全主机权限要求显式或会话级审批。',
  'settings.permission.reasonLine': '原因：{reason}',
  'settings.permission.nextLine': ' · 下一步：{next}',
  'settings.permission.effectiveScopeLine': '生效范围：{filesystem} · 进程 {process} · 网络 {network} · 姿态 {posture}',
  'settings.permission.fullHostWarningTitle': '完全主机访问仅限受信会话，绝不会自动开启。',
  'settings.permission.fullHostWarningBody': '它可能暴露主机文件与进程。它不会启用网络、MCP、Skill、Goal、Scheduler、Approval 或 Sandbox 绕过。不可信任务仍会被阻止。',
  'settings.permission.fullHostAckLabel': '我理解本受信会话的完全主机风险。',
  'settings.permission.fullHostSaveFirst': '请先保存完全主机档案，然后确认本会话。',
  'settings.permission.confirming': '确认中…',
  'settings.permission.fullHostConfirmed': '完全主机会话已确认',
  'settings.permission.confirmFullHost': '确认完全主机会话',
  'settings.permission.grantTitle': '受信会话授权',
  'settings.permission.grantMeta': '到期 {time} · 已使用 {used}/{max}',
  'settings.permission.revoking': '撤销中…',
  'settings.permission.revoke': '撤销完全主机会话',
  'settings.permission.blockedSafely': '已安全阻止。',
  'settings.permission.degradedSafely': '已安全降级。',
  'settings.permission.sessionInactive': '会话访问已失效。',
  'settings.permission.nextStepFallback': '请查看 daemon 状态，并选择更安全的工作区档案。',
  'settings.permission.save': '保存权限档案',
  'settings.review.eyebrow': 'LLM 审批评审',
  'settings.review.title': '审批评审',
  'settings.review.description': '为精确的低风险审批提供可选的有界评审。它绝不取代确定性策略或用户。',
  'settings.review.ariaLabel': '审批评审设置',
  'settings.review.unavailableNote': '审批评审设置不可用。现有的确定性审批保持不变。',
  'settings.review.unpairedNote': '与 daemon 配对后即可配置有界审批评审。',
  'settings.review.enableLabel': '启用有界审批评审',
  'settings.review.note': '启用后，有界模型调用可以评审精确的低风险请求。它会增加延迟与提供方成本；它绝不授予能力，也不会在高风险工作中替代用户。',
  'settings.review.reviewerSourceLabel': '评审器来源',
  'settings.review.sourceSameAsRun': '使用当前运行模型',
  'settings.review.sourceDedicated': '专用评审器（配置完成前处于降级状态）',
  'settings.review.dedicatedProfileLabel': '专用档案 ID',
  'settings.review.dedicatedHelp': '仅接受非敏感的 daemon 档案 ID。凭据与 endpoint 保留在 daemon 中。',
  'settings.review.postureAriaLabel': '审批评审姿态',
  'settings.review.postureOffLabel': '关闭',
  'settings.review.postureOffDescription': '所有审批保持正常的用户路径。',
  'settings.review.postureAdvisoryLabel': '建议',
  'settings.review.postureAdvisoryDescription': '解释低风险请求；仍需你选择允许一次。',
  'settings.review.postureBoundedAutoLabel': '有界自动',
  'settings.review.postureBoundedAutoDescription': '只有精确的受信低风险键才能通过现有 ApprovalBroker 自动处理。',
  'settings.review.lastErrorPrefix': '最近的安全错误：{code}。',
  'settings.review.limitsAriaLabel': '有界评审器限制',
  'settings.review.maxLatencyLabel': '最大延迟（毫秒）',
  'settings.review.maxRequestBytesLabel': '最大请求字节数',
  'settings.review.maxResponseBytesLabel': '最大响应字节数',
  'settings.review.cacheTtlLabel': '缓存 TTL（毫秒）',
  'settings.review.scopeNote': '破坏性、网络、完全主机、不可信、含糊或沙箱不可用的请求一律询问你。会话级授权在权限设置中管理。',
  'settings.review.save': '保存审批评审',
  'settings.review.probeHealth': '探测健康状态',
  'settings.capability.eyebrow': '能力档案',
  'settings.capability.title': '能力档案',
  'settings.capability.description': '选择一个有界意图；由 daemon 解析实际生效的权限。',
  'settings.capability.unavailableNote': '能力档案设置不可用；现有运行控制保持不变。',
  'settings.capability.profilesAriaLabel': '能力档案',
  'settings.capability.previewLabel': '预览',
  'settings.capability.previewDescription': '查看对话，不使用有副作用的工具。',
  'settings.capability.workspaceCodingLabel': '工作区编码',
  'settings.capability.workspaceCodingDescription': '工作区范围内的编码，需要审批，不隐含主机 shell。',
  'settings.capability.advancedLocalLabel': '高级本地',
  'settings.capability.advancedLocalDescription': '显式启用的主机受限 shell（Windows 为 pwsh，Linux/macOS 为 bash）；需要明确确认。',
  'settings.capability.customLabel': '自定义',
  'settings.capability.customDescription': '在 daemon 策略下保留逐项选择的能力模式。',
  'settings.capability.ackLabel': '我理解主机受限执行需要显式审批，且绝不会静默回退。',
  'settings.capability.resolutionLine': '请求：{requested} · 生效：{effective} · 原因：{reason} · 版本：{revision}',
  'settings.capability.effectiveModesLine': '生效模式：模型 {model} · 文件系统 {filesystem} · shell {shell} · 网络 {network} · MCP/Skill {mcpSkill}',
  'settings.capability.save': '保存能力档案',
  'settings.capability.reset': '重置为 Preview',
  'settings.capability.unpairedNote': '与 daemon 配对后即可选择能力档案。',
  'settings.workspace.title': '工作区',
  'settings.workspace.description': '选择新运行使用的 daemon 工作区。',
  'settings.workspace.unavailableNote': '在 daemon 暴露经认证的注册表之前，工作区设置不可用。',
  'settings.workspace.defaultSuffix': ' · 默认',
  'settings.workspace.pathNote': '添加的路径位于 daemon 所在机器。路径仅由 daemon 使用，绝不会出现在状态、事件或浏览器存储中。',
  'settings.workspace.idLabel': '工作区 ID',
  'settings.workspace.friendlyLabel': '显示名称',
  'settings.workspace.pathLabel': 'daemon 机器上的路径',
  'settings.workspace.pathPlaceholder': 'project-a',
  'settings.workspace.confirmLabel': '我理解这会授予受防护工具访问该目录的权限。',
  'settings.workspace.add': '添加工作区',
  'settings.workspace.createLabel': '新建项目',
  'settings.workspace.createPlaceholder': '新项目名称',
  'settings.workspace.create': '新建项目',
  'settings.workspace.remove': '移除',
  'settings.workspace.unpairedNote': '与 daemon 配对后即可配置工作区。',
  'settings.model.title': '模型提供方',
  'settings.model.description': 'DeepSeek 是深度适配的预设；任何 OpenAI 兼容 endpoint 也可使用。',
  'settings.model.presetAriaLabel': '提供方预设',
  'settings.model.presetDeepSeek': 'DeepSeek（深度适配）',
  'settings.model.presetOpenAi': 'OpenAI 兼容 endpoint',
  'settings.model.deepseekUnavailableNote': 'DeepSeek 设置不可用；现有提供方配置保持不变。',
  'settings.model.deepseekKeyNote': 'API key 只发送一次给 daemon，绝不会返回或存入浏览器状态。更改仅对新运行生效。',
  'settings.model.endpointProfile': 'Endpoint 类型',
  'settings.model.completeEndpoint': '完整 endpoint',
  'settings.model.modelLabel': '模型',
  'settings.model.apiKeyWriteOnly': 'API key（只写）',
  'settings.model.apiKeyPlaceholder': '仅粘贴一次；绝不显示',
  'settings.model.thinking': '思考',
  'settings.model.thinkingAuto': '自动',
  'settings.model.thinkingHigh': '高（需要探测）',
  'settings.model.thinkingMax': '最高（需要探测）',
  'settings.model.toolCalling': '工具调用',
  'settings.model.webSearch': '联网搜索',
  'settings.model.webSearchProviderOwned': '提供方托管（审批 + 网络）',
  'settings.model.reviewer': '评审器',
  'settings.model.reviewerAdvisory': '建议',
  'settings.model.saveDeepSeek': '保存 DeepSeek',
  'settings.model.clear': '清除',
  'settings.model.probeLine': '探测：{status} · {detail}',
  'settings.model.probeLatency': '延迟 {ms} 毫秒',
  'settings.model.capabilityLine': '能力：{status} · 流式 {streaming} · 工具 {tools} · 推理 {reasoning} · 版本 {revision}',
  'settings.model.setupAriaLabel': '模型提供方设置',
  'settings.model.unavailableNote': '在 daemon 暴露经认证的设置适配器之前，模型设置不可用。',
  'settings.model.configuredNote': '已通过 {source} 配置。密钥由 daemon 保管，不会在此显示。',
  'settings.model.credentialRequiredNote': '已恢复保存的 endpoint；请重新输入密钥以启用新运行。密钥绝不会被持久化。',
  'settings.model.setupNote': '在此配置提供方，无需编辑 .env 或 YAML。',
  'settings.model.replaceKeyPlaceholder': '输入替换密钥',
  'settings.model.pasteKeyPlaceholder': '仅粘贴一次；不会存入浏览器',
  'settings.defaults.eyebrow': '运行默认值',
  'settings.defaults.title': '安全与限制',
  'settings.defaults.description': '保守默认值仅应用于新运行。',
  'settings.defaults.trustedWorkspace': '受信工作区',
  'settings.defaults.untrustedContent': '不可信内容',
  'settings.defaults.readOnly': '只读',
  'settings.defaults.workspaceWrite': '工作区可写',
  'settings.defaults.externalSandbox': '外部沙箱',
  'settings.defaults.writableRoots': '可写根目录',
  'settings.defaults.runtime': '运行时',
  'settings.defaults.sandboxWritableRoots': '沙箱可写根目录',
  'settings.defaults.onRequest': '按需',
  'settings.defaults.untrusted': '不可信任务',
  'settings.defaults.never': '从不（仅限只读）',
  'settings.memory.eyebrow': 'AGENT 记忆',
  'settings.memory.title': '长期记忆',
  'settings.memory.description': '可选的不可信检索；它绝不授予工具或权限。',
  'settings.memory.ariaLabel': 'Agent 记忆设置',
  'settings.memory.unavailableNote': 'Agent 记忆设置不可用；正常运行不受影响。',
  'settings.memory.enableLabel': '启用可选的长期记忆',
  'settings.memory.note': '记忆是不可信的检索增强。它绝不授予工具、绕过审批或改变 Goal/运行事实。',
  'settings.memory.modeLabel': '模式',
  'settings.memory.modeProxy': 'Proxy（稍后推出）',
  'settings.memory.modeFullStack': '完整栈（稍后推出）',
  'settings.memory.intervalLabel': '间隔（分钟）',
  'settings.memory.teamId': '团队 ID',
  'settings.memory.agentId': 'Agent ID',
  'settings.memory.userId': '用户 ID',
  'settings.memory.upstreamRepo': '上游仓库',
  'settings.memory.upstreamRef': '上游 ref',
  'settings.memory.lockRef': '将 ref 锁定为不可变的 commit SHA',
  'settings.memory.autoUpdate': '允许定时检查上游',
  'settings.memory.fallback': '记忆不可用时回退到直连提供方',
  'settings.memory.statusLine': '状态：{state} · {availability} · 当前 {current} · 上一个 {previous}',
  'settings.memory.healthLine': '健康度 {latency} · 召回命中 {hits} / 未命中 {misses} · 写队列 {pending} 待处理（{failed} 失败）',
  'settings.memory.recentLine': '最近：{items}',
  'settings.memory.save': '保存记忆设置',
  'settings.memory.update': '更新',
  'settings.memory.rollback': '回滚',
  'settings.memory.unpairedNote': '与 daemon 配对后即可配置可选记忆。',
  'settings.knowledge.eyebrow': '知识检索',
  'settings.knowledge.title': '知识检索',
  'settings.knowledge.description': '仅限显式有界的 Wiki/CodeGraph 上下文；绝不是工具权限。',
  'settings.knowledge.ariaLabel': 'Agent 记忆知识设置',
  'settings.knowledge.unavailableNote': '知识设置不可用；正常运行不受影响。',
  'settings.knowledge.enableLabel': '启用可选的知识资源',
  'settings.knowledge.note': '仅允许显式、有界的 Wiki/CodeGraph 检索。结果是不可信上下文，绝不会变成工具或权限。',
  'settings.knowledge.resourceIdLabel': '资源 ID',
  'settings.knowledge.autoRetrieveLabel': '每个新运行检索一次',
  'settings.knowledge.maxItems': '最大条目数',
  'settings.knowledge.maxBytes': '最大字节数',
  'settings.knowledge.timeout': '超时（毫秒）',
  'settings.knowledge.statusLine': '状态：{state} · {resource} · 版本 {revision}',
  'settings.knowledge.toolsLine': '只读工具：{tools}',
  'settings.knowledge.save': '保存知识设置',
  'settings.knowledge.probe': '探测知识库',
  'settings.knowledge.unpairedNote': '与 daemon 配对后即可配置可选知识检索。',
  'settings.mcp.eyebrow': 'MCP / SKILL',
  'settings.mcp.title': 'MCP 能力桥接',
  'settings.mcp.description': '可选能力在显式激活评审之前保持不可信。',
  'settings.mcp.ariaLabel': 'MCP 与 Skill 设置',
  'settings.mcp.unavailableNote': 'MCP 设置不可用；正常运行不受影响。',
  'settings.mcp.enableLabel': '启用可选的 MCP 集成',
  'settings.mcp.note': 'MCP 保持在默认运行路径之外。能力在之后的显式激活评审前保持不可信。',
  'settings.mcp.serverId': '服务器 ID',
  'settings.mcp.serverVersion': '服务器版本',
  'settings.mcp.transport': '传输方式',
  'settings.mcp.endpointLabel': 'Endpoint 标签',
  'settings.mcp.manifestRevision': '清单版本',
  'settings.mcp.capabilityRefs': '能力引用',
  'settings.mcp.statusLine': '状态：{status} · {health} · 版本 {revision} · 能力 {count} · 下一步 {next}',
  'settings.mcp.save': '保存 MCP 设置',
  'settings.mcp.probe': '探测 MCP',
  'settings.mcp.unpairedNote': '与 daemon 配对后即可配置可选 MCP/Skill 状态。',
  'settings.fs.eyebrow': '工具访问',
  'settings.fs.title': '受防护的文件系统',
  'settings.fs.description': '有界读取与审批门控的写入。',
  'settings.fs.ariaLabel': '文件系统工具设置',
  'settings.fs.unavailableNote': '在 daemon 暴露经认证的适配器之前，工具设置不可用。',
  'settings.fs.enableLabel': '启用受防护的文件系统工具',
  'settings.fs.note': '工作区：{workspace}。读取是有界的；写入仍需审批。Shell、MCP 与网络工具在此保持禁用；Git 读取有独立开关。',
  'settings.fs.unpairedNote': '与 daemon 配对后即可配置受防护的文件系统工具。',
  'settings.git.eyebrow': 'GIT 只读工具',
  'settings.git.title': 'Git 只读工具',
  'settings.git.description': '仅限 status、diff 和 log；无写操作。',
  'settings.git.ariaLabel': 'Git 只读工具设置',
  'settings.git.unavailableNote': '在 daemon 暴露经认证的适配器之前，Git 设置不可用。',
  'settings.git.enableLabel': '启用 Git 只读工具',
  'settings.git.note': '工作区：{workspace}。这里仅暴露有界的 status、diff 和 log 读取；commit、checkout、reset、补丁写入、远程仓库和任意 Git 参数仍不可用。',
  'settings.git.unpairedNote': '与 daemon 配对后即可配置 Git 只读工具。',
  'settings.sandbox.eyebrow': '外部沙箱',
  'settings.sandbox.title': '外部沙箱',
  'settings.sandbox.description': 'Docker/Podman shell 为显式启用且相互隔离；主机 shell 可通过 advanced-local 能力配置单独启用。',
  'settings.sandbox.ariaLabel': '外部沙箱设置',
  'settings.sandbox.unavailableNote': '在经认证的适配器就绪之前，外部沙箱设置不可用。',
  'settings.sandbox.note': 'Docker/Podman shell 默认关闭。先探测运行时，再显式启用。主机 shell（Windows 上为 PowerShell，Linux/macOS 上为 bash）可通过 advanced-local 能力配置启用；需要明确确认，且每条命令都需经过审批。',
  'settings.sandbox.providerLabel': '提供方',
  'settings.sandbox.networkEnabledWarning': '启用（警告）',
  'settings.sandbox.probeRuntime': '探测运行时',
  'settings.sandbox.imageDigest': '镜像摘要',
  'settings.sandbox.statusLine': '状态：{state} · 配置的网络：{network} · {enabled}',
  'settings.sandbox.enableShell': '启用外部 shell',
  'settings.sandbox.disableShell': '禁用外部 shell',
  'settings.sandbox.unpairedNote': '与 daemon 配对后即可配置外部沙箱执行。',
  'settings.cert.eyebrow': 'TLS 状态',
  'settings.cert.title': '证书',
  'settings.cert.description': '私钥保留在 daemon 证书适配器中。',
  'settings.cert.validLine': '有效期至 {date} · 剩余 {days} 天',
  'settings.cert.sanLine': 'SAN：{sans}',
  'settings.cert.requiredNote': '此 TLS 传输需要配置证书。请使用 daemon 证书适配器；私钥绝不会在此浏览器中输入或显示。',
  'settings.cert.loopbackNote': '本地开发使用回环 HTTP。配对与后续的 TLS 配置仍可使用。',
  'settings.deploy.eyebrow': '部署状态',
  'settings.deploy.title': '访问就绪状态',
  'settings.deploy.description': 'LAN 及未来的 Tailscale/SSH/公网模式保持显式启用且失败即关闭。',
  'settings.deploy.reasonLine': '原因：{reason} · 下一步：{next}',
  'settings.deploy.unavailableNote': '部署就绪状态不可用；现有配对与运行控制仍可使用。',
  'settings.deploy.loadingNote': '正在读取部署就绪状态…',
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
