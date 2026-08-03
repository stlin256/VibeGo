# Web/PWA 多端体验与适配

**状态：Accepted（文档阶段）**

## 体验原则

1. 手机上最重要的是“看到状态、批准/拒绝、取消、继续输入”，不是把桌面 IDE 缩小。
2. 所有危险操作先展示可读摘要，再展示可展开的原始参数/diff；误触有撤销或二次确认。
3. 连接状态、沙箱等级、模型、当前 workspace 和权限始终可见。
4. 时间线以事件为事实来源，模型文本、工具输出和用户操作视觉分层。
5. 没有网络时不伪造“运行中”；显示最后收到的 seq、连接时间和恢复按钮。

## 信息架构

- **Runs**：任务列表、状态、workspace、最近事件、未处理审批徽标；
- **Run detail**：目标、计划、时间线、模型流、工具调用、测试、diff；
- **Approval center**：待审批队列，按风险、过期时间和 workspace 分组；
- **Workspace**：允许的路径、Git 分支/dirty 状态、沙箱能力；
- **Settings**：模型 provider、策略、远程配对、事件保留、主题和语言；
- **Diagnostics**：daemon health、版本、sandbox 能力、导出审计（只读）。

## 响应式断点

| 设备 | 断点 | 布局 | 默认交互 |
| --- | --- | --- | --- |
| 桌面 | ≥ 1200 px | 三栏：runs / timeline / inspector | 键盘快捷键、可并排 diff/终端 |
| 平板 | 768–1199 px | 双栏：主内容 + 可折叠 inspector | 横屏优先，审批从右侧 drawer 展开 |
| 手机 | < 768 px | 单栏 + bottom sheet | 大触控目标、固定 composer、审批可一手完成 |

断点只改变布局，不改变 API、事件语义和权限。横屏/竖屏切换不能丢输入草稿或事件游标。

## 核心组件合约

- `RunList`：分页、状态过滤、未读审批计数；不得依赖全量事件。
- `EventTimeline`：按 `seq` 稳定排序；未知事件可折叠；长输出虚拟化/分页。
- `ApprovalCard`：展示 tool/version、风险、workspace、路径、网络、参数摘要、过期时间、diff；拒绝必须可填写原因。
- `Composer`：发送文本、取消生成、重试失败输入；移动端用安全区 padding 和 IME 适配。
- `DiffViewer`：默认摘要，按文件展开；禁止把 diff 当作已经提交的事实。
- `ConnectionBanner`：连接中、已断开、恢复中、事件窗口过期四种状态；显示 last seq。
- `TerminalOutput`：只读输出；交互式终端属于后续 WebSocket 能力，不在 MVP 假装支持。

## 连接与缓存

- 首选 `fetch` + SSE；浏览器恢复时使用 `Last-Event-ID`，并以 run snapshot 校正状态。
- Service Worker 只缓存静态 JS/CSS/icon；不缓存源码、事件、token 或 API 响应。
- access token 仅存内存；刷新页面需通过受保护的 pairing/session 流程重新获取，不写 localStorage。
- 前端状态可用轻量 store；事件 reducer 必须幂等，重复 seq 不得重复展示。

## 可访问性与国际化

- 遵循 WCAG 2.2 AA：键盘可达、焦点陷阱、颜色之外的风险标识、减少动效、屏幕阅读器 live region；
- 审批按钮不能只依赖颜色；R3/R4 用文本和图标说明；
- 中英文文案从 message key 读取，事件原始 code 不直接展示给用户；
- 长命令、路径和 diff 支持复制，但复制前不把隐藏 secret 注入剪贴板。

## 视觉/交互安全约束

- UI 不允许把“模型建议”“工具已执行”“文件已提交”混为同一种状态；
- 未认证、未知 workspace、sandbox 能力不足时，创建 run 按钮必须禁用并解释原因；
- 审批 drawer 关闭不等于批准；过期审批自动变为 denied/expired；
- 错误页面只显示 safe details，并提供 correlationId，不显示 stack、env 或 provider 原始响应。

## 验收场景

1. 桌面创建 run，手机打开同一 run，手机审批后桌面时间线按 seq 更新；
2. 手机锁屏/断网，daemon 继续运行，恢复后补发缺失事件；
3. 平板旋转屏幕，composer 草稿、审批内容和事件游标不丢；
4. 键盘只操作整个审批流程，屏幕阅读器能读出风险和结果；
5. PWA 离线只显示静态 shell，不显示伪造的运行结果或旧 token。

