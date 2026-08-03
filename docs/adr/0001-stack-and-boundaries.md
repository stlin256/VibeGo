# ADR 0001：TypeScript 端到端与轻量本地 daemon

- 状态：Accepted
- 日期：2026-08-03

## 背景

需求同时提到 React、TypeScript、后端和多端 Web。React 本身是视图库，不能承担本地 agent daemon 的进程、shell、沙箱和存储职责；若把这些职责塞进 React/SSR，会增加常驻资源和安全边界复杂度。

## 决策

1. 使用 TypeScript 端到端；Node.js 22 LTS 作为 daemon 运行时。
2. Web 使用 React + Vite + PWA；默认生成静态资产，不要求 SSR。
3. daemon 使用 Fastify/Node HTTP 的薄适配层，核心 harness 不依赖 Fastify。
4. 采用 pnpm workspace monorepo，公共类型和 schema 位于 `packages/contracts`。
5. 使用 SQLite 或 append-only file adapter；通过 `Storage` port 保留未来迁移空间。
6. 核心 agent loop 为显式有限状态机，不使用隐藏的递归/无限自主循环。

## 取舍

- 相比 Next.js 全栈：少一个 SSR/Server Components 常驻层，部署更轻；代价是需要自己维护 API/SSE 合约。
- 相比 Python 后端：团队目标是 TS 端到端，且 MCP/React 生态直接；代价是某些 sandbox/ML 库需外部进程。
- 相比 Rust 全部重写：Node 首版更快迭代，且可复用成熟 TS SDK；代价是强隔离和极限性能需借助 OS/Docker，后续可替换单个 adapter。
- 相比复制 Codex：保留 thread、stream、resume、policy 等经过验证的概念，但不复制代码、提示词、协议私有实现或 UI。

## 影响

- 任何“React 作为后端”的解释都必须回到本 ADR 的边界；如需求坚持 React server，只能作为 daemon 的可选展示层。
- `packages/contracts` 的 schema 变更属于公共 API 变更，必须先更新文档和 contract tests。

