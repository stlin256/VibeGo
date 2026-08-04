# Spec 53：Host 一键安装、签名升级、备份迁移与故障恢复

- Status: Phase 0/1/2/3 implemented（manifest、升级状态、SQLite snapshot adapter 与备份恢复 contract；安装器/升级器/restore runtime 仍未接入）
- Date: 2026-08-05
- Related: [Spec 51](51-host-first-release-and-client-boundary.md)、[Spec 52](52-capability-profiles-and-first-run-experience.md)、[Spec 36](36-durable-workspace-settings.md)、[Spec 39](39-tencentdb-agent-memory-integration.md)、[ADR 0028](../adr/0028-sqlite-backup-snapshot-adapter.md)、[研究记录](../research/53-57-release-install-model-operations-research.md)

## 1. 目标

把当前需要 Node/pnpm/Vite 的开发部署，收敛为一个普通用户可以安装、启动、升级、
备份、迁移和恢复的 VibeGo Host。Host 仍是唯一执行权威，浏览器只是 REST/SSE 客户端；
安装器、升级器和恢复器不得创建第二个 AgentLoop、Scheduler、Approval、Sandbox 或事件源。

本规格同时覆盖 Windows、macOS、Linux 的首个可发布路径，但不承诺每个平台采用相同的
安装容器。最终选择必须以冷启动、空闲 RSS、升级可回滚和签名工具支持的实测结果为依据。

## 2. 当前差距

- daemon 已可在 Host-first release path 内置 React 静态资源；开发仍可使用独立 Vite server。
- 尚无不要求用户安装 Node/pnpm 的跨平台 Host bundle 和统一 launcher。
- SQLite 有持久化事件和 settings，但没有面向用户的版本化 backup/restore contract。
- 已有 restart/recovery guard，但没有 candidate upgrade、migration dry-run、safe mode 和
  用户可理解的恢复向导。

## 3. 不可改变的边界

1. 默认使用 per-user data directory，安装/升级不修改 workspace 文件，不上传运行记录。
2. 安装器不写入 API key、private key、原始环境变量或完整 transcript；secret 只通过现有
   secret provider/OS credential store 引用。
3. 任何 binary、manifest、migration 或 backup 都必须先校验，再执行或导入；校验失败必须
   fail-closed，不自动回退到未签名版本。
4. `current`、`previous`、`candidate` 是不可变版本目录；禁止在 current 目录原地覆盖或
   `git pull`。
5. 不自动覆盖用户 workspace、证书私钥、模型凭据或未识别的数据库表；未知 schema 必须
   进入 `migration-blocked`。

## 4. Host artifact 与一键安装

### 4.1 版本化 manifest

每个发行包包含 `host-manifest/v1`，最小字段为：

```text
schemaVersion
productVersion
channel                 # preview | beta | stable
target                  # os + arch + libc/runtime label
runtimeRevision
webBuildRevision
dbSchemaMin
dbSchemaMax
artifactDigest          # sha256
signatureRefs
attestationRefs
createdAt
```

Manifest 不得包含绝对路径、secret、API key、private key、完整命令或用户 workspace 内容。

#### Phase 0 implementation update (2026-08-05)

`@ready4vibe/contracts` now exposes a strict `host-manifest/v1` contract for
the fields above. Product/channel/target/revision values are bounded, the
artifact digest is a lowercase SHA-256 reference, and signature/attestation
references reject credentials, query tokens, control characters and absolute
paths. Unknown fields and invalid timestamps are rejected before a future
installer or updater can act on a manifest. This slice is pure validation: it
does not download, verify, install, migrate, switch or roll back any artifact.

### 4.2 安装体验

1. 用户下载与平台匹配的签名 artifact，双击或运行 launcher；不要求远程设备安装 Node、
   pnpm、Vite 或 Python。
2. 安装器默认使用用户目录，只有用户明确选择系统级安装才请求管理员权限。
3. 首次启动仅创建数据目录、SQLite schema、非 secret 默认 profile，并输出 loopback URL
   和 pairing 指引；不得自动开放 LAN 或公网。
4. 安装失败保留 bounded error code 和 diagnostic id，不输出命令行、环境变量、私钥或
   workspace 绝对路径。
5. 卸载默认保留数据并提供导出提示；清除数据是单独的、可见的、不可逆操作。

### 4.3 平台 artifact 候选

| 平台 | 首发候选 | 必须证据 |
| --- | --- | --- |
| Windows x64/arm64 | signed `.exe`/`.msix` + portable fallback | Authenticode、安装/卸载、进程树、数据目录权限、Windows Defender 误报检查 |
| macOS arm64/x64 | signed/notarized `.pkg` 或 bundle | Developer ID、notarization、Gatekeeper、首次启动和升级 |
| Linux x64/arm64 | signed AppImage 或 tar bundle | digest、attestation、无 root 安装路径、systemd 可选 adapter |

