# Specs 53–57 调研记录：发行、模型、公网、可访问性与发布流水线

**状态：Research note（只读调研；不改变运行时行为）**
**调研日期：2026-08-04**

本记录为新增 Spec 53–57 提供事实依据。只使用公开文档和当前仓库已有的
clean-room 边界，不复制任何上游源码、提示词、UI 或运行时。凭据、私钥和本地
工作区内容没有发送到外部服务。

## 1. 官方资料与可复用事实

| 主题 | 官方资料 | 对 VibeGo 的结论 |
| --- | --- | --- |
| Node 单文件发行 | [Node.js Single executable applications](https://nodejs.org/api/single-executable-applications.html) | Node 可以把 bundled script 注入 Node binary，用户无需安装 Node；当前能力仍标注为 active development，因此每个 Node 升级都要重新做启动、原生模块和签名验收。 |
| GitHub Release | [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) | Release 以 Git tag 为不可变锚点，可附带版本化二进制、校验文件和 release notes；不能把可变 `latest` URL 当作唯一信任依据。 |
| 构建溯源与 SBOM | [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations) | GitHub Actions 可为二进制和 SBOM 生成 provenance/attestation，并可用 GitHub CLI 验证；发布流水线应将其作为供应链证据。 |
| Keyless 签名 | [Sigstore Cosign signing overview](https://docs.sigstore.dev/cosign/signing/overview/) | Fulcio 将短期证书绑定到 OIDC 身份，Rekor 提供透明日志，TUF 分发信任根；公开仓库优先采用 keyless，离线/企业环境保留显式密钥适配器。 |
| ACME challenge | [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/) | HTTP-01 需要 80 端口且不能签发 wildcard；DNS-01 支持 wildcard 但 DNS API 凭据风险更高，应使用最小权限并允许独立验证节点。 |
| ACME staging | [Let's Encrypt staging environment](https://letsencrypt.org/docs/staging-environment/) | 必须先用 staging 做 issuance/renewal/rollback；staging 根证书不在普通浏览器信任库中，不得写入普通系统信任库。 |
| SQLite 在线备份 | [SQLite Online Backup API](https://www.sqlite.org/backup.html) | 直接复制 live database 可能受到锁和崩溃影响；应使用 Online Backup API 或 `VACUUM INTO` 生成一致性 snapshot，并独立校验 manifest。 |
| Web 无障碍 | [WCAG 2.2 Recommendation](https://www.w3.org/TR/WCAG22/) | 规格目标设为 WCAG 2.2 AA；标准覆盖桌面、移动和辅助技术，但仍需要真实屏幕阅读器和键盘验收。 |
| 设备测试 | [Playwright emulation](https://playwright.dev/docs/emulation) | Playwright 可模拟 viewport、touch、locale、timezone 和选定设备；模拟不能替代真实设备，release 仍需要真实浏览器矩阵。 |
| 本地模型 | [Ollama API](https://docs.ollama.com/api)、[LM Studio Developer Docs](https://lmstudio.ai/docs/app/api) | Ollama 默认 loopback API 为 `http://localhost:11434/api`；LM Studio 提供 REST、OpenAI-compatible、Anthropic-compatible 和模型管理接口。两者都应通过显式、可取消、无隐式下载的 provider adapter 接入。 |

## 2. 采用的设计判断

1. **发行形态**：继续沿用 Spec 51 的 Host-first 和 Node/TypeScript 技术栈。首选
   bundled Node/SEA 或等价的单 Host bundle；不引入 Tauri、Electron、Python 或第二个
   execution plane。Node SEA 是候选实现，不在文档阶段硬编码为唯一方案。
2. **升级可信链**：版本化 artifact + SHA-256 + 平台签名 + provenance/SBOM attestation；
   `current/previous/candidate` 三指针和 health-gated atomic switch 继续保持与现有
   Memory supervisor 一致。
3. **备份安全**：备份的是 SQLite 一致性快照和非 secret 配置；API key、private key、
   完整环境变量和 workspace 内容默认不进入备份。恢复先到新目录校验，再由用户显式确认。
4. **公网证书**：loopback 仍是默认；公网部署必须显式选择。HTTP-01 是默认向导路径，
   DNS-01 为高级路径，staging 必须先成功；不做 UPnP、自动端口暴露或隐式 reverse proxy。
5. **模型向导**：local/cloud 是用户可理解的入口分类，实际执行仍由 versioned provider
   descriptor、secret reference 和 run snapshot 约束。探测不等于调用模型，下载模型永远是
   二次确认动作。
6. **多端质量**：CSS 以可用宽度、纵横比、safe-area 和输入能力为依据，不使用 UA/device
   sniffing。Playwright 负责可重复 emulation，真实设备负责最终发布证据。
7. **语言与无障碍**：首发语言为 `en-US` 和 `zh-CN`，所有文本走 ICU/message catalog；
   目标为 WCAG 2.2 AA，失败的无障碍项必须阻止 stable release 或明确记录例外。

## 3. 未决事项与后续验证

- Node SEA、原生模块、SQLite `node:sqlite` 和各平台签名工具需要在目标 Node LTS
  版本上重新做构建和启动 benchmark。
- GitHub artifact attestations 的权限和仓库可见性会影响 CI 配置；公共仓库可先采用
  GitHub Actions attestation，私有/离线环境需要额外的 Sigstore 或硬件密钥方案。
- 公网直接监听与反向代理都要保留，但首个 stable profile 应优先验证一种默认路径，避免
  同时维护多套 TLS/forwarded-header 权威。
- 折叠屏和三折叠的真实设备库存可能不足；不能把 Playwright viewport 结果标记为真实设备
  通过，必须在兼容矩阵中区分 `emulated`、`lab-device` 和 `field-report`。

## 4. 新规格入口

- [Spec 53：安装、升级、备份、迁移与故障恢复](../specs/53-host-install-upgrade-backup-recovery.md)
- [Spec 54：本地与云模型配置向导](../specs/54-model-provider-onboarding.md)
- [Spec 55：公网部署、证书自动化与运维文档](../specs/55-public-deployment-certificates-operations.md)
- [Spec 56：多语言、无障碍与真实设备兼容矩阵](../specs/56-i18n-accessibility-device-matrix.md)
- [Spec 57：Release 发布流水线与供应链证明](../specs/57-release-publishing-pipeline.md)
