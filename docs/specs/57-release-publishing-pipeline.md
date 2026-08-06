# Spec 57：Release 发布流水线与供应链证明

- Status: Phase 57a contract implemented（纯合约；不改变当前运行时；GitHub workflow/artifact publishing remains later）
- Date: 2026-08-05
- Related: [Spec 46](46-automated-verification-workflow.md)、[Spec 51](51-host-first-release-and-client-boundary.md)、[Spec 53](53-host-install-upgrade-backup-recovery.md)、[Spec 55](55-public-deployment-certificates-operations.md)、[研究记录](../research/53-57-release-install-model-operations-research.md)

## 1. 目标

建立可重复、可审计、可回滚的 GitHub public release pipeline：从受保护 tag 构建多平台
Host artifact、React Web 静态资源、SBOM、checksum、平台签名和 provenance，到生成 draft
release、执行 smoke/compatibility gate、人工批准后发布 stable。

流水线不能把 GitHub Actions、发布仓库或云服务变成运行时依赖；用户安装后即使离线，仍能
验证本地 artifact 并启动已安装的 Host。

## 2. 发布通道与版本规则

### 2.1 Channels

| channel | 触发 | 稳定性 | 目的 |
| --- | --- | --- | --- |
| `nightly` | default branch 定时/手动 | 不保证迁移兼容 | 内部 smoke 和回归 |
| `preview` | `vX.Y.Z-rc.N` tag | 可回滚、不承诺稳定 | 用户验收和设备矩阵 |
| `stable` | `vX.Y.Z` tag + approval | 支持窗口内可升级 | 普通自托管用户 |

SemVer tag 是唯一发布身份；同一个 tag 不允许重写 artifact。修复必须生成新版本，不能
覆盖 GitHub release asset 或修改已发布 manifest。

### 2.2 Release authority

- 代码合并、tag 创建、发布批准和撤回由受保护 GitHub environment 分离；
- release workflow 使用最小 `permissions`，默认只读，attestation/signing job 单独授予写权限；
- workflow、action、Node/pnpm、base image 和工具版本都 pin 到审阅过的 revision；
- 发布说明、迁移说明、已知问题、支持平台、校验和、签名验证命令、回滚版本和安全公告
  必须随 artifact 一起生成。

## 3. Pipeline stages

```text
tag/preflight
  -> docs/link/fence/license checks
  -> focused module tests
  -> pnpm typecheck
  -> pnpm verify
  -> reproducible Web/daemon build
  -> OS/arch packaging
  -> SBOM + LICENSE/NOTICE inventory
  -> checksum + platform signing
  -> provenance/attestation
  -> install/upgrade/rollback smoke
  -> model/container/ACME opt-in evidence
  -> draft GitHub Release
  -> maintainer approval
  -> stable publish + channel manifest
  -> post-release health + rollback readiness
```

任一 required stage 失败都停止 stable 发布；只读文档变更可以跳过昂贵的 artifact job，但
不能绕过 `pnpm diff:check`、`git diff --check` 和 Markdown/link checks。

## 4. Build 与 artifact matrix

### 4.1 构建输入

每个构建记录 source commit、tag、Node version、pnpm lockfile hash、Web build revision、
OS image digest、compiler/toolchain revision、timezone/locale 和 reproducibility metadata。
构建不得读取仓库外的 credential 或用户 workspace。

### 4.2 Artifact

至少生成：

- Windows x64/arm64 Host installer/portable fallback；
- macOS arm64/x64 signed/notarized Host bundle；
- Linux x64/arm64 signed portable bundle；
- `host-manifest.json`、`SHA256SUMS`、SBOM、LICENSE/NOTICE、release notes；
- optional `container image` 只作为显式部署 adapter，不替代 Host artifact。

Artifact 文件名包含 product、version、channel、OS、arch；压缩包内不得包含 `.env`、
私钥、API key、测试凭据、`.research` checkout、绝对路径或完整 fixture transcript。

## 5. 签名、SBOM 与 provenance

### 5.1 多层证据

1. `SHA256SUMS`：用户可离线校验内容；
2. Windows Authenticode/macOS Developer ID + notarization：改善平台信任和安装体验；
3. GitHub artifact attestation：绑定构建 workflow、source commit 和 artifact；
4. SBOM attestation：列出直接/传递依赖、版本、许可证和生成工具；
5. Sigstore/Cosign keyless：为公开 release 提供 OIDC identity、透明日志和可独立验证的签名；
6. 企业/离线环境可注入硬件密钥签名，但验证 contract 必须相同。

