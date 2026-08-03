# Spec 13：React/TypeScript 多端 Web/PWA 最小界面

**状态：Accepted（MVP run console；不替代 daemon 安全边界）**

## 目标与约束

- `apps/web` 是 Vite + React + TypeScript SPA，桌面/平板/手机共用一套组件；不引入 SSR、
  常驻 Node UI server 或重量级状态库；
- 默认 same-origin 访问 daemon，支持配置 API base URL 供后续 Tailscale/SSH tunnel；
- token、CSRF token 只在内存保存，刷新页面需要重新 pairing；禁止 localStorage、cookie、URL
  query 保存 Bearer；
- UI 只展示 safe API 字段和事件 payload，不显示 API key、完整环境变量或未授权绝对路径；
- SSE 用 `fetch` + `ReadableStream`，每次请求带 `Authorization`/`Last-Event-ID`，断线按 seq
  resume；不使用无法附加 Bearer header 的原生 `EventSource`。

## MVP 页面

- Connection/Pairing：健康状态、transport/TLS/auth 摘要、一次性 pairing code 输入；
- Run composer：workspace、消息、模型、sandbox/approval 的最小选择，提交后显示 run id；
- Run console：状态、队列位置、活动并发数、workspace lease、模型文本增量和错误；
- Cancel：只发送 API cancel，不在浏览器本地伪造终态；
- mobile-first：窄屏单列，宽屏两栏；点击目标最小 44px；支持 `prefers-reduced-motion`；
- 未认证状态不尝试创建 run；API 错误显示稳定 code 与脱敏 message。

## API client contract

- `ApiClient` 统一注入 `fetch`，便于单测和未来 desktop/native adapter；
- `completePairing` 返回 token 后仅写入内存 session；`createRun/getRun/cancel/streamEvents` 自动
  加 Bearer，写请求在存在 CSRF token 时加 `X-CSRF-Token`；
- `streamEvents` 解析 SSE 的 `id/event/data`，忽略 heartbeat，按 seq 去重并在 terminal event
  后结束；畸形 JSON/断流交给 UI 显示可重试错误；
- API client 不打印请求 headers/body，不把 token 放进错误对象或 telemetry。

## 测试门禁

- API client 测试覆盖 pairing、Bearer/CSRF header、SSE replay/terminal、401 和断流；
- React server-render smoke test 覆盖未连接、连接中、run console 和移动布局语义；
- `pnpm typecheck`、`pnpm test`、`pnpm build` 通过，浏览器端不发真实模型请求。