Node SEA 或 bundled Node 只是实现候选；若 native addon、SQLite 或签名流程在某平台不稳定，
可切换为等价的 bundled runtime，但必须更新 manifest 和 release evidence。

## 5. 签名验证与升级状态机

### 5.1 信任链

安装/升级至少验证：HTTPS 下载、SHA-256 digest、平台签名、release manifest 签名和
provenance/SBOM attestation。公开 GitHub release 优先使用 keyless Sigstore/GitHub
artifact attestation；离线或企业环境可注入 hardware-backed signing adapter。任一验证失败
都不得启动候选版本。

### 5.2 状态机

```text
discovered
  -> downloaded
  -> digest-verified
  -> signature-verified
  -> staged
  -> migration-preflight
  -> candidate-started
  -> health-checked
  -> smoke-checked
  -> switched
  -> previous-draining
  -> succeeded
```

任一中间状态失败都保留 `current`，记录 bounded reason code，并可安全清理 candidate。
切换后的健康失败执行一次受保护 rollback 到 `previous`；rollback 失败时进入
`manual-recovery-required`，不得循环重启或删除证据。

升级请求（Web、定时器、CLI、未来 webhook）共享一个串行队列；运行中的 run 不做 Node
模块热替换。新进程必须重新读取 snapshot，已运行的 run 继续使用原 snapshot。

#### Phase 1 implementation update (2026-08-05)

Before any installer or daemon integration, `@ready4vibe/contracts` now exposes
the update phase enum, strict state snapshot and fail-closed transition helper.
The helper only describes legal lifecycle movement; it does not download,
verify, spawn, migrate, switch or roll back a process. `current`, `previous`
and `candidate` revisions remain opaque bounded identifiers, and a transition
cannot erase a failure or silently jump over verification/health gates. Six
focused contract tests cover ordered gates, failure reasons, rollback
preconditions and invalid transitions.

#### Phase 2 implementation update (2026-08-05)

`@ready4vibe/contracts` now also exposes strict metadata-only contracts for
`backup-manifest/v1`, `RestorePlan`, `RestoreResult`, `RecoveryStatus` and
`DiagnosticBundleDescriptor`. Backup entries use logical data-class identifiers
and SHA-256 digests rather than local paths. Restore plans require explicit
confirmation, preserve the current state and reject credential/workspace-file
imports. Recovery and diagnostic projections use bounded reason codes and
redacted sections; safe-mode operations are limited to health, settings,
backup, restore, diagnostics and read-only event viewing.

The Phase 2 slice does not open SQLite, copy or delete files, read credentials,
start a subprocess, switch a data pointer, expose a Web route or automatically
enter safe mode. Focused tests cover privacy/path/unknown-field rejection,
backup entry identity, restore invariants, recovery operation bounds and
redacted diagnostic descriptors. The new fixture has 6 tests; the full
contracts module now passes 63 tests, typecheck and build.

#### Phase 3 implementation update (2026-08-05)

`@ready4vibe/storage` now provides an explicit `SqliteBackupSnapshotAdapter`.
It checks the source database, runs SQLite `VACUUM INTO` in a caller-selected
staging directory, verifies `PRAGMA integrity_check` on the snapshot, reads the
bounded `user_version`, streams a SHA-256 digest and emits a validated
`backup-manifest/v1` with only the `sqlite-database` logical data class. The
destination is immutable: an existing target is rejected, writes go through a
temporary file and an atomic no-replace link commit, and the temporary file is
removed on failure.

The adapter is an internal storage operation. It does not expose its absolute
snapshot path through contracts/Web, and it never copies workspace files,
credentials, raw environment values or event payloads into a Web response. It
does not implement restore, migration, encryption, installer/updater or daemon
routes. The new snapshot fixture has 4 tests; the complete storage module has
35 passing tests plus typecheck and build. Focused storage tests cover successful reopen/integrity, digest and
manifest projection, schema mismatch, corrupt source, output-size limit,
destination immutability and temporary-file cleanup.

### 5.3 数据库 migration

- migration 有严格版本、checksum、前置/后置条件和可回滚判定。
- 真实 migration 前先生成数据库 snapshot，并在临时副本执行 dry-run、`integrity_check`
  和 bounded schema probe。
- 不支持降级 migration；版本不兼容时保留 current/previous 并显示 `migration-blocked`。
- migration 失败不得删除旧数据库、旧事件或用户 settings。

