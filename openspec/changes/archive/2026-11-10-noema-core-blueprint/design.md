# Design

## 目标

Phase 0 只回答“系统应该由哪些稳定边界组成、为什么选这些技术、按什么顺序替换”，不写核心实现。所有结论必须能追溯到研究证据或当前代码事实。

## 五平面与依赖

- 身份/关系：用户可见唯一 Agent；人格、关系、授权和长期承诺。
- 记忆/连续性：Episode、MemoryItem、Checkpoint、Branch；是 Noema 的连续性资产。
- 认知/对话：TurnService、ContextCompiler、模型适配；只负责一次可解释的轮次。
- 执行/成长：Ticket、ExecutorAdapter、workspace、evidence、capability ledger；执行器不拥有人格。
- 证据/评测：trace、eval、review；能力升级必须有证据。

依赖方向固定为上层依赖下层契约，不反向读取 UI 状态；执行层不能读人格/用户记忆，UI 不拥有持久状态。

## 关键选型

- D1：条件采用 `@earendil-works/pi-agent-core` 1.5.2，放在 `TurnService` 后；Phase 1 先做 spike，失败则退回 AI SDK v7 或自建循环。
- D2：自建确定性 `ContextCompiler`，输出 `ContextPlan`；不把检索/压缩黑箱塞进模型。
- D3：SQLite 追加式 turn DAG、显式 branch/head CAS、step 检查点；编辑即分支，不做破坏性 rewind。
- D4：SQLite 类型化记忆脊柱 + FTS5；`sqlite-vec` 只做可丢弃索引。
- D5：原生 `noema-exec` ticket broker；DSH 仅适配器，MCP 只是工具协议。
- D6：自建 SQLite trace + promptfoo 离线评测；不把 Langfuse 等作为本地必装依赖。
- D7：最小核心对话 UI，不拥有状态。
- D8：一个主模型 + provider 适配层。
- D9：旁路、影子、小流量、默认、清理；不做新旧双写。

详见 `docs/architecture/TECH_SELECTION_MATRIX.md` 与 `docs/architecture/adr/`。

## 迁移与回退

旧 thread 迁移为分支；迁移前保持只读。0.6.9 是安装回退，旧数据保留可读。Phase 1 只做旁路与数据迁移验证，默认路径不变；通过门禁后才切换。

## 风险

- pi-agent-core 是 0.x，治理和重试/用量语义未稳，必须 spike。
- LPAC 对任意 Node/npm/git 的可用性未证实；P1 只能标注“非隔离”。
- 自建 ContextCompiler 规则复杂，需要确定性和保留率评测。
- 记忆冲突、派生删除和多设备同步仍未定策。
- 大迁移容易变成双轨长期化；每阶段必须清理旧入口。

## 非目标

- 不在 Phase 0 改产品代码。
- 不一次性重写旧 OpenSpec 规格。
- 不把“意识”“社会账号”作为架构前提。
- 不引入需要外部服务才能启动的本地依赖。