`release-manifest/v1` 包含 artifact digest、signature/attestation reference、source commit、
minimum host version、database schema range 和 rollback target；不包含 secret、绝对路径或
完整构建环境变量。

### 5.2 用户验证

发布说明必须给出 Windows/macOS/Linux 的最小验证命令和预期结果。验证失败时 installer
不得运行；普通用户仍可通过 UI 看到 `signature-invalid`、`digest-mismatch`、
`attestation-unavailable` 等稳定状态，而不是原始 CI 日志。

## 6. Quality gates

### 6.1 必过 gate

- contracts、storage、scheduler、agent、model、policy、sandbox、skill-mcp、goal、observability、
  daemon、web 的 focused tests/typechecks；
- 完整 `pnpm verify`、`pnpm diff:check`、`git diff --check`；
- install/start/stop/restart/uninstall、first-run pairing、model setup、workspace setup、
  first conversation、approval、recovery、backup/restore 和 upgrade/rollback；
- Windows/macOS/Linux artifact signature、attestation、clean machine smoke；
- Web 浏览器与 Spec 56 真实设备/辅助技术矩阵；
- `pnpm smoke:model`、`pnpm smoke:container`、`pnpm smoke:acme -- --staging`、
  `pnpm smoke:tailscale`、`pnpm smoke:ssh` 的 release evidence；缺失 optional adapter 只能
  标记 `degraded`，不得伪造 pass；
- 性能报告：冷启动、idle RSS、Web first interactive、SSE latency、upgrade duration、
  backup/restore duration 和 SQLite growth；
- license/NOTICE、SBOM、CVE/secret scan、artifact contents 和 dependency diff 审阅。

### 6.2 Stable approval checklist

Stable 发布前由人工确认：

1. tag 与 source commit 正确且没有 dirty generated files；
2. 版本化 manifest、checksum、signature、attestation、SBOM 相互匹配；
3. migration/rollback 目标可用，previous artifact 和上一稳定版本仍可下载；
4. release notes 明确 breaking change、数据备份建议、证书/公网风险和已知设备问题；
5. 不含凭据、私钥、用户数据、research checkout 或未授权上游代码；
6. 支持窗口、security contact、撤回/回滚负责人和故障通知渠道已填写。

## 7. Promotion、撤回与回滚

- `preview` 通过所有自动 gate 后生成 draft release；设备、模型、ACME 和 container smoke
  报告上传为 redacted evidence；
- maintainer approval 后才 promote stable，stable manifest immutable；
- 发现安全或数据损坏问题时，先标记 release withdrawn，再发布修复版本；不删除已有证据；
- 客户端升级前验证签名和 `minimumHostVersion`；启动后 health/migration 失败自动回到
  previous，或进入 manual-recovery-required；
- 回滚不得重放旧模型/tool/shell/MCP 调用，不得覆盖已有 run/Goal authority；
- 发布 workflow 本身变更需要单独审阅和一次全量 dry-run。

## 8. Secrets 与合规边界

- GitHub Actions secret 仅用于签名、notarization、发布和可选外部 smoke；不写入 artifact、
  logs、release notes、screenshots 或 test snapshots；
- live model/container/ACME smoke 必须显式触发、bounded cost/timeout，并使用进程外凭据；
- release logs 默认 redacted，失败时只上传稳定 reason code 和诊断 id；
- license、NOTICE、SBOM 和 upstream research revision 在每次依赖变更时重新生成；
- 不把 GitHub token、cloud provider key、ACME key 或用户 DeepSeek/OpenAI key 作为项目默认
  配置或提交到仓库。

## 9. 实现阶段交付物

新增但不修改既有运行时权威的候选文件：

- `.github/workflows/release.yml`、`.github/workflows/nightly.yml`；
- `scripts/build-host.*`、`scripts/package-host.*`、`scripts/verify-release.*`；
- `release/manifest.schema.json`、`release/compatibility-matrix.yml`、`release/README.md`；
- `docs/releases/` 的 release checklist、rollback、SBOM/NOTICE 和支持窗口说明。