## 6. 备份与迁移

### 6.1 Backup bundle

使用 SQLite Online Backup API 或 `VACUUM INTO` 生成一致性数据库 snapshot，必要时先做
WAL checkpoint。导出 bundle 包含：

- SQLite 数据库及 schema revision；
- 非 secret daemon settings、profile、workspace registry 的逻辑映射；
- Goal/run/usage/audit 等现有事实源的安全数据；
- `backup-manifest/v1`、文件大小、hash、产品版本、创建时间和兼容范围。

默认不包含：API key、OAuth refresh token、private key、完整环境变量、证书私钥、workspace
文件、原始外部服务响应和未受支持的 extension table。workspace 需要用户使用其既有 Git/
备份工具单独迁移，再在恢复向导中重新绑定。

### 6.2 加密与传输

- 本机同一用户目录的临时 snapshot 可以不加密，但导出到下载目录、网络或移动介质时必须
  显式选择加密 bundle 或显示隐私警告。
- 加密实现采用版本化 envelope；KDF、AEAD、salt、nonce 和参数必须进入 manifest，
  但不写入密码、密钥或可恢复的 secret reference。
- 无可用加密实现时，远程导出动作应被拒绝，而不是静默输出明文数据库。

### 6.3 Restore/migrate

1. 读取 manifest、版本和 checksum，不信任导入包中的路径。
2. 在新 staging 目录解包并执行 schema/`integrity_check`/privacy scan。
3. 将旧 workspace id 映射到用户重新选择的 workspace；绝对路径只存在于服务端内部，
   不进入 Web response、event 或 backup manifest。
4. 生成 `RestorePlan`，展示影响范围和兼容性；用户明确确认后原子切换 data pointer。
5. 保留 restore 前的 current 作为 previous，恢复失败可返回原状态；不导入 credentials，
   用户需重新完成 model/certificate/pairing 配置。

## 7. 故障恢复与 safe mode

启动时检查 artifact、SQLite、migration、certificate、optional adapter 和子进程状态，
只返回以下 bounded 状态：

```text
healthy | needs-recovery | rollback-available | migration-blocked |
database-corrupt | certificate-invalid | optional-degraded | manual-recovery-required
```

- `database-corrupt`：停止写入，保留原目录和 hash，尝试只读恢复/导出，不覆盖证据。
- `needs-recovery`：只标记未终态 run，不重放旧工具、审批或 shell 调用。
- `optional-degraded`：可关闭 Memory/MCP/Skill 等可选适配器，保持普通 Web 和交互 run 可用。
- `safe mode`：只开启 health、settings、backup、restore、diagnostic 和 read-only event view，
  不执行模型、工具、shell 或外部 sandbox。
- 每次恢复生成 redacted diagnostic bundle；用户主动下载，不自动上传。

## 8. 版本化 contracts

在实现阶段新增以下 strict contracts，并复用现有 privacy/path scanner：

- `HostInstallManifest`
- `UpdateCandidate`、`UpdateState`、`RollbackResult`
- `BackupManifest`、`RestorePlan`、`RestoreResult`
- `RecoveryStatus`、`DiagnosticBundleDescriptor`

所有 contract 拒绝未知字段、secret-shaped 字段、绝对路径、未界定长度和不匹配的
`schemaVersion`。状态写入独立 `host_update_state`/`recovery_state` namespace，不污染
`run_events` 或 `goal_events`。

## 9. 测试与发布门禁

- Windows/macOS/Linux disposable install、uninstall、restart 和 per-user data-dir 测试；
- signature/digest/attestation 成功、过期、错误 artifact、降级和离线失败测试；
- current/previous/candidate 切换、health failure、rollback、进程树终止测试；
- WAL 写入期间 backup snapshot 一致性、损坏包、未知 schema、重复 restore 和冲突 workspace
  映射测试；
- migration dry-run、失败回滚、旧版本恢复和不重复执行旧 tool call 测试；
- safe mode 不产生模型、网络、子进程和工具副作用；
- 安装/升级包不得包含 secret、workspace 文件或绝对路径；
- 每个平台通过 `pnpm typecheck`、受影响模块测试、`pnpm verify`、`git diff --check`，
  并附带真实签名验证和脱敏报告。

## 10. 明确不做

- 不做隐式自动升级、隐式公网暴露或静默覆盖 current；
- 不在安装器中安装 Docker、Podman、Tailscale、SSH 或模型运行时；
- 不把完整 workspace、API key 或 private key 当作普通备份内容；
- 不实现第二套数据库、事件流、scheduler、approval 或 recovery authority。
