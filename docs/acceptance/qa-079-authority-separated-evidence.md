# QA-079：资料不集中时的证据协作

目标是：**原始资料不能集中、共享内容需要单独授权时，完成一个跨域审查，
并在中断或共享授权撤销后保持正确的权限、证据和结果。**

按 [ADR-0053](../adr/0053-screen-authority-separated-evidence.md) 执行。
Owner 已授权目标制定至实验完成。交付状态只记录在 [TASKS](../TASKS.md)。
Equal-compute 后置；这轮不改生产 Discussion 的调度、存储、成员选择或完成策略。

## 已确认的基线缺口

- 现有 Result 读取检查 Room 成员资格，不能替代逐来源/字段的披露授权。
- `verifiedEvidenceRefs` 证明引用及 Task/Room 归属，不证明原文读取许可或事实正确。
- QA-078 的 Finalizer 可读全部原文；其成功不能证明原文不集中时也能完成任务。
- Worktree 与不同会话不等于操作系统安全域。此次明确测试工具与出口权限，
  不宣称跨真实机器或模型服务提供方的数据隔离。

## 冻结范围

新题是合成的签发 CA 切换审查：代码域知道实施行为，安全域知道生效规则，
运行域知道固定版本的设备和证书快照。三个域独立读取各自原文；Finalizer
只取得获准共享、经本地程序验证的事实和来源回执。它不能读取三个原始来源。

公开验收逐条说明最终需要回答的问题。每个事实单独编号，参考答案与评分仅由
实验作者保留，不能进入参与模型上下文。来源、共享字段、接收范围、本地验证器
和正常/故障场景的预期行为都在调用前冻结。输出 JSON 只用于成员的受控出口；
Finalizer 输出普通可读报告，不添加自评表。

| 场景 | 固定处理 | 预期机制行为 |
| --- | --- | --- |
| 正常 | 三个来源域均可读、可共享 | 只发布获准事实，Finalizer 按全部公开要求交付 |
| 中断恢复 | 一个 Result 已提交但协调器尚未收到确认时终止并重启协调器 | 不重新调用成员模型、不重复 Result、不丢失已提交事实 |
| 撤销共享 | 运行域完成本地读取后、发布前撤销其共享许可 | 拒绝发布及缓冲重试，Finalizer 不猜测运行状态，明确保留未知 |

每场景最多三位成员和一位 Finalizer，共最多十二次 GPT-5.5/low 会话。
无真实模型试跑、重试、替换或额外裁判；三个故障条件不当作三次统计重复。
另用不调用模型的负例验证越权读取、撤销/过期、来源和接收者替换、恶意输出。

本轮通过需要同时成立：权限边界有效、获准内容能沿既有 Result 链路流转、
被测试的中断/撤销行为符合约定、最终答案达到对应场景的公开验收。
机械链路通过和模型答案通过分别记录；出现一项失败，也照实完成留档，不加跑。

## 实现与记录

目标与架构先由提交 `558b014` 登记。完整题包、参考答案、原子评分、代码及
运行条件随后完成冻结；实验只在该冻结提交后启动。

- [题包](fixtures/qa-079/packet.json)：14 项公开要求、16 个独立共享字段、
  三种场景及十二次会话上限。
- [参考交付](fixtures/qa-079/reference.md) 和
  [评分](fixtures/qa-079/scoring.json)：逐项对应公开要求；撤销场景不能猜测
  被扣留的运行事实，也不能把未知当作检查结果为否。
- [代码域](fixtures/qa-079/owners/code.mjs)、
  [安全域](fixtures/qa-079/owners/security.mjs)、
  [运行域](fixtures/qa-079/owners/operations.mjs)：独立新合成原文，包含不会
  获准共享的专用标记和机器名称；不冒充真实秘密或生产状态。
- [本地验证器](../../scripts/bench/authority-owner-verifier.mjs)：每次独立
  子进程只载入一个域的来源，运行该域检查并返回固定类型的观察值。
- [权限与出口](../../scripts/bench/authority-collaboration.mjs)：原文版本和
  范围绑定当前 Run；共享另校验 Owner、Task/Room、接收 Finalizer Run、字段、
  版本和有效期。模型只提候选值，程序拒绝错误值和额外自由文本，不自动填补遗漏。
- [实际 Result 适配器](../../scripts/bench/authority-central.mts)：使用现有
  Server、SQLite、Run 事件与 ResultService；只有获准的签名封包进入 Result。
  所有 Result 都是 `informational` 提案，`criterionClaims` 为空，不伪造人工接受。
- [冻结记录](fixtures/qa-079/freeze.json)：287 个文件，含上述资料、代码及其
  Server/contract/reader 依赖、CLI 指纹和 Node 版本。旧 QA-078 文件不修改。

出口在创建 Central 请求之前检查当前许可，并持有本地授权锁直到该次发布
结束。撤销后，已准备好的封包也不能变成 Central 请求；仅允许发送不含观察值的
“本地已完成、共享被拒绝”状态。已经合法读到的内容不会被声称可以追溯收回。

本轮三个逻辑资料域使用同一个测试 Owner 下的三个 manual Agent、不同来源
bundle 和授权，不测试三个真实人的登录或三个 Device 的认证。Result 发布直接
调用现有服务层；不是 Bridge 网络回传的完整产品 E2E。不同资料域的私有审计
分开保留，模型看不到对方审计；受信任的题包作者和测试控制器仍持有全部合成
资料，也不宣称模型供应商之间的隔离。

中断点是 Result 已提交、确认尚未返回的发布子进程。Owner 侧持锁进程仍在，
负责清理锁并重新检查授权后重放固定操作。若 Owner 侧自身持锁崩溃，残留锁会
拒绝后续发布；本轮不宣称这种情况可自动恢复。

## 运行和维护命令

不调用外部模型的维护入口：

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 180000 -- node --test scripts/bench/authority-collaboration.test.mjs scripts/bench/authority-experiment.test.mjs
node scripts/bench/authority-experiment.mjs --audit-qa079
node scripts/bench/authority-experiment.mjs --assess-qa079
```

后两个入口分别核对实际记录与已保留的语义评分，不执行模型或自动判断自然语言。
唯一一次真实执行命令为：

```sh
node scripts/test/run-with-temp-root.mjs --timeout-ms 3090000 -- node scripts/bench/authority-experiment.mjs --execute-qa079-frozen-twelve
```

journal 创建即占用本轮许可，不能作为维护重跑入口。控制器意外中断也不恢复
模型会话；正常计划内的发布子进程恢复不新增模型调用。无需重新使用旧 QA 授权。

执行前验证：13 项新离线检查通过，两项依赖未来真实记录/初评的审计明确跳过；
9 项既有 reader/CLI 回环检查、19 项 QA-078 检查通过，417 份 Markdown 无 lint
问题。参考交付 4,354 字节，低于相同终稿上限。CLI 为 `0.153.4`，Node 为
`v22.23.1`；以上过程没有真实模型试答。暂存文件与临时 Server 数据在检查结束
后清理。实际实验结果在执行后单独记录。
