# Spec 61：用户可见文档质量、README 与开箱即用说明

- Status: Draft（文档质量规格；不改变运行时）
- Date: 2026-08-05
- Scope: `README.md`、`README-zh.md`、`docs/README.md`、Quickstart、Security、
  Operations、Troubleshooting、Contributing、Changelog/Release notes、品牌资产和
  用户可见的配置/权限/发布说明
- Related: [Spec 25：Configuration onboarding](25-configuration-onboarding.md)、
  [Spec 38：Conversation-first Web shell](38-conversation-first-web-shell.md)、
  [Spec 41：Host-first distribution](41-host-first-distribution-and-client-boundary.md)、
  [Spec 52：Capability profiles](52-capability-profiles-and-first-run-experience.md)、
  [Spec 55：Public deployment and certificates](55-public-deployment-certificates-operations.md)、
  [Spec 60：Complete verification](60-complete-verification-and-release-evidence.md)、
  [ADR 0010：Host-first Web boundary](../adr/0010-host-first-same-origin-web-and-client-boundary.md)、
  [ADR 0003：LAN access and approval](../adr/0003-lan-access-and-codex-like-approval.md)

## 1. 目的

VibeGo 的 README 和用户可见文档必须让一个不了解仓库历史的人，能够在不猜测、不手工
编辑危险配置、不接触 secret 的情况下回答以下问题：

1. VibeGo 是什么，适合谁，当前能做什么，明确不能做什么；
2. 如何在约五分钟内安装依赖、启动 daemon、打开 Web、完成 pairing 并创建第一条对话；
3. 如何在 Web 设置中配置 workspace、模型、权限、审批和远程访问；
4. `workspace-coding`、`full-host`、untrusted task、sandbox 和 network 的安全边界；
5. 当前哪些能力是实现、partial、后置或 blocked，如何验证而不是相信宣传；
6. 出错时看哪里、如何撤销授权、如何备份/恢复、如何安全报告问题和参与贡献。

本规格是独立文档规格，不把内容追加到 Spec 52。文档必须服从实际代码、测试和
Spec 60 evidence；如果三者冲突，先降低文档中的能力声明并开 issue/补文档，再修改实现。

## 2. 强制前置复核门禁（61-0）

Spec 61 是所有用户可见说明的收尾门禁，不是绕过前置实现缺口的文案任务。在开始
任何 `61-1` 之后的 README、Quickstart、运维说明或发布文案修改前，主线程必须重新
核实此前所有 Spec 是否已经完成：

1. 阅读当前 Spec 01–60、相关 ADR、`architecture.md`、`harness-contracts.md`、
   `implementation-status.md`、`roadmap.md` 和 Spec 60 evidence；不能只依据旧的
   README、测试数量或其他 Agent 的总结。
2. 执行 `git status --short --branch`、`git diff`、`git diff --cached`，记录当前
   commit、branch、remote、Node/pnpm 版本和 workspace graph；保留 dirty worktree，
   不得 reset、clean、checkout、覆盖或提交无关改动。
3. 建立 `Spec/ADR → 源码 → focused/full test → real evidence → 状态` 矩阵。每个
   必需阶段只能标记为 `verified`、`implemented`、`partially implemented`、`blocked`
   或 `not applicable`；`partially implemented`、`blocked`、`not-run` 不得被 README
   改写成完成。
4. 在 Web 发布目标范围内，Spec 01–60 的所有必需阶段必须为 `implemented/verified`。
   明确后置的原生客户端或其他非 Web 目标只有在发布范围中写出“不适用”、给出理由并
   保留后续入口后，才能不阻断 Spec 61；任何必需能力的 `partial/blocked` 都必须先
   回到对应 Spec 实施，不能继续用文档掩盖缺口。
5. 重新核对 Spec 60 的 full evidence bundle、真实 LLM、Goal governed、权限/审批、
   sandbox、并发/恢复、传输/证书和 release evidence 是否对应同一个 commit；缺少
   真实证据时，先记录阻断并停止 61-1～61-6。
