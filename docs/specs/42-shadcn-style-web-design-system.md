# Spec 42：shadcn 风格 Web 设计系统与 conversation-first UI

- 状态：Accepted（Phase 42a、42b-1、42b-2、42b-3、42c-1、42c-2、42c-3 与 42d-1 已实现；其余 42d 验收仍按后续阶段推进）
- 日期：2026-08-04
- 适用范围：`apps/web`、React 19、TypeScript、Vite、Host-first 同源 Web
- 相关 ADR：[ADR 0011：shadcn 风格本地组件与 VibeGo Web 迁移](../adr/0011-shadcn-style-local-components-and-vibego-web.md)
- 相关规格：[Spec 37：Ratio-first responsive Web experience](37-ratio-responsive-ui.md)、[Spec 38：Conversation-first Web shell](38-conversation-first-web-shell.md)、[Spec 41：Host-first 发行](41-host-first-distribution-and-client-boundary.md)

## 1. 背景

当前 Web 已有 conversation-first 壳层、workspace rail、context rail、Settings drawer、
Goal 投影、审批卡片和多比例 CSS，但组件主要由单文件 JSX 与手写 CSS 组成。随着模型、
Memory、Goal、Sandbox 和 Approval 设置继续增加，现有样式容易出现间距、焦点、禁用状态、
移动端触摸目标和错误状态不一致的问题。

本阶段采用 shadcn/ui 的设计方法和组件组织方式：组件源码进入仓库，由产品控制变体和
可访问性；不把一个黑盒 UI library 作为业务事实源，也不复制任何完整产品页面。

## 2. 目标

### 2.1 必须实现

1. 使用 shadcn 风格的 token、组件变体、边框/圆角/阴影、暗色层级和键盘交互。
2. 保留 VibeGo 品牌：深海军蓝画布、青色/靛蓝/紫色强调色、荧光绿安全信号；不直接
   使用 shadcn 默认紫色作为品牌主色。
3. 保留 Spec 38 的 conversation-first 信息架构：对话/运行时间线是首要阅读面，
   composer 是首要操作面，Settings 是 Sheet/Drawer，Goal/连接/guardrail 是可收起上下文。
4. 保留 Spec 37 的 width + aspect-ratio 响应式策略，不使用 UA/device sniffing。
5. 组件与 API/daemon 解耦：基础组件不能发请求，业务容器通过 props/callback 接收状态。
6. 对 pairing、run、approval、recovery、Goal、Memory、Sandbox、workspace 和错误/空状态
   提供统一的 loading、disabled、degraded 和 retry 视觉语义。
7. 在桌面、竖屏显示器、普通手机、折叠屏封面/展开态、阔折叠、三折叠和平板上保持
   可读、可操作、无横向溢出。
8. 不把 secret、token、绝对路径、原始 tool output 或完整 transcript 写入浏览器持久化。
9. 保持 Host-first 同源部署约束：生产 Web 使用相对 API 路径，不新增独立后端或第二条事件流。

### 2.2 不在本阶段实现

- 不改动 AgentLoop、RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry 或 Goal 事实源；
- 不重写 `ApiClient`、run event contract 或 SSE resume contract；
- 不引入 Next.js、SSR、React Native 或原生 Android/iOS/HarmonyOS UI；
- 不把完整 `shadcn/ui` 页面模板、Codex 源码或其他品牌页面复制进仓库；
- 不把截图作为文档或仓库验收物；视觉验收通过浏览器 viewport smoke/可访问性测试完成；
- 不为了视觉效果增加常驻服务、重型图表库或无法 tree-shake 的组件库。

## 3. 设计系统决策

### 3.0 组件库优先（新增约束）

当一个交互或视觉 primitive 已由成熟、可审计且与当前许可兼容的组件库提供时，
必须优先采用该组件库的官方实现或 shadcn registry 生成的本地源码，不能重新手搓一个
功能等价的实现。当前优先级如下：

1. shadcn/ui registry 组件源码（进入仓库，接受 VibeGo token 和 API 约束）；
2. Radix UI primitives（Dialog、Sheet、Tabs、Popover、Tooltip、Select、Switch 等需要
   focus 管理、键盘交互或 ARIA 语义的组件）；
3. 其他经过评估的 headless/accessibility 组件库，需记录许可证、包体积、维护状态和
   tree-shaking 结果；
