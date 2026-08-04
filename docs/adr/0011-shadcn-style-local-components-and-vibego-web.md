# ADR 0011：shadcn 风格本地组件与 VibeGo Web 迁移

- 状态：Accepted（设计决策；实现按 Spec 42 分阶段落地）
- 日期：2026-08-04
- 相关：[Spec 42：shadcn 风格 Web 设计系统与 conversation-first UI](../specs/42-shadcn-style-web-design-system.md)
- 相关：[Spec 37：Ratio-first responsive Web experience](../specs/37-ratio-responsive-ui.md)、[Spec 38：Conversation-first Web shell](../specs/38-conversation-first-web-shell.md)

## 背景

现有 Web 已能工作，但随着 Settings、Memory、Goal、Sandbox、Approval 和恢复状态增多，
手写 CSS/JSX 的组件变体、焦点和响应式行为开始分散。项目需要一种成熟、可复制、可
审阅的组件组织方式，同时不能牺牲 VibeGo 的品牌、低资源目标或 Host-first API 边界。

## 决策

组件选型遵循“组件库优先”约束：已有成熟实现时，优先使用 shadcn registry 的官方源码
或 Radix/headless primitive；只有在没有合适实现、许可/包体积/维护状态不满足约束，或
VibeGo 需要明确的业务组合行为时，才允许新增本地实现。任何自定义 primitive 都必须
在对应组件文档或后续 ADR 中记录候选库、拒绝理由、无障碍责任和测试覆盖。

采用 shadcn/ui 的设计语言和源码所有权模式，但不把完整 shadcn 页面或黑盒 UI 框架作为
运行时依赖：

- 组件源码存放在 `apps/web/src/components/ui`；
- VibeGo 业务组合组件存放在 `apps/web/src/components/vibego`；
- 使用 shadcn 语义 token、Tailwind utility、CVA/`cn` 和按需 Radix primitives；
- VibeGo 自己决定品牌色、布局、文案、权限状态和组件 API；
- 迁移过程保持现有 React props、ApiClient、SSE 和 Host-first 同源边界；
- 原生客户端不在本 ADR 范围内，未来只消费稳定的 API/SSE。

## 选择理由

### 相比继续手写 CSS

本地 primitives 可以集中处理 focus、disabled、loading、touch target、Sheet/Dialog 和
响应式变体，减少业务页面的重复 CSS；同时保留源码可控性和低运行时开销。

### 相比 Material/Ant Design 等整体 UI 框架

整体框架会带入预设品牌、较大的运行时 API 和难以拆除的交互假设。VibeGo 需要的是可审阅
的组件源码，而不是让库接管 Settings、Approval 或安全状态。

### 相比直接复制完整产品页面

只使用公开的组件组织启发和必要的开源 primitive，保持 VibeGo 自己的品牌、信息架构和
安全文案；不复制 Codex 或其他 agent app 的实现、页面资产或私有协议。

## 约束

- 不改 AgentLoop、RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry 或事件事实源；
- 不在基础组件中发 HTTP、写 localStorage 或读取 secret；
- 不使用 UA/device sniffing；
- 不提交截图作为验收物；
- 初始 JS/CSS bundle 超过 Spec 42 budget 时必须暂停迁移并记录原因；
- 每个新 primitive/组合组件先有单元测试，再迁移现有调用；
- Web 仍是 Host 的默认远程客户端，Android/iOS/HarmonyOS 明确后置。

## 代价与风险

- Tailwind/Radix/CVA 会增加依赖和构建配置，需要锁定版本并进行 bundle 检查；
- 现有单文件 CSS 迁移会产生一段时间的双轨样式；
- shadcn 默认视觉容易变成通用紫色 SaaS，必须由 VibeGo token 和品牌验收阻止；
- Dialog/Sheet、focus trap 和移动 safe-area 需要真实 viewport/键盘回归，不以桌面截图代替。

## 实施顺序

先做 token/primitives，再做 conversation shell，再做 Settings/Approval/Goal/Memory cards，
最后删除重复旧 CSS。每个阶段独立更新文档、测试、typecheck、bundle 检查和 Git 提交。

## Phase 42a implementation update (2026-08-05)

