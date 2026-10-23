# ADR 0024：把明确互动约定接回 Noema 社交聊天

- 状态：已被 ADR 0030 取代；保留作历史实现记录
- 日期：2026-10-19
- 决策者：助手，在用户委托的 Noema 产品与工程范围内决定
- 依据：用户明确希望 Noema 作为能从交流中形成连续性的个人伙伴；本地代码检查发现 RootStore/RootAgent 已有可编辑、可撤回的互动调整机制，但当前主社交聊天完全绕过它；SocialWorkService 也未注入 `coding` 调整，尽管文件选择披露声称可能发送这些调整。
- 关联：Issue #2、#101；ADR 0006、0008、0015

## 问题

Noema 的用户可见主界面已切换为社交聊天，旧 RootAgent 的调整工具和时间线仍留在 `#legacy` 渲染路径。当前 `SocialChatService` 只发送固定 agent system prompt、转发说明和 room transcript；它既不能从 Noema DM 中保存用户明确纠正，也不会把现有 `conversation` 调整带入 Noema 回复。Social project-work prompt 也没有包含 `coding` 调整。于是“已记录”状态无法作用于用户日常主路径，成为遗留代码，而不是 Noema 的持续性。

## 设计审查

- **问题与使用情境：**用户在与 Noema 的私聊中明确纠正一种交流方式，之后继续与同一 Noema 对话时不应因 UI/上下文拆分而重新训练；同样，明确的编码协作调整应进入 Noema 发起的新项目任务。
- **为什么由 Noema 持有：**这些是用户对 Noema 自身和 Noema 发起协作的明确约定；外部 harness/agent 不能作为它们的唯一 owner。RootStore 已是本地 source of truth，继续复用，不建通用 memory subsystem。
- **事实与假设：**RootAgent 旧路径确实会保存并带入调整；当前 social 路径确实没有对应逻辑。把同一条状态应用到新的主路径是助手在用户委托范围内的设计决定。它是否让用户觉得 Noema 更像同一个个体、是否足以成为日常价值，仍未证明。

## 决定

1. **保持单一逻辑状态。** 继续使用 RootStore 的 `interaction_adjustments`、编辑、撤回和上限；扩展来源元数据为 `root` 或 `social`，social 来源记录 room 与 user turn。一次事务迁移旧行并保留原始文本，不复制完整 transcript，也不静默删行。
2. **保存必须由用户明确发起。** 在与 Noema 的直接聊天中，用户可从自己的消息选择“保存为互动约定”；一个紧邻消息的轻量编辑区显示精确来源引文，并由用户填写适用情境、期望行为和 scope。专家好友消息及普通分享不会自动升级为记忆。Noema 不额外调用模型来推断该记录。
3. **按身份和范围应用。** `conversation` / `both` 只在 Noema 自己回应时带入；`coding` / `both` 只在 Noema 发起新的 Social project-work 时带入。专业联系人普通聊天不继承 Noema 的对话约定。scope 不授权文件或网络工具。
4. **带入快照可追溯。** 每条可见社交回复的当前 attempt 及每项 Social project-work task 都保存实际组装的 adjustment ID/value snapshots；未来编辑不倒写历史。UI 可按需查看“本轮带入了什么”。这证明本地组装，不证明上游成功接收或模型遵循。
5. **保留 correction lifecycle。** 用户可从来源消息编辑/撤回；新值只影响后续请求。旧 source quote 与来源不可编辑。超限时显式提示，不淘汰旧约定。
6. **失败行为明确。** 保存失败时显示未保存，不将当前消息静默转为约定；IPC 只允许受信任 renderer 调用。provider 不可用不妨碍本地查看、编辑和撤回已有调整。

## 替代项

- **继续只支持 `#legacy` root chat：**与当前社交主界面脱节，用户在 Noema 私聊里纠正后仍无法形成连续性；拒绝。
- **让模型自动总结普通聊天：**容易把分享、观点或临时意图升级成长期状态；用户已多次反对这类过度推断；拒绝。
- **新增独立 social-memory 表：**会形成两个可编辑/撤回的逻辑状态 owner，增加冲突与上下文噪声；复用并迁移既有 RootStore 表。
- **全局注入到每个 agent：**会混淆 Noema 核心伙伴与专业好友身份；按 agent identity 与 surface scope 分离。

## 后果与重审条件

- 需要兼容性 schema migration、社交消息/任务快照字段、一次明确的用户写入流程和轻量 source-message controls。
- 交付只证明旧调整状态接入新主路径、来源和应用可追溯；不宣称自然度、个体性或因果效果改善。一次用户纠正本身也不等于用户持续喜欢这种功能。
- 如果用户很少显式记录、仍重复纠正、觉得编辑打断聊天，或这套状态无法影响后续互动，应删除或收窄 UI/状态，而不是继续增加自动记忆类型。
