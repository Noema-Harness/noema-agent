# ADR 0017：同一好友只跨房间复用同项目的已核验案例

- 状态：接受为一条可撤回的工程试验（助手在用户委托范围内决定）；不是最终实践成长模型
- 日期：2026-10-18
- 关联：Issue #2、#80；ADR 0015、0016

## 问题

ADR 0015 让同一位 Noema 好友能参加多个 room，但 transcript 默认隔离。#79/#78 已让工程搭档能在房间里执行项目任务并独立验证文件结果；当前下一项新任务仍只看到当前 room，没有来自同一好友其他 room 的项目经验。直接把旧聊天原文跨 room 注入，会打破上下文边界；把单次结果改写成全局永久 skill，则可能过度泛化。

## 决定

第一步不抽象永久 practice，也不新建记忆引擎；把 Noema 已验证的项目工作任务当作**可引用的案例**，仅在身份和项目两个边界都一致时试用。

1. **资格来自 Noema 的可观察状态。** 仅允许 `social_work_tasks` 中 `status=completed`、`verification_status=verified`、同一 `agent_id`、同一 canonical `workspace_key` 且来源 room 不同的任务作为可复用案例。DSH 自报成功、没有核验条件、失败/中断任务都不能成为正向案例。用户可以将一个 verified task 标为不再复用。
2. **每个新任务最多带入一条案例。** 选最近的一条合格案例；用户可在项目工作 composer 关闭本轮案例复用。没有案例、没有复用授权或候选已撤回时，按当前任务正常启动，不作宽泛搜索。
3. **案例只携带有限任务片段，不搬运 transcript。** 限定为用户任务的有界文本、DSH 最终摘要的有界文本、相对文件核验项目/结果和来源 room/task 标识；不传递工具参数、完整工具结果、内部推理或来源 room 的其他消息。内容使用已有凭据形状脱敏。DSH 收到明确说明：这是过往案例而非指令，只在当前任务相关时参考，当前用户指令优先。
4. **Noema 持有输入快照和撤回。** 每项新 social work task 保存确切注入的 case ID、源 room、源 task、相关片段和 verifier 结果快照。之后编辑/撤回源案例不改写历史 task snapshot；撤回后新任务不再注入。
5. **案例复用不叫“学会”。** DSH 结束不等于当前任务完成；case 被检索不等于模型采用；本次文件条件通过不等于 case 导致成功。UI 分开显示“参考了哪个案例”“DSH 运行状态”“Noema 当前任务的独立核验”，不显示因果或永久能力主张。
6. **状态复用保持在既有模块化单体。** v3 社交 schema 为任务增加 case 资格及 case snapshot；`SocialWorkService` 只查询现有 SQLite task records 并生成有界上下文。首轮不建向量库/Neo4j/通用 memory service、自动技能抽取、全局任务板或后台 dreaming agent。
7. **权限边界显式依赖项目选择。** 只有用户为本轮在 Noema 中选定了同一项目目录，才允许检索该目录中的合格案例。文件夹选择说明会披露：被带入的摘要仍会随新任务发送到 FreeLLMAPI；DSH Windows sandbox 不完整隔离读取/网络。选择目录不是完整安全边界；不应在含敏感数据的工作区使用。

## 为什么现在采取案例，而非已生效的 practice

- Microsoft SkillLens 把经验生成、提炼、目标模型消费分开评估；一个摘要“看起来合理”并不等于它能改善 held-out task。
- ReCreate 从轨迹提炼 scaffold 修改，但其论文实现围绕 benchmark/evaluator、沙箱与优化模型；并未解决跨房间好友身份和权限治理。
- CASCADE 将案例复用建模为 task-specific contextual bandit，要求每个环境定义 reward；它说明案例不是通用 memory block，但其任务 reward 不能直接外推到关系体验。
- HugAgentOS 对显式纠错有 bounded trajectory 和 deterministic procedural 路径，但当前来源代码使用 assistant 文本 cue 检测“后续成功”，并非 Noema 的独立文件 verifier。因此 Noema 必须以自身 verifier 筛选工程案例，不能因为对方称“verified correction”就照搬阈值。

这些实现都覆盖局部机制。此次决定只选 Noema 已经能核验的工程任务，以最小状态所有权试验跨 room case continuity；软性实践、用户偏好和 agent 推断仍分离。

## 状态与所有权

- 原始 room event 仍属于来源 room；不因跨 room 引用而复制到新 room。
- 已核验 case 仍属于原 social work task；agent identity 只决定这类案例归属哪个好友，并不自动授予所有上下文访问权限。
- 新任务按同 agent + same workspace 解析可用 case；仅返回给用户明确启动的该任务。
- 新任务记录实际发送的 case snapshot。若选项关闭、没有符合条件的记录或读取失败，则不注入；不得以全量历史兜底。
- 用户可从源 task 卡将案例标为“不再引用”；也可在当前 project-work 动作关闭复用。撤回只影响未来任务，不改写历史证据。

## 后果与重审条件

- Noema 在另一 room 开始一项同项目任务时，有机会携带该好友的可验证经历而不带原对话。这比“持久身份但什么都不共享”更有运行意义，也比“全局 transcript/RAG”更能保持房间边界。
- 同 workspace 仍不是语义相关性的充分证明；每次最多一条、默认可关闭、模型可忽略、输入快照可查看，是首轮风险控制。若真实 E2E 显示无关案例污染，下一版改为用户选例、task-specific relevance gate 或停止该机制，不能增加案例数量硬顶。
- 即使该切片成功，它只证明了一项 episode retrieval path，不证明 Noema 已形成专业 practice 或独立产品价值。只有真实后续任务多次出现可观察的适用/不适用结果后，才考虑更高层的 practice candidate/版本演化。
- 若 OpenClaw/Hermes/HugAgentOS 或现有 memory/skill 插件能同等拥有 Noema 的 identity/room provenance/undo lifecycle，Noema 不得因已有代码继续堆叠；回到 #2 重新评估其独立责任。