The first slice uses local, dependency-free primitives rather than adding a
full UI runtime. Semantic tokens live in `styles.css`; `cn()` and a small
variant helper live under `src/lib`; the UI primitives live under
`src/components/ui`. This is compatible with the shadcn source-owned model
and keeps the initial bundle/resource budget predictable. Radix or generated
shadcn source may be introduced later only when a primitive needs focus
management that native HTML cannot safely provide.

Phase 42a deliberately does not rewrite `App.tsx`. Business composition,
daemon callbacks and responsive shell behavior remain unchanged until Phase
42b has component-level regression coverage. The accepted boundaries around
secrets, API access, Host-first same-origin delivery and the existing runtime
authorities are unchanged.

## Phase 42b-1 implementation update (2026-08-05)

The first shell migration extracts the conversation stream, composer,
run-console and bounded tool-output inspector into a typed `vibego` component.
It uses the local Button/Textarea primitives and receives all run snapshots and
actions from `App`; it does not own API calls, SSE, storage, approval policy or
event persistence. This keeps the extraction reversible and leaves the
workspace rail, context rail and Settings drawer for separately tested slices.

## Phase 42b-2 implementation update (2026-08-05)

`WorkspaceRail` and `ContextRail` are now separate presentational components.
They accept typed metadata/projections and callbacks, use Button/Card
primitives, and preserve the existing CSS landmarks and responsive grid. The
context component composes the existing read-only Goal and observability
panels; it does not fetch data or become a second API/event authority. Settings
remains in the application shell until the next migration gate.

## Phase 42b-3 implementation update (2026-08-05)

The topbar is extracted as `ConversationHeader`, while `App` keeps the
Settings drawer and all interaction state. The component receives locale,
connection, drawer and context snapshots plus explicit callbacks; it may use
the local `Button` primitive and native `select` for the simple locale control.
It must not import `api.ts`, read browser storage, access credentials, create an
SSE channel, or own focus-return state. Existing CSS landmarks and keyboard
shortcuts remain the compatibility contract; Settings and operation-card
migration are not part of this slice.

The focused Web gate covers connected/awaiting-pairing rendering, locale ARIA,
Button primitive output and secret/path-free markup. The component adds no
network, storage, SSE or runtime authority.

## Phase 42c-1 implementation update (2026-08-05)

Approval and recovery cards are extracted before the larger Settings Sheet.
`ApprovalCard` and `RecoveryCard` receive bounded snapshots and explicit
callbacks from `ConversationShell`; they do not import `ApiClient`, create
approval/retry requests, or persist operation state. The deny action keeps the
destructive Button variant, while retry continues to mean “new run” and never
replays an interrupted tool call. Existing CSS landmarks and callback semantics
are compatibility contracts for this slice.

Focused tests cover approval details/no-details, destructive deny output,
recovery retry presentation and secret/path/raw-argument-free markup; the
slice adds no network, storage, SSE or runtime authority.

## Phase 42c-2 implementation update (2026-08-05)

The Settings Sheet shell is extracted before its forms and tabs. The local
`SettingsSheet` component receives only open state, a ref, bounded copy, a close
callback and children; `App` retains focus trapping/return, settings values,
API calls, and secret-safe persistence. This is a presentational dialog shell,
not a second settings authority or a new persistence/API surface.

Focused tests cover open/closed projection, dialog ARIA, child-slot rendering,
Button output and secret/path-free markup; form values, focus trap/return and
all settings API behavior remain owned by `App`.

## Phase 42c-3 implementation update (2026-08-05)

The Settings Sheet composition now uses local `SettingsTabs` and
`SettingsSection` components. They are presentational and dependency-light:
the tab component provides the tablist/tab/tabpanel ARIA contract and the
section component provides consistent status presentation for loading,
degraded, unavailable, and ready states. They do not import `api.ts`, read
storage, access credentials, or create a second settings/event authority.

`App` remains responsible for active-tab state, form values, validation,
callbacks, focus trapping/return, and secret-safe persistence. Existing fields
are grouped into Run, Tools, and Access panels without changing their names,
callbacks, or daemon contracts. Inactive panels remain bounded and hidden in
the DOM to keep SSR/test output deterministic. The focused component tests
cover keyboard/ARIA attributes, inactive panel hiding, status variants and
secret/path-free rendering.
