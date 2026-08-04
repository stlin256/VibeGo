# ADR 0010：Host-first 同源 Web 与后续客户端边界

- 状态：Accepted（设计决策；实现按 Spec 41 分阶段落地）
- 日期：2026-08-04
- 相关规格：[Spec 41：Host-first 发行、同源 Web 与后续客户端边界](../specs/41-host-first-distribution-and-client-boundary.md)

## 背景

VibeGo 的资源、workspace、模型凭据、SQLite 事件、AgentLoop、审批和沙箱都属于用户
主要开发主机。远程使用的核心需求是：用户在另一台电脑、手机或平板上直接打开一个
网址，继续使用主机上的 agent，而不是在远程设备上安装一套后端。

当前仓库的 React Web 在开发时通过 Vite 独立运行，daemon 负责 API。这种拆分适合源码
开发，但如果把它作为最终部署方式，就会引入双进程、跨域、端口、反向代理和 Node 环境
配置，违背低资源和开箱即用目标。

同时，未来仍可能需要 Android、iOS、HarmonyOS 客户端。现在直接编写这些客户端会冻结
尚未稳定的 API、事件和设备会话，也会把执行状态复制到多个终端。

## 决策

### 1. Host 是唯一执行事实源

VibeGo 发行版以一个 Host 为中心：daemon 负责后端和编译后的 React Web 静态资源。
生产环境的默认入口是同源 URL；远程浏览器只需要访问该 URL。AgentLoop、RunManager、
Scheduler、Approval、Sandbox、WorkspaceRegistry、`run_events` 和 `goal_events` 均只在
Host 上拥有权威地位。

### 2. Web 是默认远程客户端，原生客户端后置

Web/PWA 覆盖桌面、手机、平板和折叠屏。Android、iOS、HarmonyOS 原生客户端不进入
当前 MVP；未来客户端必须使用同一套版本化 REST/SSE、pairing 和 device session，不能
访问 Host 文件系统或复制执行状态机。

### 3. 生产 daemon 托管 Web

daemon 生产模式提供 `/`、`/assets/*`、`/api/v1/*` 和 SSE；开发模式可以保留独立 Vite
端口。生产默认同源，从而不需要 CORS 或用户维护反向代理。SPA fallback、静态资源缓存、
路径遍历保护和 API 路径隔离属于 daemon 的测试边界。

### 4. 发行包内置运行时，配置由 Web 引导

正式发行包携带匹配平台的 Node runtime、daemon、Web dist 和版本 manifest。用户不需要
预装 Node/pnpm。模型、workspace、sandbox 和记忆设置通过认证 Web 引导完成；secret 只
使用平台 secret store 或进程内存 fallback。LAN 仍默认关闭，TLS 和 pairing 是必要门禁。

### 5. Transport 可替换但不改变权限

loopback 是默认 transport；LAN 是显式 TLS transport；Tailscale、SSH 和用户反向代理是
后续 transport adapter。任何 transport 都不能绕过同一个 AuthGate、Approval、Sandbox
或 Workspace 边界。

## 被拒绝的方案

### 生产环境要求用户单独部署 Web server

拒绝作为默认路径。它会让用户管理两个进程、两个端口和 CORS/反向代理，并不符合“打开
网址即可用”的目标。专业运维仍可使用反向代理，但这不应成为普通用户前置条件。

### 现在直接实现三套原生客户端

拒绝。客户端会放大 API、事件、身份和推送兼容成本；先把 Host/Web/API/SSE 合约稳定，
再实现共享 SDK 和原生 UI。

### 使用 Electron 作为唯一发行容器

拒绝作为默认方案。Electron 会引入较高常驻资源和更大的发行包；第一阶段采用内置 Node
runtime + Host launcher，未来如需要桌面原生体验再评估 Tauri 或平台壳层。

### 为每个平台复制一套 AgentLoop 或本地数据库

拒绝。这会产生多个执行事实源、重复审批和状态冲突，也违反单用户 Host 权威边界。

## 后果

### 正面