6. 将复核结果写入 `docs/reports/61-0-prerequisite-audit-YYYY-MM-DD.md`，同步
   `implementation-status.md` 和 `roadmap.md`，再以独立 Git 提交记录。复核报告必须
   列出每个未完成项的 owner、回退 Spec、阻断原因和重新验收命令。

该门禁通过后，Spec 61 才能进入用户文档编辑阶段；它的目标是让文档成为已完成产品
的准确收尾，而不是把“规划完成”误报成“产品完成”。

## 3. 文档真相与用户分层

### 3.1 Canonical truth

- 根 README 是公开入口，英文优先；`README-zh.md` 是中文等价入口，不得比英文版声称
  更多能力；
- `docs/README.md` 是规格/ADR/研究索引，不能被当作用户 Quickstart；
- 实现状态只从 `docs/implementation-status.md`、Spec 60 evidence 和可重现命令导出；
- 每项能力必须标记为 `Implemented`、`Preview`、`Partial`、`Planned` 或 `Blocked`，
  禁止使用“支持”而不说明范围、默认状态、真实证据和已知限制；
- 所有版本、命令、路径、端口、环境变量、浏览器 URL 和测试数量必须在发布前重新验证，
  不复制旧报告中的过期数字；
- 用户可见文档不得泄露 API key、token、cookie、私钥、完整环境变量、真实用户路径、
  raw command、完整 transcript 或内部主机信息。

### 3.2 四类读者

| 读者 | 主要任务 | 文档入口 |
| --- | --- | --- |
| First-time user | 安装、启动、创建第一条对话 | README Quickstart |
| Local/LAN operator | pairing、TLS、workspace、权限和撤销 | Security/Operations |
| Developer/contributor | workspace scripts、模块测试、架构和提交纪律 | CONTRIBUTING + docs |
| Evaluator/releaser | 能力边界、evidence、版本、安装/升级/回滚 | Status + Release docs |

## 4. README 信息架构

根 `README.md` 和 `README-zh.md` 必须保持以下顺序，首屏只讲价值和当前状态，不把
设置表格或巨大 Logo 当作产品界面：

1. **品牌横幅与一句话价值主张**：使用现有 VibeGo banner/mark，包含可读 `alt`，宽度
   受限，不能重复堆叠巨大 logo；明确“local-first agent harness + remote Web console”。
2. **项目状态横幅**：写清 `internal-preview`/`release-candidate`/`blocked`，列出已实现、
   partial、后置和不支持项；不能把规划规格写成完成。
3. **Why / Who / Non-goals**：说明单用户、本地优先、远程 Web、无原生客户端也可用，
   以及不提供默认全主机机器人、不绕过审批/Goal/quota/安全策略。
4. **五分钟 Quickstart**：前置 Node/pnpm/OS，安装、启动 daemon、打开 URL、pairing、
   在 Web 中选择 workspace/模型并发送第一条对话；每条命令可复制、可验证、可清理。
5. **First-run 与配置向导**：以 Web Settings 为主路径，说明非 secret 设置在哪里配置；
   手动编辑配置文件只能是开发者/故障恢复的后备方式，不能是普通用户唯一入口。
6. **日常使用**：New task 一键创建对话、composer、运行时间线、审批卡、取消、恢复、
   Goal 只读/受控操作、移动端和折叠屏的基本操作。
7. **权限与安全**：默认安全 profile、`workspace-coding` bounded-auto、显式 `full-host`
   与 session-auto、untrusted fail-closed、network/MCP/Skill 独立开启、revoke/expiry。
8. **模型与真实运行说明**：列出 provider 类型、secret 注入方式、probe 与真实 LLM smoke
   的 opt-in 规则；明确没有 key/额度/网络时的 degraded/blocked 行为。
9. **远程访问**：loopback、LAN TLS/pairing、未来/已实现的 Tailscale/SSH、public HTTPS
   和 ACME 的状态，禁止把端口转发、UPnP 或 insecure override 写成默认建议。
10. **架构图与仓库地图**：用简洁 Mermaid/ASCII 图说明 Browser → daemon → RunManager →
    AgentLoop → Context/Model/Tool/Sandbox，另列 `apps/`、`packages/`、`docs/` 的职责。
