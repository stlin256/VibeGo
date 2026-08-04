# Spec 56：多语言、无障碍与真实设备兼容矩阵

- Status: Phase 56a implemented（locale/accessibility shell slice；full catalog and real-device evidence remain later）
- Date: 2026-08-04
- Related: [Spec 37](37-ratio-responsive-ui.md)、[Spec 38](38-conversation-first-web-shell.md)、[Spec 42](42-shadcn-style-web-design-system.md)、[Spec 52](52-capability-profiles-and-first-run-experience.md)、[研究记录](../research/53-57-release-install-model-operations-research.md)

## 1. 目标

把“响应式可用”升级为可验证的多语言、无障碍和真实设备发布标准。所有设备继续消费
同一个 REST/SSE API 和 conversation-first shell，不增加 device-specific backend、第二套
状态机或 UA sniffing。

首发语言为 `en-US` 和 `zh-CN`；首发 Web 目标为 WCAG 2.2 AA。更多语言、RTL 和原生移动端
可以在后续规格扩展，但不得破坏 message catalog、布局和 accessibility contract。

## 2. 国际化 contract

### 2.1 Locale 选择

优先级为：用户显式设置 → pairing/device session preference → 浏览器 `Accept-Language` →
`en-US` fallback。locale 设置是非 secret durable setting，只影响新 UI render，不改变
run/provider/Goal snapshot。

支持 `en-US`、`zh-CN` 的完整 catalog，catalog 未覆盖时显示稳定英文 fallback 和 telemetry-
free missing-key diagnostics；不能把 key 本身展示给用户。

### 2.2 文本与格式

- 所有用户可见文本、错误码说明、按钮、审批卡、引导和运维链接都使用 versioned message key；
- 不允许通过字符串拼接构造句子；使用 ICU plural/select/date/number/time formatting；
- 模型名、路径、hash、错误码等 user data 必须单独渲染并转义；
- 时间默认显示本地 timezone，同时提供 ISO/UTC 细节；金额、token、资源数值带 locale 和
  `unknown` 语义；
- 翻译文本长度变化不能裁剪 primary action、approval reason、Goal title 或 composer；
- 新增语言必须提供 catalog completeness、术语表、截图审阅和回滚，不允许机器翻译未经审阅
  直接进入 stable。

### 2.3 不在本阶段承诺

RTL、语音输入、原生 Android/iOS/HarmonyOS 翻译和第三方插件自带语言包不阻塞首发，但公共
component contract 不得假设英文长度、左到右或鼠标输入。

## 3. 无障碍目标

### 3.1 WCAG 2.2 AA 基线

覆盖感知、可操作、可理解、兼容性四类要求，至少包含：

- 完整键盘路径：New task、composer、run timeline、approval、settings、Goal、recovery；
- focus visible、focus trap、Dialog/Sheet Escape、关闭后 focus return；
- 所有 icon button 有 accessible name，状态用 `aria-live`/status region 传达但不重复刷屏；
- 颜色对比、非颜色信息、错误关联、表单 label、help/error text 和 required state；
- 44px-equivalent touch target、系统字体缩放、reduced motion、high contrast 和 dark/light；
- SSE/run streaming 在屏幕阅读器中不会不断抢焦点；用户可暂停自动滚动并回到最新事件；
- 长日志、tool output、Goal title 和模型响应可复制、折叠、搜索和水平滚动而不隐藏主操作；
- 不将颜色、动画、声音或 hover 作为唯一状态说明。

### 3.2 辅助技术矩阵

stable release 至少包含以下真实组合的手工 evidence：

| 平台 | 浏览器 | 辅助技术 |
| --- | --- | --- |
| Windows 11 | Edge/Chrome | NVDA + keyboard-only |
| macOS | Safari | VoiceOver + keyboard/trackpad |
| iOS/iPadOS | Safari | VoiceOver + Dynamic Type |
| Android | Chrome | TalkBack + system font scaling |