- 用户只部署一个 Host，远程设备只打开 URL；
- 同源访问消除普通用户的 CORS、Vite、反向代理配置；
- 主机低资源模型保持不变：Node daemon + SQLite + 静态 Web；
- Web 和未来原生客户端共享 API/SSE 合约；
- 所有安全决策和运行状态仍集中在主机，便于审计和回滚。

### 代价

- daemon 需要增加静态文件托管、SPA fallback、缓存和路径安全实现；
- 需要维护 Windows/macOS/Linux 的 launcher、打包、签名和更新链路；
- 平台 secret store、证书和 sandbox 能力仍存在差异；
- 原生客户端必须等待 Host/API 合约稳定，不能与 Web MVP 并行无限扩张。

## 迁移与实施顺序

1. 先实现 daemon 同源托管 `apps/web/dist` 和一个 URL 的 preview smoke test；
2. 再增加统一 dev/start 命令，明确开发模式与 release 模式；
3. 再制作内置 Node runtime 的 Windows/macOS/Linux Host 包；
4. 再加入 LAN TLS、QR pairing、平台 secret store 和签名更新；
5. 最后提供版本化 TypeScript client SDK，并开始 Android/iOS/HarmonyOS 客户端。

### Spec 51-R1 static serving gate (2026-08-05)

The first implementation slice adds an optional absolute Web dist directory
to the daemon. Only `GET`/`HEAD` static requests are resolved; API, health and
SSE routes stay outside the resolver and keep the existing AuthGate. The
resolver performs percent-decoded traversal/control-character checks,
rejects symlink/directory escapes, serves SPA fallback only for extensionless
paths, and applies `no-store` to `index.html` plus immutable caching to hashed
assets. A missing build returns a bounded unavailable response and never
exposes a host path or source checkout file. This slice does not add a
launcher, CORS, native client or second Web server.

The R1 implementation is now present in `apps/daemon/src/static-web.ts` and
the daemon composition passes `apps/web/dist` (overridable by
`READY4VIBE_WEB_DIST_DIR`). Its four fixture tests pass alongside the daemon
regression suite; no run/event/auth authority changed.

### Spec 51-R2 launcher boundary (implemented 2026-08-05)

This slice is deliberately a dependency-free Node launcher module. It may
resolve a per-user data directory, reserve a bounded loopback port, spawn the
existing daemon by argv, wait for a listening endpoint, print a relative-safe
Host URL, and optionally open a browser only when explicitly requested. A
non-secret PID lease prevents duplicate starts; stale leases are removed only
when the recorded PID is no longer alive. Child output is redacted before it
is forwarded, and stop/restart uses a process-group/Windows process-tree
adapter selected by platform.

The launcher does not enable LAN, weaken TLS/pairing, read or write workspace
files, persist credentials, install a runtime, or create any new execution or
event authority. `scripts/host-launcher.test.mjs` passes eight lifecycle tests
covering platform paths, permissions, port discovery, PID lease cleanup,
redacted logs, process-tree shutdown and disposable start/restart/stop.
Packaging, signing, updates and rollback remain later release specs.

### Spec 51-R3a certificate readiness boundary (implemented 2026-08-05)

The certificate adapter first exposes a read-only readiness projection derived
from the existing in-memory `CertificateStatus` and transport requirement. It
can classify optional loopback HTTP, required-but-missing TLS, expiry and
bounded SAN/hostname mismatch without reading files in the Web request path.
The projection contains no PEM, private-key bytes or paths and is served only
behind the existing AuthGate/CSRF/Origin boundary. ACME, OS certificate stores,
reverse proxies, renewal and rollback remain explicit R3b adapters. The
certificate package has eight focused tests; the daemon route is covered by
the focused regression suite (152 daemon tests) and remains read-only.

## 不变的事实源

此 ADR 不修改或替换：

- `run_events`、`goal_events`；
- AgentLoop、RunManager、Scheduler；
- Approval、Sandbox、WorkspaceRegistry；
- Goal Control 的 `shouldRun`、claim、evidence 和 quota 规则；
- TencentDB Memory 的可选、bounded、fail-soft 边界。
