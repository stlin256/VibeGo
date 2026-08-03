# Spec 35：Web Goal 只读投影

**状态：Implemented**

**日期：2026-08-03**

## 目标

把 Phase 1 daemon 的 Goal projection 以低资源、响应式的方式接入现有
React/Vite 控制台，让单用户可以在桌面、平板和手机上查看长期目标的当前状态，
同时保持 Goal Control 只是只读观察面：

- 使用现有 `ApiClient`、pairing、Bearer 和 CSRF 会话；
- 只调用 `GET /api/v1/goals`，不把 Goal 写操作接入 UI；
- 不创建第二个状态源，不把 Goal payload 写入浏览器 storage、URL 或 prompt；
- 不启动 Goal SSE、scheduler、model、tool、shell、Git、MCP 或 sandbox；
- 未绑定 run 和显式 interactive run 的行为完全不变。

## 用户体验

连接 daemon 后，Web 首屏在现有 run console 附近显示 `GOAL CONTROL` 卡片：

1. loading：显示轻量占位，不阻塞 run composer；
2. unavailable：Goal store/API 不可用时显示安全提示，仍可正常创建 interactive run；
3. empty：没有 Goal 时显示“尚未创建长期目标”，不提供伪造的创建按钮；
4. ready：显示每个 Goal 的标题、status、objective 摘要、Todo 完成进度、blocking
   Gate、最近 Evidence、quota spend、control revision 和 projection checksum；
5. refresh：提供显式刷新按钮；run 终态刷新 Goal projection，但不轮询或启动第二个
   SSE 连接。

单用户 MVP 可以同时显示多个 Goal，默认按 daemon 返回顺序渲染；未来增加 Goal
选择器时不改变 API 合约。

## Web API contract

`apps/web/src/api.ts` 增加只读类型和方法：

```ts
interface GoalProjectionListResponse {
  schemaVersion: 'ready4vibe_goal_api_v0';
  goals: readonly SafeGoalProjection[];
}

interface GoalApi {
  listGoals(): Promise<GoalProjectionListResponse>;
}
```

`ApiClient` 继续只在内存中保存 pairing session。Goal response 不进入
`localStorage`；client 不接受或拼接 query token。

## 显示与隐私边界

daemon 已在 API 边界移除 `claimTokenHash`。Web 组件仍采用防御性显示策略：

- 不显示 `claimTokenHash`、任何 token、API key、环境变量或绝对路径；
- 只显示 `workspaceId`（若存在），不显示 daemon root；
- 每个 Goal 最多显示 12 个 Todo、8 个 Gate、8 个 Evidence，超出时显示计数；
- 文本使用 React 文本节点渲染，不使用 `dangerouslySetInnerHTML`；
- `objective`、Gate question、Evidence summary 均保留 bounded 文本，不复制完整
  transcript、tool output 或 run event；
- quota 只显示 projection 已记录的 spend，不把它解释为 scheduler 容量或权限 grant。

## 响应式与低资源约束

- 桌面端 Goal 卡片与 run console 并列；窄屏自动单列；
- 不引入图表库、编辑器或常驻连接；
- 使用现有 CSS token 和原生布局，首屏不增加新的网络请求（复用一次 goals GET）；
- loading/unavailable/empty/ready 四种状态都必须可读且可操作；
- refresh 按钮在请求期间禁用，避免重复请求。

## 测试与验收

### API client

- `listGoals()` 使用认证 GET 路径；
- URL 不包含 token、secret 或绝对路径；
- API 错误映射为现有 `ApiError`，不泄露 response internals。

### React

- ready 状态显示 Goal、Todo、Gate、Evidence 和 quota 摘要；
- empty/unavailable/loading 状态安全降级；
- claim hash、绝对路径和 HTML 片段不出现在渲染结果；
- Todo/Gate 没有写按钮，interactive run composer 仍可见；
- 窄屏布局使用既有媒体查询，不引入第二套页面 shell。

### 完成门禁

- `pnpm typecheck`、`pnpm test`、`pnpm diff:check` 通过；
- Web 当前覆盖 33 项单元测试；Goal API 只读 client、面板和现有 App 回归均通过；
- 文档与实现状态同步；
- 不修改 `run_events`、AgentLoop、RunManager、Scheduler、Approval 或 Sandbox；
- 独立 Git 提交并推送后，再进入 Goal write API 或 Phase 2 governed preflight 设计。

## 明确不做

- Goal 创建、Todo claim、Gate resolve、completion 或 quota spend；
- Goal SSE、后台 polling、第二个 scheduler 或 LoopX dashboard；
- 把 Goal 状态注入用户 prompt；
- 任何自动执行、模型调用、工具调用或 workspace 写入。