11. **验证与成熟度**：链接 Spec 60、focused module check、full verify、live LLM 和
    release evidence；区分“测试通过”和“真实运行已证实”。
12. **限制、故障排查、贡献与安全报告**：给出稳定错误码、日志位置的安全摘要、撤销方式、
    不要上传的材料、issue/PR 规范和许可证/NOTICE 边界。

### 4.1 截图与图示边界

按照现有 ratio/conversation-first 决策，截图不是仓库验收硬依赖，也不得用初始化配置
截图冒充日常使用界面。若未来加入截图，必须来自真实用户运行界面、脱敏、标注 viewport/版本、
不含 secret/绝对路径，并通过 Spec 60 的 evidence 检查。当前可优先使用品牌横幅、架构图、
流程图和可复制的 UI 文案，避免巨大 Logo 或失真的 mockup。

## 5. 必须写清的安全与操作内容

用户可见文档至少要用短句解释：

- 默认是 loopback/安全 profile；LAN 需要 TLS、pairing、Bearer/CSRF/Origin 门禁；
- `workspace-coding` 只作用于选定 workspace，sandbox 不可用时不静默切 full-host；
- `full-host` 永远不是默认值，必须认证用户明确确认，trusted-only、session-scoped、
  可过期、可撤销，且不自动开启 network/MCP/Skill 或绕过 Goal/quota/Scheduler/Approval/Sandbox；
- interactive run 与 governed Goal run 的区别，以及 Gate/quota/validation 失败时的行为；
- provider/memory/MCP/Skill/容器不可用时的 bounded degraded/blocked 语义；
- 证书、备份、升级、回滚、Tailscale/SSH/ACME 尚未实现时必须明确写“planned/blocked”，
  不给出会造成公网暴露的猜测步骤。

## 6. Quickstart 与配置说明的可用性约束

- 新用户从干净 checkout 执行 Quickstart，最多 5 个主要步骤；每一步有成功判据和失败
  排查链接；
- 命令同时提供 PowerShell 和 POSIX 变体，或明确声明平台范围；不依赖隐含的当前目录、
  用户名、端口或全局工具；
- 说明 Node/pnpm 版本、依赖安装、daemon/Web 启动、停止/清理和测试命令；
- 模型 key 只用占位符/secret reference 示例，禁止真实凭据、可复制的生产 token 或将
  secret 作为命令行参数；
- 首次配置必须优先指向 Web Settings/onboarding，浏览器不能成为权限权威，也不能存储
  credentials/path；
- 每个“可用”命令须在当前 commit 上运行过，输出只保留 bounded、无隐私的结果；
- Quickstart 不得启动真实 full-host、写入系统服务/注册表/防火墙、自动开公网或自动拉取
  容器镜像；这些能力必须另有显式、安全的操作章节。

## 7. 英文优先、中文同步与术语

- 英文版是 canonical copy，中文版本必须在同一提交同步更新；新增章节、状态、命令、
  链接和限制不能只更新一侧；
- 中英文使用同一产品名 `VibeGo`、仓库名 `ready4vibe`、字段名、命令和错误码；
- “workspace-coding”“full-host”“bounded-auto”“session-auto”“interactive run”、
  “governed run”“degraded”“blocked”“fail-closed”等术语保留英文并给出一次中文解释；
- 翻译优先保证安全语义、否定条件和默认值准确，不为了自然中文删除限制或夸大能力；
- 任何数字、版本、测试数、浏览器支持和平台矩阵都必须能追溯到当前 evidence。

## 8. 文档质量门禁

Spec 61 的文档提交必须通过：

1. Markdown 相对链接存在、锚点可解析、code fence 成对、`git diff --check` 通过；
2. Quickstart 命令在 clean checkout 和声明的平台上逐条验证；不能只检查语法；
3. README/README-zh 与 implementation-status/roadmap/Spec 60 的状态交叉核对；
4. secret/path/raw command/privacy 扫描通过；示例只含占位符和临时路径；
5. 生成或修改的 Mermaid/图片/品牌资产可渲染，`alt`/标题/尺寸/许可证信息完整；
6. 文档在窄手机、宽手机/折叠、平板和桌面宽度下可阅读；代码块可横向滚动且不改变安全含义；
7. 文档审阅至少覆盖一名新用户视角、一名安全审阅视角和一名维护者视角；问题必须关闭
   或记录为已知限制；
