# 产品范围与非目标

**状态：Accepted（文档阶段）**

## 一句话定义

`ready4vibe` 是运行在开发机上的轻量 daemon：它负责安全地驱动一个可恢复的 coding agent loop，并通过受保护的 HTTP/SSE 接口让桌面、平板和手机浏览器远程观察、输入、审批和停止任务。

## 核心用户故事

1. 在 coding 主机上启动 daemon，选择一个 Git workspace 和模型配置。
2. 在任意设备打开 Web UI，创建任务并输入目标。
3. agent 读取受限上下文，提出计划，按策略调用工具。
4. 低风险只读操作自动批准；写文件、网络、安装依赖等操作进入审批队列。
5. 用户在手机上批准/拒绝/取消，实时看到模型、工具、diff、测试和错误事件。
6. 网络短暂断开后，重新连接仍能从最后事件序号恢复，不丢任务状态。
7. 用户可导出运行记录、diff 和审计信息，便于复盘或提交 Git。

## MVP 必须具备

- 单主机、单 daemon、单用户；
- 默认 loopback，用户显式开启后允许局域网访问；Tailscale/SSH 作为后续 transport 扩展；
- OpenAI-compatible 模型适配器，另留本地模型适配接口；
- 可取消、可超时、可限步数的 agent loop；
- 上下文追加日志、预算、压缩和恢复；
- 只读文件、受限写文件、patch、Git 状态和 shell 工具；
- Codex-like 的 allow/prompt/forbidden 执行策略、精确会话 grant、自动审查（可选）、人工审批、拒绝和审计；
- workspace 路径边界、命令超时、输出截断和进程取消；不可信任务必须使用可验证 external sandbox；
- MCP client 与 Skill loader 的最小接口（可在 MVP 后打开）；
- React + TypeScript 响应式 PWA，支持桌面三栏、平板双栏、手机单栏；
- HTTP JSON + SSE 事件流、token 认证、连接恢复；
- 每个模块的单元测试，以及至少一条 fake-model 端到端 harness 测试。

## 明确非目标

- 不做云端多租户、团队 RBAC、计费和托管模型；
- 不做 IDE 插件、原生桌面壳或协同编辑器；
- 不默认执行任意网络请求、安装软件、修改系统设置；
- 不保证仅靠 Node 进程实现强安全隔离。高风险/不可信任务必须使用 Docker/VM 等外部沙箱；
- 不复制 OpenAI Codex、OpenHands 或其他项目的源代码、提示词、私有 API 或 UI；
- 不把“自动审批”实现成无条件 yes。自动审批只能作用于明确的低风险规则。

## 成功指标（先定义，后实测）

| 指标 | MVP 目标 | 测量边界 |
| --- | --- | --- |
| daemon 冷启动 | p95 ≤ 2 s | 已安装依赖、无模型请求 |
| 空闲内存 | ≤ 120 MB RSS | 不含浏览器、模型服务和可选 Docker |
| 本地事件延迟 | p95 ≤ 200 ms | tool/event 写入到 SSE 客户端收到 |
| UI 首屏 | ≤ 250 KB gzip（编辑器懒加载） | 不含 Monaco 等可选重组件 |
| 关键包测试覆盖率 | 行/分支 ≥ 80%，安全与策略 ≥ 90% | Vitest/覆盖率报告 |
| 任务可恢复率 | 断线重连不丢事件序号 | fake-model + SSE 重连测试 |

这些是验收目标，不代表当前已经达到；每个版本必须附测量命令和结果。
