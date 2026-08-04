# 上游 Provider/Usage 调研记录

状态：Research gate / live source verification required before implementation

本文档只保存可复核的元数据和语义摘要，不保存上游源码。源码临时目录为被 `.gitignore` 排除的 `.research/upstream/`。

## 研究规则

- 每个结论必须包含 repository URL、commit、读取时间和文件路径；
- 先读取 LICENSE/NOTICE，再读取实现；
- “设计借鉴”与“代码复制”分栏记录；
- 没有固定 commit、路径或许可证证据时，结论标记为 `unverified`，不能进入实现；
- 用户提到的 `axonhub/ccswitch` 必须先确认 canonical repository，不允许凭名称猜测。

## 目标项目清单

| 项目 | 候选 canonical URL | 当前证据状态 | 计划核对内容 |
| --- | --- | --- | --- |
| CC Switch | https://github.com/farion1231/cc-switch | unverified in current checkout | proxy/session 来源、request/message ID、去重、cache 语义、TTFT、rollup/prune、LICENSE/NOTICE |
| AxonHub | https://github.com/looplj/axonhub | unverified in current checkout | token taxonomy、cache read/write、reasoning/TTL、flat/per-unit/tiered pricing、cost items、许可证分层 |
| LiteLLM | https://github.com/BerriAI/litellm | unverified in current checkout | provider normalization、pricing lookup、retry 与 Python runtime 边界 |
| Langfuse | https://github.com/langfuse/langfuse | unverified in current checkout | generation/trace/token/cost projection、许可证例外目录 |
| OpenTelemetry Specification | https://github.com/open-telemetry/opentelemetry-specification | unverified in current checkout | resource/metric/timestamp/attribute 语义，不引入 Collector |

## 已写入 VibeGo 设计的待核对假设

以下内容已经进入 [Spec 43](../specs/43-resource-usage-and-cost-audit.md) 和 [Spec 44](../specs/44-provider-usage-management-and-upstream-reuse.md)，但在实现前必须由 agent 用固定 commit 重新核对：

- token 不能只分为 input/output；缓存读写、reasoning 和多模态维度需要独立字段；
- `fresh` 与 `cache-inclusive` 的 input 语义必须显式记录；
- request/message/session 的来源和稳定 ID 应优先于时间或内容猜测；
- 相同 usage ID + 相同内容是 no-op，不同内容是 conflict；
- retry attempt 必须保留，逻辑请求汇总需展示 attemptCount；
- 价格采用版本化 rule 和 cost item，缺价格时为 unknown 而非 0；
- rollup、prune、import 都是 projection/管理能力，不是 run 的第二事实源；
- VibeGo 不扫描用户目录、不把上游 proxy 或 CLI session 作为默认输入。

## 当前阻塞

当前工作区没有上述项目的 pinned source snapshot；本轮 GitHub 网络访问未成功。因此本文件不宣称已经验证了上游当前实现，也不授权复制任何代码。下一位开发 agent 必须先完成第 2 节研究规则，再进入 44-R1。

## Agent 完成后应追加的记录格式

```text
### <project> @ <commit>
- repository:
- checkedAt:
- license / notice:
- filesRead:
  - <path>: <semantic observation>
- designIdeas:
- codeReuseCandidate:
- reuseDecision: clean-room | copy-with-notice | blocked
- licenseNotes:
- VibeGo divergence:
- tests or fixtures added:
```