8. 文档只在代码/测试/证据已经更新或明确标记规划时发布，不以文档掩盖实现缺口。

## 9. 实施阶段

### 61-1：用户文档审计

盘点根 README、中文 README、docs 索引、Spec/ADR、安装/模型/安全/运维/贡献文档；
标记重复、过期、互相矛盾、缺少状态、不可复制命令和 secret/path 泄露风险。

### 61-2：信息架构与品牌入口

完成英文优先 README 的首屏、横幅、状态、Why/Non-goals、目录、架构图和仓库地图；
保持 VibeGo 品牌，不把 logo 做成占满首屏的布局，也不复制 Codex 私有 UI/文案。

### 61-3：Quickstart 与配置引导

以 Web onboarding/settings 为主线重写安装、启动、pairing、第一条对话、模型 probe、
workspace、停止/清理和安全失败排查；每条命令完成实际验证并维护 PowerShell/POSIX 变体。

### 61-4：安全、权限与远程运维

补齐 LAN/TLS、workspace/full-host、approval、Goal、memory、MCP/Skill、Tailscale/SSH、
ACME、backup/recovery、release 和隐私说明；所有后置能力明确标记，不提供危险猜测步骤。

### 61-5：中英文同步与维护者文档

同步 `README-zh.md`、`docs/README.md`、`CONTRIBUTING.md`、状态页、故障排查、变更记录和
安全报告入口；建立术语表和文档 ownership，避免后续 commit 重新产生漂移。

### 61-6：真实用户审阅与发布前校验

在 clean checkout、窄/宽 Web 视口和受控 LAN fixture 上按 README 走完一次；执行 Spec 60
的文档/隐私/链接门禁，修复发现的问题后才可把文档状态写为 release-ready。

## 10. Definition of Done

Spec 61 只有在以下条件全部满足后才能标记 `Implemented`：

1. `61-0` 前置复核报告已完成；Spec 01–60 的所有 Web 发布必需阶段在同一目标 commit
   上均为 `implemented/verified`，没有未说明的 `partial`、`blocked` 或 `not-run`；
2. Spec 60 的 full evidence bundle 已给出 `release-candidate`，并且其中的真实 LLM、
   Goal governed、权限、远程/证书、并发/恢复和 release 证据可追溯；
3. 英文 README、中文 README、docs 索引和用户/维护者入口互相链接且状态一致；
4. 新用户能从 clean checkout 按 Quickstart 在声明的平台完成安装、启动、pairing、配置和
   第一条对话；失败时能找到安全、可操作的排查路径；
5. 默认能力、权限 profile、审批、Goal、真实 LLM、远程访问、证书、安装/升级/回滚和
   未实现项均有准确、无夸大的说明；
6. 文档不要求普通用户手动编辑危险配置文件，不包含任何真实 secret、绝对路径、原始命令
   或完整 transcript；
7. 品牌横幅、架构图、术语、英文优先和中文同步符合本规格；截图若存在则是脱敏真实用户
   界面，不是初始化配置或巨大 Logo mockup；
8. 文档质量门禁、命令验证、链接/fence/diff/privacy 检查和至少三种读者审阅均有证据；
9. 文档更新在对应代码/测试变更之前完成，并以独立 Git 提交记录；发布说明引用 Spec 60
   evidence，不以 README 单独证明产品已经成熟。

## 11. 不在本规格内

- 不通过修改 README 宣称未实现的 Goal、full-host、Tailscale/SSH、ACME 或 release 能力；
- 不把截图、营销文案或品牌资产当作真实运行和安全验收的替代品；
- 不在 README 中复制 Codex、LoopX、TencentDB 或其他上游的代码、私有协议、完整 UI 或
  受版权限制的文案；
- 不把 README 变成包含所有内部设计细节的单一文档；深层约束仍由 Spec/ADR/Runbook 维护，
  README 只提供稳定入口、边界、操作和链接。