自动化 axe/ARIA 检查只能作为早期门禁，不能替代人工 screen reader、键盘、焦点和缩放验收。

## 4. 真实设备与比例矩阵

### 4.1 自动 emulation

使用 Playwright projects 覆盖以下 CSS/输入变量；每个 project 运行 pairing、New task、
conversation、approval、settings、Goal、recovery、SSE reconnect 和 error state：

| 变体 | 代表 viewport/比例 | 输入/方向 |
| --- | --- | --- |
| Desktop wide | 1440×900、1920×1080、21:9 | mouse + keyboard |
| Portrait desktop | 900×1440、3:4 | mouse + keyboard |
| Phone | 320×720、390×844、9:19.5 | touch，portrait/landscape |
| Fold cover | 360×800 | touch，portrait |
| Fold unfolded | 673×841、5:4 左右 | touch，hinge/safe-area fixture |
| Wide fold | 884×2208、约 2:5 | touch，single/two-pane |
| Tri-fold | 768×2048、约 3:8 | touch，three-segment safe-area fixture |
| Tablet | 768×1024、1024×1366 | touch，portrait/landscape |

这些是 layout fixtures，不得被标记为“真实设备通过”。Viewport 只验证布局和交互，不验证
相机、键盘、浏览器权限或厂商 WebView 差异。

### 4.2 真实设备最低矩阵

每个 stable candidate 至少记录：

- Windows 11 x64：Edge、Chrome；
- macOS arm64：Safari、Chrome；
- iPhone 当前支持版本：Safari；
- Android 主流手机：Chrome；
- iPad：Safari；
- Android 平板：Chrome；
- 一台内折/外折设备：cover/unfold、hinge、输入法和 safe-area；
- 一台宽折叠或三折叠设备（若实验室不可得，必须标为 `unverified`，不能用模拟结果替代）。

兼容矩阵中的结果值固定为 `pass | pass-with-known-issue | degraded | blocked | unverified`，
并记录 OS、browser version、viewport、locale、input mode、build revision、截图/录屏引用
和 issue id。截图/录屏默认脱敏，不包含 token、API key、workspace path、raw transcript。

## 5. Ratio-first UI 约束

- 使用 CSS container/query、safe-area 和可用空间；禁止 UA/device sniffing；
- composer、primary action、approval allow/deny、cancel、reconnect 和 recovery action 在
  所有变体都必须可达；
- 三栏桌面、双栏平板、单栏手机可以是布局变体，但 API client、event ordering、权限和
  错误语义相同；
- 折叠/三折叠以分段可用宽度渲染，不能把 hinge/折痕下的按钮当作安全区域；
- 系统字体放大 200% 和横屏/旋转后不得产生不可恢复的 horizontal scroll；
- 长文、错误、审批和离线状态都要有 empty/loading/degraded/blocked variant。

## 6. 性能与可观察性门禁

- 首屏、composer 可交互、SSE 首事件和 settings sheet 打开分别记录 cold/warm 指标；
- locale catalog 按需加载，默认包不重复包含未选语言；
- 无障碍树和实时事件节点有 bounded 数量，长运行不无限增长 DOM；
- 低端移动设备断网、恢复、后台切换和旋转不会重复提交 run 或 approval；
- 性能报告只包含版本、viewport、耗时和 bounded counter，不包含用户内容。

## 7. 测试与验收

- message catalog schema、未知 key、plural/select、RTL-safe layout placeholder、超长翻译和
  locale fallback；
- keyboard-only、focus return、Escape、screen reader、contrast、reduced motion、font scale；
- Playwright desktop/tablet/mobile/fold/tri-fold fixture，真实设备手工矩阵和每次 release 的
  compatibility report；
