# QA-080：撤权场景工具兼容与失败收敛

目标：修复 QA-079 暴露的两个缺口——允许安全的原生资源发现，并在会话失败后
将 Central Run 从 `working` 收敛到明确终态。依据
[ADR-0054](../adr/0054-close-authority-session-protocol-failures.md)，交付状态仅在
[TASKS](../TASKS.md) 登记。

本轮是离线机制修复，不重跑 QA-079，不新增真实模型会话，不修改原题、原评分
或生产 Discussion 策略。当前协议另用维护适配器承接，历史冻结代码保持原样。

## 结果

**两个已观察到的缺口已在实验维护适配器中修复并完成离线验证。** 正常原生
发现不再导致误停；读取或运行失败不再只留在本地日志，而是写入明确的 Central
终态。QA-079 的历史失败依旧保留，不能改判为该次模型已经交付。

| 实际验证 | 结果 |
| --- | --- |
| 原生资源发现 → 模板发现 → reader 发现 → 受权读取 | 目录为空且不含原文；随后 1 次受权来源返回到本地 provider context，形成 1 个 informational Result |
| 只发现目录，不读来源 | 0 次来源返回、0 个 Result；以 `EVIDENCE_INCOMPLETE` 写入 `failed` |
| 读取未授权原文、撤销后的来源、原生 resource read | 均无来源成功返回、无 Result，写入 `failed` |
| 超时、进程启动失败、抛出内部异常、空终稿 | 分别保留原因，均无 Result，写入 `failed` |
| 取消 | 写入 `canceled`，无 Result |
| 终态写入不可达 | 保留 `pending_terminal` 和不变的本地意图，不重跑模型 |
| 终态提交后杀死进程、丢失确认，再重放 | 返回 `replayed`，只有原 `working` 加一个终态事件，无重复事件 |
| 替换 Team/Room/Task/Run/Agent/请求成员 | 六种替换均拒绝，原 Run 不变 |
| Run 已经完成，再收到失败意图 | 保留原 completed 和唯一 Result，报告 `terminal_conflict` |

[验证记录](evidence/qa-080-session-recovery.json) 保留 13 个具体场景、实际工具
身份与状态、来源返回数、Central 最后事件、重放结果，以及实现提交
`7a7ee86` 的八个文件摘要。CLI 是 `0.153.4`，Node 为 `v22.23.1`。
所有 provider 响应均来自无认证回环固定脚本，**外部模型调用数为零**；不评价
GPT-5.5 的纠错能力或撤权后的自然语言交付质量。

16 项新行为检查及留存证据审计通过；QA-079 的 15 项历史检查及原始评分复算
保持通过，冻结内容和初评未变。419 份 Markdown lint、文档链接和差异检查通过。
实际 CLI/MCP、临时 Central 及本轮所有暂存根目录均清理。

## 验收要求

1. 当前安装 CLI 在无认证回环中实际调用资源/模板发现后，仍能发现并调用受权
   reader；目录发现与来源返回分别记录。
2. 不调用 reader 就没有 source return；目录访问不能变成原文读取许可。
3. 原文身份、跨域来源、错误 Run/版本/范围和撤权读取继续拒绝；失败、未完成或
   身份变化的工具调用不得被包装成成功。
4. 被禁止的工具、进程错误、超时、取消及无终稿都形成内容无关的失败意图，并
   通过现有 RunRepository 写入终态；不发布候选文字或制造 Result。
5. 同一失败意图重放与提交后丢确认可恢复，不重复事件、不覆盖既有终态、不调用
   模型；Central 不可写时明确保留待收敛状态。
6. 正常完成仍进入既有 informational Result，不伪造接受；原始 QA-079 记录、
   冻结文件和初评可继续离线核对。

## 已知根因与实施边界

QA-079 的 Finalizer 调用了 `codex/list_mcp_resources`，冻结监测器只接受
`evidence/read_evidence` 与原生 `tool_search`，因此终止会话。适配器只在
有合格终稿时发布 Result，没有对失败写入 Central 终态，留下 `working` 事件。

[OpenAI 官方 MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
说明 `enabled_tools` 是服务器工具允许集合、`required` 控制初始化失败。
这些配置不能直接证明原生资源发现的具体 CLI 事件形状或实际返回范围；本轮
以安装版本的物理回环记录验证，不能仅靠文档或事件名称推断安全。

## 维护实现

- [authority-session-observer.mjs](../../scripts/bench/authority-session-observer.mjs)
  对两个精确原生发现工具单独计数，保留真实工具身份；读取、失败、未完成和
  身份变化分别处理。仍拒绝原生资源读取和其他服务器工具。
- [authority-session-runtime.mjs](../../scripts/bench/authority-session-runtime.mjs)
  承接新协议并支持取消；复用现有读取许可、reader 和隔离配置。
- [authority-session.mjs](../../scripts/bench/authority-session.mjs) 的
  `runAuthorityFinalizer` 监督一次已分配的 Finalizer，会话或读取失败先落盘终态
  意图，再写 Central；正常输出继续走现有 ResultService。它不是生产调度器或
  并发 admission gate，调用名额仍由外层明确计划控制。
- [authority-run-terminal.mts](../../scripts/bench/authority-run-terminal.mts)
  在实际 SQLite 事务中重核 Team/Room/Task/Run/Agent/请求成员，写入现有 Run
  终态；不创建 Result、不覆盖其他既有终态。
- [回环与故障测试](../../scripts/bench/authority-session.test.mjs) 使用本地
  固定响应和实际安装 CLI；模型服务不参与。终态意图重放只调用本地状态写入器。

失败意图与文件目录均同步落盘。Central 写入失败保留 `pending_terminal`；
提交后丢确认可重放为 `replayed`，发现既有不同终态则保留它并报告
`terminal_conflict`。这些都不触发另一次模型调用。它不是物理 Owner 主机丢失、
控制器在保存意图之前崩溃、任意磁盘损坏或 Bridge 网络恢复的全面保证。

旧 QA-079 runtime/observer、题包和首评是已消耗实验的冻结输入，因此未替换；
未来受控协作验证使用上述维护入口，不重新打开历史实验。这次修复尚未接入
生产 Discussion 或 Bridge。没有新增贡献存储、完成策略或模型提示机制。

安装 CLI 的回环还揭示一项可观测性限制：provider 仅返回 `commentary` 时，
CLI JSON 可能省略 phase，且写入 last-message 文件。本轮保留这个观察，不把
该文件当成“模型确认已完整交付”的证明。未读来源的该例被监督器以
`EVIDENCE_INCOMPLETE` 收敛；真正空终稿以 `NO_FINAL` 收敛。已读全来源后的
语义完整性仍需要正式验收，不能由 CLI 成功或非空文件代替。

维护命令：

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- node --test scripts/bench/authority-session-observer.test.mjs scripts/bench/authority-session.test.mjs scripts/bench/authority-session-evidence.test.mjs
```

## 真实多 Owner、多设备阶段的准备

需要负责人/设备别名及系统、各自独占的资料类型、不能集中原文的实际原因，
以及允许进入共享 Room 的事实范围。凭据留在各 Owner 的设备，不交给实验作者。
在这些信息明确后，再冻结实际任务、Bridge 身份、资料版本、接收范围、撤权和
中断步骤、调用上限及完整交付标准。本轮离线通过不等于真实设备验收通过。

还需验证 Owner 本地披露门与认证 Bridge 回传的衔接，证明原始资料及私有模型
回复在回传前被隔离；现有 QA 的服务层直接调用不能填补这一证据。不能只换成
两台机器，就把当前合成结果改名为多 Owner 产品验收。
