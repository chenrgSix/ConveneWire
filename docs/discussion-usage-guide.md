# Discussion 使用与验证指南

## 当前投入方向

[ADR-0045](adr/0045-freeze-discussion-v1-and-replay-workspace-evidence.md#post-comparison-adoption)
明确冻结 Discussion v1 功能扩张，继续维护可靠性、恢复、事实审查与现有显式控制。
日常任务先用单 Agent，并明确验收；有独立资料或不同职责需要汇合时，再显式
选择 Discussion。该建议不改变 UI 默认值、路由或现有授权。

当前实测没有显示所测 Discussion 配置的交付优势，也没有证明单 Agent 的
答案已可靠。题目复杂、多人一致、Run 完成或评分更高，都不能代替任务验收。
原始结果与逐项评价见下方证据索引，不在使用指南重复实验过程。

## 如何选择

| 任务情况 | 建议起点 |
| --- | --- |
| 事实已足够，需要计算、局部修复、诊断或方案 | 单 Agent，列清交付与硬约束 |
| 已有回答缺少依据 | 先补齐资料或修正具体遗漏 |
| 需要不同工作区的独立事实或不同职责的意见 | 明确每个成员补充什么，再显式协作 |
| 流程本身需要保留多方意见 | 可用 Discussion 收集意见，另外验收最终结论 |

普通 Wave 的成员并行贡献，Reviewer 不能读取同轮尚未产生的回答；Finalizer
才会汇合已接受的贡献。资料读取、贡献传入、最终答案正确使用资料，应分别核对。
Reviewer 自报通过不构成人工接受或执行授权。

对于带正式验收标准的 Task，成员按 `criterionKey` 组织事实、引用、推断、
假设、已执行的检查和缺口。已有权限允许提交 Result 时，可使用普通 Result
保存 `criterionClaims`，并在回复评估的 `newEvidenceRefs` 中引用该 Result ID。
后续指令的逐项证据索引只选取已接受成员 Run 明确引用、且定义和标准版本一致的
Result；同轮、未完成和补到的迟到贡献不混入已冻结的指令。普通文本回复仍可使用，
但不自动变成结构化证据。索引显示未纳入条目数量，不能把未显示内容当成不存在。

## 日常任务的执行与验收

在 Room 选择一个 Agent 开始。下面是任务内容示例，不是新增字段或自动验证器：

```text
目标：这次具体要解决什么问题。
资料：可读取的代码、记录、要求，以及已经确认的事实。
硬约束：必须满足的权限、兼容性、资源、时间或数据边界。
交付：需要给出的结论、修改、计算或方案。
验收：怎样用测试、原始记录或可复算结果检查交付是否正确。
未决项：明确缺失资料、无法证实的结论，以及下一步所需证据。
```

收到答案后核对每项交付和硬约束。Result 仍走现有审核、接受和完成流程，
尤其不能把看似完整但不可执行的方案直接采用。

在工作台打开 Task 的 Results，展开“逐项核对证据”，可对照该版本的正式验收
标准、本结果回应和此前贡献。页面会标出未回应、覆盖声明不同及此前有但本次未
引用的证据；这些是需要核对的结构性差异，不代表系统已经判断哪一方正确。
代码成果另显示与精确候选、输入和验证配置对应的回执。未执行、失败、超时、
未知结果或无法匹配，都不会显示为必需检查通过。检查通过也仍需人类决定接受。

| 工作类型 | 优先检查的证据 |
| --- | --- |
| 审查或修复 | 对应代码、触发条件、最小修复、行为回归，以及应保留的正确控制 |
| 问题诊断 | 统一时间线、观察与推断、未知状态、安全恢复依据及具体修复/回归 |
| 方案比较 | 候选与约束的对应、可复算数字、全部依赖和时长、回滚及就绪条件 |

需要协作时，指定独立贡献、最终交付、参与规模和轮次/时限；用相同任务要求
验收最终答案是否纠错、保留正确内容并覆盖未决项。另观察实际 Run 和等待时间，
不要把预算槽位解释成成功 Run。

## 证据索引

| 范围 | 保留的结论与入口 |
| --- | --- |
| 初始小规模基线 | [QA-065](acceptance/qa-065-discussion-benchmark.md)：固定任务与原始评分 |
| Finalizer 提示与封闭输入对照 | [QA-067](acceptance/qa-067-discussion-review-value.md)、[QA-068](acceptance/qa-068-discussion-continuation.md)：回放、完整配对及失败 |
| 历史工作区资料回放 | [QA-069](acceptance/qa-069-workspace-evidence-replay.md)：三组配对、全部失败与最终审核 |
| 新构造复杂工程题 | [QA-070 详细评价](acceptance/qa-070-complex-discussion-results.md)：逐项评分、具体错误和原始答案索引 |
| 固定证据访问 / 使用机制筛查 | [QA-072](acceptance/qa-072-evidence-access-use.md)：九次名额已消耗，七份答案、两次 C 工具边界失败；没有来源读取回执，Q1/Q2 尚无法归因，不构成产品质量提升证据 |
| 修复后的新三臂筛查 | [QA-074](acceptance/qa-074-evidence-access-use.md)：九次均完成；B 有权限但三次均未读，C 三次均读全四份证据；完整目标纠错 A/B 为 0/3、C 为 1/3，Q1 缺少 B 实际取证、Q2 为混合信号；新授权已消耗 |
| 证据与 claim 对齐筛查 | [QA-075](acceptance/qa-075-claim-adjudication.md)：六次新 C/D 均读全四份来源且目标纠错均为 3/3；D 的六项结论表判断正确、六项正文一致性通过，未证明额外纠错收益；修复策略与测试仍不完整，调用授权已消耗 |
| 逐项证据交付机制 | [QA-071](acceptance/qa-071-criterion-evidence-delivery.md)：Result 对照、Finalizer 索引与代码候选验证的确定性验收，不是模型质量实验 |

各题包分别解释，不合并评分。样本来自一个请求模型配置和非盲任务内审核；
资料分配与贡献压缩会影响 Finalizer，结果不代表真实用户成功率、返工率或
所有多 Agent 工作流的价值。运行失败保持不评分，不能当作质量零分。

## 维护与后续验证

现有确定性聚焦及 Broad fallback 保留。按顺序取 Top-N 可能丢失所需专业视角；
仅减少参与者数量不足以证明质量收益。自动启动判断、默认 Top-N 切换、LLM
router、embedding selector 及对已评分题目的继续调参均暂停。

新实验应由独立真实任务或明确工作流假设驱动，预先固定比较、验收与调用上限，
并披露资料访问差异。旧实验授权已用完，命令存在不代表可以重新运行。
维护使用以下离线入口；精确脚本以 `package.json` 为准：

- `npm run test:discussion-benchmark`：全部基准适配器、题包与合成 Server/Bridge 回归。
- `npm run test:discussion-workspace` / `npm run test:discussion-complex`：对应题包的聚焦离线回归。
- `npm run test:discussion-codex-bootstrap`：已安装 CLI 的无认证本地回环检查，不调用外部模型。
- `npm run test:discussion-evidence-access`：QA-072 历史冻结校验、读取授权与回执，以及 [QA-073](acceptance/qa-073-evidence-reader-repair.md) 的工具发现、调用记录和最终答案区分；三臂 CLI 通过 HTTP / WebSocket 本地回环验证，不调用外部模型。实际模型调用计划已经关闭。
- `npm run test:discussion-evidence-screening`：QA-074 的 manipulation gate、读取范围覆盖、单次授权和九次留存结果审计；不调用外部模型，QA-074 实验入口已消耗。
- `npm run test:discussion-claim-adjudication`：QA-075 的 C/D 公共输入、结论表格式、实际来源返回绑定、六次上限和留存评分/摘要审计；不调用外部模型。[QA-075](acceptance/qa-075-claim-adjudication.md) 只研究 Evidence → Claim → Final，语义矛盾单独评分并保留，不改变生产 Discussion；实验入口已消耗。

[ADR-0043](adr/0043-remove-discussion-token-cost-accounting.md) 继续排除 token
和费用统计，保留实际 Run、轮次、槽位与耗时。交付状态只在 [TASKS.md](TASKS.md)。