4. 原生 HTML + CSS，仅适用于组件库不覆盖且语义足够简单的元素；
5. 自定义实现只作为最后手段，必须在 ADR 或组件 README 中说明为什么现有库不适用，
   并补齐键盘、focus、触摸、reduced-motion、SSR/无 JS 降级（如适用）测试。

“源码进入仓库”不等于“手写替代库”：复制/生成的组件仍应标注来源、版本和许可证，
只允许修改 token、样式、受控 props 和必要的无障碍修复；不得复制完整页面模板或引入
不需要的整套运行时框架。每新增一个 primitive，实施记录必须包含候选库比较和不采用理由。

### 3.1 Token 层

使用 shadcn 语义 token，而不是在业务组件里直接写颜色：

```text
background / foreground
card / card-foreground
popover / popover-foreground
primary / primary-foreground
secondary / secondary-foreground
muted / muted-foreground
accent / accent-foreground
destructive / destructive-foreground
border / input / ring
radius / shadow / focus ring
```

VibeGo 的 cyan/indigo/violet/lime 只通过 token 或状态 token 暴露。`destructive` 表示
拒绝、危险和不可逆操作；lime 只表示安全、ready 或明确通过，不表示任意成功。

### 3.2 组件源码与依赖边界

采用 shadcn 的“组件源码进入仓库”模式，并遵循上面的组件库优先顺序：

- `apps/web/src/components/ui/`：Button、Input、Textarea、Label、Card、Badge、Separator、
  Skeleton、ScrollArea、Dialog/Sheet、Tabs、Select、Switch、Tooltip、Alert、Toast 等基础组件；
- `apps/web/src/components/vibego/`：WorkspaceRail、ConversationHeader、RunTimeline、
  Composer、ContextRail、ApprovalCard、SettingsSheet、GoalCard、MemoryStatus、ToolOutputInspector 等组合组件；
- `apps/web/src/lib/cn.ts`：class merge/variant helper；
- 基础组件不得 import `api.ts`、`main.tsx` 或 daemon contract；
- 组合组件可以消费类型和 callback，但不得绕过现有 application API。

依赖采用最小集合：

- Tailwind utility/build integration（只生成实际使用的 CSS）；
- `class-variance-authority`、`clsx`、`tailwind-merge`；
- 只为真实需要的 Dialog/Sheet/Tabs/Tooltip 等引入 Radix primitives；
- shadcn 常用的 lucide icon 仅按图标 tree-shake；
- 不引入一个运行时接管全部样式的 UI framework。

如果某个 primitive 可以用原生 HTML 和受控 CSS 安全实现，就不为了形式引入额外依赖。

## 4. 组件层级与用户体验

### 4.1 基础组件

所有基础组件必须有：

- default、hover、active、focus-visible、disabled、loading、destructive 等明确变体；
- 语义 HTML 和可访问名称；
- 触摸目标至少 44 CSS px（密集只读 metadata 可例外）；
- `prefers-reduced-motion` 支持；
- 不因长文本、窄 viewport 或系统字体放大而横向溢出。

### 4.2 Conversation Shell

桌面宽屏：

```text
Workspace rail | Conversation timeline + composer | Context rail
```

窄屏、竖屏和折叠封面：

```text
Top bar → Conversation timeline → Composer → 可折叠 context/settings Sheet
```

必须保留：

- `New task` 一键清空草稿并聚焦 composer；
- `Ctrl/Cmd+N` 快捷键；
- composer 位于阅读流底部，移动端考虑 safe-area inset；
- run active 时显示取消，needs-recovery 时显示显式 retry；
- approval required 时使用高对比但不惊扰的 Alert/Card，不把危险操作伪装成普通按钮；
- context rail 显示 workspace、sandbox、approval、Goal、Memory 和 connection 摘要；
- Settings 使用 Sheet/Dialog，可 Escape 关闭并将焦点返回触发按钮。

### 4.3 设置体验

Settings Sheet 使用 Tabs 或分组 Card：

1. Run defaults：trust、sandbox、approval、limits；
2. Workspace：选择、添加、删除和能力摘要；
3. Model：Provider、model、连接状态和 write-only key；
4. Tools：filesystem、Git read-only、external sandbox；
5. Memory：MemoryCore/Proxy/Knowledge、degraded、revision、operations；
6. Access：pairing、TLS 状态、LAN 引导；
7. Diagnostics：稳定错误码、bounded operations 和 recovery 提示。