这些文件必须先由测试 fixture 验证，再接入真实发布环境；不能在开发机默认上传 artifact、
创建 release 或消耗生产证书/模型额度。

## 10. 明确不做

- 不把 `latest`、未签名 zip、mutable CDN URL 或 CI log 当作唯一更新信任根；
- 不自动发布到生产公网、自动安装系统服务或自动修改防火墙；
- 不在 stable gate 中强制每位开发者拥有 Docker、Tailscale、SSH、ACME 或 live model credential；
  但 release candidate 必须附上对应的显式 evidence 或 `degraded` 说明；
- 不复制 GitHub/Cosign/Node/Playwright 的源代码或 UI；
- 不创建第二套版本、migration、backup、rollback 或 artifact authority。

## 11. Phase 57a contract boundary（2026-08-05）

Phase 57a implements a pure `release-manifest/v1` and promotion-state contract
before any GitHub Actions or packaging work. The manifest is an immutable
description, not a download instruction:

- channel, SemVer tag, source commit, minimum host version, database schema
  range, rollback target and bounded artifact entries are explicit;
- every artifact has a lowercase SHA-256 digest, safe basename, target OS/arch
  and bounded signature/attestation/SBOM references; URLs with credentials,
  query tokens, absolute paths and mutable `latest` references are rejected;
- `nightly`, `preview` and `stable` tag/channel rules are validated, with
  stable requiring a non-prerelease tag and an explicit approval transition;
- promotion phases are ordered and immutable. A published release may only
  move to withdrawn; it cannot be overwritten or silently republished.

The contract does not create a GitHub release, upload an artifact, sign a file,
run CI, read credentials or inspect a user workspace. It does not alter Host,
AgentLoop, RunManager, Scheduler, Approval, Sandbox, `run_events` or
`goal_events`; later workflow stages consume the projection as an external
release authority.

## 12. Phase 57a implementation evidence

The pure contract slice is implemented in
`packages/contracts/src/release-publishing.ts` and exported from the package
barrel. It validates the `release-manifest/v1` and promotion-state schemas,
rejects mutable `latest` revisions, requires `tag` to match
`productVersion`, and exposes the ordered promotion transition helper.

Focused verification on 2026-08-05:

- `packages/contracts/src` — 15 files, 57 tests passed;
- `pnpm --filter @ready4vibe/contracts typecheck` — passed;
- `pnpm --filter @ready4vibe/contracts build` — passed;
- `git diff --check` — passed before commit.

No GitHub workflow, release upload, signing, SBOM/provenance generation,
installer, artifact download or runtime update behavior is part of this phase.

## 13. Phase 57b deterministic local release manifest preflight

The next bounded implementation slice is frozen by
[ADR 0058](../adr/0058-deterministic-release-manifest-preflight.md). The new
`pnpm release:manifest` command accepts explicit release metadata and artifact
descriptors rooted in a caller-provided staging directory. It streams each
artifact through a built-in SHA-256 hash, records bounded byte size and target
metadata, validates the existing `release-manifest/v1` contract, and writes
only the requested manifest file.

The command must reject missing files, path traversal/symlink escape, unsafe
basenames, malformed tags/commits/channels and stable releases without a
rollback target. It must not include artifact roots, local absolute paths,
credentials, environment values or raw errors in the manifest/report. Tests
use temporary fixtures and do not contact GitHub, sign, upload, build an
installer, generate SBOM/provenance or alter runtime authorities.

Implementation evidence is recorded in
[`spec57b-release-manifest-preflight-2026-08-06.md`](../reports/spec57b-release-manifest-preflight-2026-08-06.md).

## 14. Phase 57c developer snapshot packaging and promotion

The first actual release slice is a nightly Windows x64 developer snapshot
under [ADR 0060](../adr/0060-developer-snapshot-packaging-and-promotion.md).
`pnpm package:developer-snapshot` stages the materialized daemon deploy,
built Web assets and Host launcher. The daemon staging step keeps only
compiled runtime output, production dependencies and package metadata; source
`src/`, TypeScript files and `tsconfig.json` are excluded before the privacy
scan. It rejects runtime/user/research/credential content, writes bounded
metadata/checksum/release notes and creates a gzip tar archive. The same
archive must be extracted and started through the Host launcher before an
immutable GitHub prerelease is created. This slice is not a signed installer,
SBOM/provenance attestation or stable release.
