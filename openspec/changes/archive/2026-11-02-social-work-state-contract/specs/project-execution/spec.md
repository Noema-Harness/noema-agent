# Spec Delta

## ADDED Requirements

### Requirement: SocialWork task 状态具有唯一持久 owner
系统 SHALL 以 SocialChatStore 保存的 `social_work_tasks`、`social_work_execution_steps` 和 `social_work_runtime_checkpoints` 作为 SocialWork task、工具副作用、项目结果关联与恢复上下文的持久事实来源。SocialWorkService MUST 编排执行状态转换，SocialChatService MUST 编排项目结果投递；两者对 task 持久状态的修改 MUST 调用 SocialChatStore API。Executor MUST 通过执行事件报告结果，不直接写 durable task state。`phase`、runtime session、step outcome 与 checkpoint 不得替代 task `status`。

#### Scenario: 应用重新打开时恢复活动 task
- **WHEN** SocialChatStore 初始化时发现状态为 starting、running 或 verifying 的 SocialWork task
- **THEN** task 被持久标记为 interrupted 且原因是 app_restarted；系统不自动重新启动它

#### Scenario: 进程中断时工具副作用尚未确认
- **WHEN** 应用恢复时发现 execution step 仍处于 running
- **THEN** 有副作用的步骤变为 outcome_unknown/effect unknown；无副作用步骤变为 interrupted；task 和 checkpoint 保留可见的中断事实

#### Scenario: store 恢复期间存在已结束 task
- **WHEN** SocialChatStore 重新初始化时 task 已为 completed、failed 或 interrupted
- **THEN** 恢复逻辑保留其终态、错误和结果，不重新标为 app_restarted

### Requirement: task 只能从完整且安全的 Noema checkpoint 显式恢复
系统 MUST 仅在 task 属于 Noema executor、task 状态与错误类别受支持、checkpoint 位于可恢复的 ready_for_model 边界、没有 running/outcome_unknown step 或 pending/unknown effect，并且原工作区仍指向同一 real path 时允许恢复。恢复 MUST 由用户或已授权的项目工作流程显式触发；DSH task 与不满足条件的 task MUST NOT 自动或经 Noema checkpoint API 续接。

#### Scenario: 从安全模型边界恢复
- **WHEN** 已支持的 Noema task 有完整的 ready_for_model checkpoint，所有工具步骤结果已确定，且原工作区身份未变化
- **THEN** SocialChatStore 以事务将 task 重新置为 starting，Service 创建新 run 并保留先前完成的 step，不重复其副作用

#### Scenario: 存在结果未知的副作用
- **WHEN** task 中存在 running/outcome_unknown step 或 pending/unknown effect
- **THEN** `canResume` 为 false，恢复请求被拒绝，且已有 task/step/checkpoint 记录不被清除

#### Scenario: 旧 DSH task 没有 Noema checkpoint
- **WHEN** DSH execution engine 的 task 被请求从 Noema checkpoint 恢复
- **THEN** 请求被拒绝，不把 DSH session ID 当作 Noema 工具 ledger 或恢复上下文