每个设置区都必须显示保存中、保存成功、保存失败、不可用和默认关闭状态。secret 输入
成功后清空；UI 不显示 endpoint credential、绝对路径或原始 sidecar response。

## 5. 响应式与跨设备约束

组件不能知道设备名称，只消费 viewport、aspect-ratio、可用宽度和 `prefers-*` 媒体查询。

| 视口形态 | 主布局 | 交互约束 |
| --- | --- | --- |
| 横屏桌面 | 三栏 | rail 可收缩，中央 conversation 有界，context 不裁切 |
| 竖屏桌面 | 单中央列 + 可折叠 context | 保留宽输入框和完整时间线 |
| 普通手机 | 单列 | sticky composer、44px 触摸目标、Sheet 设置 |
| 折叠屏封面 | 单列紧凑 | 不显示永久右 rail，避免铰链/窄幅裁切 |
| 折叠屏展开 | 两栏或受限三栏 | 中央阅读列优先，context 可收缩 |
| 阔折叠/三折叠 | 按实际宽高比选择 | 不假设固定面板数量，不把铰链当内容区域 |
| 平板 | 两栏优先 | workspace/context 可折叠，composer 保持可达 |

所有布局都必须通过长 Goal title、长 tool output、审批详情、错误码、系统字体放大和
横屏/竖屏切换 fixture。

## 6. 状态、API 与客户端边界

UI 状态分三层：

1. Server snapshot：health、run、events、settings、Goal 和 memory operations；
2. Interaction state：drawer、tab、draft、focus、pending action；
3. Presentation state：expanded card、scroll position、reduced motion。

只有 server snapshot 由 `ApiClient` 更新；基础组件不能自己发请求。Settings 修改必须
继续走 daemon 的 auth/CSRF/Origin/API contract；Native Client 后续也消费同一 projection，
不会让 Web 组件状态变成新的事实源。

## 7. 可访问性、性能与测试门禁

### 7.1 可访问性

- 目标为 WCAG 2.2 AA 的键盘、焦点、对比度和语义基础；
- Dialog/Sheet 具备 focus trap、Escape close 和返回焦点；
- form control 都有 Label/description/error；
- 不仅依赖颜色表达 approval、degraded、completed 或 destructive；
- `prefers-reduced-motion` 下不使用必须依赖动画理解的状态。

### 7.2 资源预算

- 初始 JS gzip 目标不超过 110 KiB；超过当前基线约 20% 必须记录原因并评估；
- 初始 CSS gzip 目标不超过 30 KiB；
- 不为静态 icon、button 或 card 引入单独网络请求；
- 长列表、tool output 和 Goal evidence 使用 bounded rendering；
- 组件只在打开 Sheet/Dialog 或需要时加载重型交互。

### 7.3 测试

每个组件/组合组件先补测试，再迁移业务调用：

- variant/aria/disabled/loading 单元测试；
- App smoke test：pairing、New task、composer、settings Sheet、approval、retry、cancel；
- CSS contract test：token、focus ring、ratio layout、overflow guard；
- viewport fixture：desktop、portrait desktop、phone、fold cover/unfold、wide fold、tri-fold、tablet；
- keyboard/reduced-motion 和错误/空/降级状态回归；
- `pnpm typecheck`、`pnpm test`、`pnpm diff:check` 必须通过；
- 本阶段不把截图提交到仓库，必要的视觉验证在本地或 CI 生成临时产物。

## 8. 迁移顺序

### Phase 42a：Token 与 primitives

- 引入 shadcn 语义 token、`cn`/variant helper 和最小基础组件；
- 不改变 API、路由、AgentLoop 或现有功能；
- 增加基础组件测试和 bundle budget fixture。

### Phase 42b：Conversation shell

- 迁移 topbar、workspace rail、conversation timeline、composer、context rail；
- 先保持现有 props/callback contract；
- 删除重复 CSS，只保留 token 和 ratio layout；
- 验证 New task、keyboard、SSE、cancel 和 mobile safe-area。

### Phase 42c：Settings/operation surfaces

- 迁移 Settings Sheet、Tabs、forms、approval/recovery、Goal/Memory/Tool cards；
- 统一 loading/error/degraded/toast 语义；
- 不把 secret 或原始响应引入 UI 状态。

### Phase 42d：验收与清理

- 完成 viewport/keyboard/accessibility 回归；
- 对比 Web bundle 和低资源指标；
- 删除未使用旧 CSS 和临时组件；
- 在独立 Git 提交后进入 Host-first static serving 实现。