- Chrome、Edge、Firefox、Safari/WebKit 的 run/SSE/approval/reconnect/streaming；
- 320px 宽、200% 字体、横屏、低带宽和触摸输入下 primary action 仍可达；
- 与模型、MCP、memory、certificate 故障组合时，UI 显示 bounded degraded/blocked，不泄露 raw error；
- 首发语言由母语审阅者确认，stable release 不接受未审阅的关键安全/审批/恢复文案；
- `pnpm typecheck`、受影响 Web tests、visual/accessibility tests、`pnpm verify` 和 `git diff --check`。

## 8. 明确不做

- 不使用 UA sniffing、设备专用后端或复制多套 conversation state；
- 不把 emulated viewport 说成真实设备兼容；
- 不以自动 axe 通过代替人工辅助技术验收；
- 不在本阶段实现原生移动客户端、语音助手或完整 RTL 设计系统；
- 不将截图、录屏、屏幕阅读器日志或性能 trace 中的 secret/raw transcript 纳入仓库。

## 9. Phase 56a implementation update（2026-08-05）

Phase 56a 先把 locale 和 accessibility 的运行时边界落到现有
conversation-first Web shell，不新增 daemon API、device-specific backend 或第二套
状态机：

- `Locale` 只允许 `en-US | zh-CN`。显式 Web 偏好优先，其次是浏览器语言，最后回退
  `en-US`；pairing/session preference 和更多语言后置。
- locale 偏好使用独立的 `vibego.locale.v1` 非 secret browser-storage key，不能与
  `RunProfile`、pairing token、credential、run/Goal event 或 URL 混用；损坏、超长或
  secret-shaped 值 fail closed 到 `en-US`。
- 初始 catalog 覆盖品牌、New task、composer、connection、settings、approval、error
  status 和可见的 icon/button accessible name。缺少 key 必须使用稳定英文 fallback，不能
  把 message key 本身展示给用户。
- 根节点同步 `lang`，语言切换不重建 run、provider、Goal 或 SSE；当前 run 和草稿保持不变。
- 核心状态区使用 bounded `aria-live`，icon-only controls 有 accessible name，primary
  actions 保持键盘可达；focus-visible、reduced-motion 和 44px touch target 由 CSS/DOM
  focused tests 门禁。
- Phase 56a 只声明 emulated viewport contract，不能把它当作真实设备通过；Playwright
  projects、屏幕阅读器人工证据、完整翻译审阅和三折叠实验室证据属于后续 Phase 56b/56c。

`apps/web` now provides the bounded locale adapter, dedicated storage key,
root-document `lang` synchronization, language selector, core shell catalog and
live-status landmark. Web-focused tests cover locale precedence, invalid/secret-
shaped storage values, reset behavior, translated rendering and privacy-safe
Chinese shell output; the existing ratio/reduced-motion CSS gates remain in
place. This slice does not claim full catalog coverage or real-device pass.
Unknown runtime message keys use a stable English `Unavailable` fallback rather
than rendering the key itself.

## 10. Phase 56b implementation boundary（2026-08-05）

Phase 56b extends the same Web-only boundary with a focus contract and a
bounded settings catalog:

- The Settings drawer is a semantic dialog. Opening it focuses the close
  action; `Tab`/`Shift+Tab` cycle only through enabled controls inside the
  drawer; `Escape` closes it; closing returns focus to the button that opened
  it. Focus behavior must be deterministic when the drawer has no optional
  provider/tool cards.
- The settings trigger exposes `aria-controls`, `aria-expanded`, and a dialog
  relationship; the drawer exposes `role=dialog`, `aria-modal=true`, and a
  stable labelled heading. The shortcut for New task remains visible to
  assistive technology without intercepting text input.
- Core settings/guardrail labels and actions use typed message keys in both
  supported catalogs. Runtime fallback remains stable English and never emits
  a key, raw error, path, or secret.
- Focus helpers are pure and bounded in unit tests; DOM rendering tests assert
  the semantic landmarks. This phase still does not claim screen-reader/manual
  pass, visual regression pass, or real-device compatibility.