### Phase 42a implementation update (2026-08-05)

Phase 42a is now implemented as a dependency-light foundation for the Web
surface. `apps/web/src/styles.css` exposes semantic shadcn-style tokens while
retaining the VibeGo cyan/indigo/violet/lime brand mapping. The new
`apps/web/src/lib/cn.ts` helper performs bounded class composition without a
runtime styling framework, and `apps/web/src/components/ui/` contains tested
Button, Input, Textarea, Label, Card, Badge, Separator and Skeleton primitives.

The primitives are presentational only: they do not import `api.ts`, access
browser storage, read credentials, or issue network requests. They preserve
44px touch targets, focus-visible rings, disabled/loading/destructive variants,
reduced-motion compatibility and semantic HTML. Existing App composition is
intentionally not migrated in this slice; Phase 42b will replace business
markup incrementally after each composition component has its own contract
test. This keeps the current conversation-first behavior and bundle stable
while making the next migration reversible.

Focused Web tests cover variant rendering, ARIA/label forwarding, disabled and
loading behavior, token/helper contracts and primitive isolation. The Web
focused gate now passes 88 tests, typecheck and production build; the observed
bundle is 80.68 KiB JS gzip and 5.82 KiB CSS gzip. No screenshots or
device emulation are claimed as evidence by Phase 42a.

### Phase 42b-1 implementation update (2026-08-05)

The first conversation-shell migration is now componentized under
`apps/web/src/components/vibego/ConversationShell.tsx`. It owns the
conversation stream, composer, `RunConsole` and bounded tool-output inspector,
and consumes only typed props/callbacks from `App`. The composer uses the
Phase 42a `Textarea` and `Button` primitives; approval, retry and cancel
actions remain explicit callbacks owned by the existing application boundary.

The extraction preserves the existing `run`/`StoredEvent` snapshot and SSE
projection semantics, including the 24-card/128 KiB tool-output display cap.
The component does not import `api.ts`, access storage, read credentials or
create a second event stream. The large Settings drawer remains in `App` for
the next 42c slice. Focused
Web smoke tests cover empty/running/recovery/approval composer states and
confirm the component stays secret/path-free.

### Phase 42b-2 implementation update (2026-08-05)

The workspace rail and context rail are now extracted into
`apps/web/src/components/vibego/WorkspaceRail.tsx` and
`ContextRail.tsx`. They are presentational composition components: the rail
receives the selected workspace label and explicit callbacks, while the context
rail receives bounded Goal/observability projections and health metadata. Both
use the local Button/Card primitives and keep settings, run creation, SSE and
all server authority in `App`/`ApiClient`.

Responsive class names and DOM landmarks remain unchanged (`workspace-rail`,
`context-rail`, `Run context`, `Workspace navigation`). The extraction does
not echo workspace paths, credentials, raw telemetry or event payloads, and it
does not add a second request or event stream. The Settings drawer remains
intentionally in `App` for the next 42c migration slice.

### Phase 42b-3 implementation update (2026-08-05)

The existing topbar is now extracted into the typed
`components/vibego/ConversationHeader.tsx` presentational component. It owns
only brand/status rendering and explicit callbacks for new task, context toggle,
settings focus return, and locale selection. It preserves the current
`topbar`/`topbar-actions` landmarks, `Control+N`/`Meta+N` hint, connection
status projection, and ratio-first wrapping without adding a request, storage
write, event stream, or server authority. The Settings drawer remains in `App`
for the later 42c slice.

The focused gate adds component smoke coverage for connected and
awaiting-pairing states, verifies Button primitive usage and locale ARIA
semantics, and rejects credentials, absolute paths, and raw event payloads in
the rendered markup. The observed output remains below the 110 KiB JS /
30 KiB CSS gzip budgets.

### Phase 42c-1 implementation update (2026-08-05)

The first operation-surface slice extracts the existing approval and recovery
cards into typed `vibego` composition components. `ApprovalCard` receives a
bounded `ApprovalSummary`, the run's sandbox mode, and an explicit allow/deny
callback; `RecoveryCard` receives only the explicit retry callback. They remain
presentational: no API, storage, SSE, approval policy, retry creation, tool
execution, or event persistence may move into the components. The existing
fail-closed semantics stay in the `App`/daemon callback boundary, including
single-use approval decisions and recovery as a new run.

The focused gate must cover approval metadata with and without sandbox details,
recovery retry affordance, destructive deny styling, bounded markup, and the
absence of credentials, absolute paths, raw tool arguments, or event payloads.
Goal/Memory/Tool cards and operation persistence remain later
42c slices. The focused Web gate now passes 88 tests with 80.68 KiB JS gzip
and 5.82 KiB CSS gzip.

### Phase 42c-2 implementation update (2026-08-05)

This slice extracts the Settings Sheet shell into a typed
`vibego/SettingsSheet.tsx` component. It owns only the dialog landmark,
open/hidden projection, title/description/close affordance, and a bounded
children slot. `App` continues to own settings state, form values, API
callbacks, focus trap/return, and all secret-safe persistence behavior. The
shell must preserve `settings-drawer`, `role="dialog"`, `aria-modal`,
`aria-labelledby`, responsive CSS, and the existing close callback without
creating a request, storage authority, or second settings source.

The focused gate covers open and closed projections, close-button ARIA,
child-slot rendering, Button primitive output, and secret/path-free markup.
Tabs, form-group extraction, and Settings operation cards remain later 42c
slices.

### Phase 42c-3 implementation update (2026-08-05)

The Settings Sheet now has a local, dependency-light tab and form-group
contract. `SettingsTabs` owns only the tablist/tab/tabpanel ARIA relationship,
active-tab presentation, and bounded tab selection callback. `SettingsSection`
owns the repeated heading, description, and loading/degraded/unavailable status
semantics. `App` continues to own the selected tab state, all field values,
validation, API callbacks, focus trap/return, and secret-safe persistence.

The first composition keeps all existing settings controls but groups them into
Run, Tools, and Access panels. Inactive panels remain in the DOM with
`hidden`/`aria-hidden` so server-rendered copy and accessibility relationships
stay deterministic; no settings value is written to browser storage. The
presentational components do not import `api.ts`, create requests, or change
the daemon's settings authority. Focused tests cover tab semantics, panel
selection, status variants, bounded copy, and secret/path-free markup.
The focused Web gate now passes 94 tests, typecheck and production build; the
observed output is 82.52 KiB JS gzip and 6.06 KiB CSS gzip, within the phase
budgets.

### Phase 42d-1 implementation update (2026-08-05)

`SettingsTabs` now implements the bounded keyboard contract for the local
tablist: `ArrowLeft`/`ArrowUp` and `ArrowRight`/`ArrowDown` move to the
previous/next tab, while `Home` and `End` select the first/last tab. The
selected tab remains the only `tabIndex=0` control; focus is moved to the
newly selected tab without creating a request or changing any settings state
outside the explicit `onTabChange` callback. A pure resolver is covered by
unit tests so the behavior is deterministic without a browser test runner.

This slice does not claim screen-reader/manual, Playwright, contrast, or
physical-device evidence. Existing `hidden` panel, reduced-motion, safe-area,
ratio and 44px touch-target contracts remain unchanged.

### Phase 42d-2 implementation update (2026-08-05)

The repository now has a fixed `check:web` gate for the Web module. It reuses
the existing dependency-closure build/typecheck/focused-test runner, then
checks the generated JavaScript and CSS gzip budgets and runs `git diff --check`.
The script accepts no arbitrary shell fragments, does not invoke the full
workspace test suite, and never reads model credentials, browser storage,
workspace paths, or runtime event data. Bundle inspection is limited to the
generated `apps/web/dist/assets` files and returns bounded sizes for CI/local
diagnostics.

The final local run completed with 94 Web tests, JS 80.41 KiB gzip and CSS
5.90 KiB gzip under the 110/30 KiB budgets; `test:workflow` also passed its 31
script tests. Vite's informational asset line remains separately recorded by
the module build and is not used as a second gate.

The gate is a repeatable build/test contract, not visual or physical-device
evidence. Playwright, screen-reader/manual review, and real-device reports
remain later acceptance work.

## 9. 退出条件

本规格完成后：

1. Web 视觉和交互呈现一致的 shadcn 风格，同时保留 VibeGo 品牌；
2. conversation-first、ratio-first、Host-first 约束没有回退；
3. Settings、Approval、Goal、Memory、Sandbox 和 run event UX 由可复用组件承载；
4. 键盘、触摸、窄屏、长文本、错误和 degraded 状态都有测试；
5. API/daemon/AgentLoop/事件事实源不变；
6. Native Client 仍未实现，但 API/SSE 边界足以支持后续 Android/iOS/HarmonyOS。
