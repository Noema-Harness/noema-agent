# Design

## Context

Noema 当前 project-work 路径分为三个责任：`SocialChatStore` 持久化 task/step/checkpoint 及项目结果关联状态；`SocialWorkService` 校验启动与恢复条件、拥有进程内 run handle 并通过 store API 写入状态；`SocialChatService` 读取项目回报队列并编排群聊投递，不直接修改 task 表；`NoemaProjectExecutor` 运行工具 loop，通过 `onEvent` 报告 session、phase、tool、checkpoint 和结果，不直接访问数据库。RootStore 的 `background_tasks` 与 DSH Session 属于另一条 legacy 路径。

当前代码已有恢复门禁。本 change 收拢由 `SocialChatService` 执行的项目结果 task 表写入到 `SocialChatStore` API，并将恢复与所有权约束写入 `project-execution`；不改 schema。

## Goals / Non-Goals

**Goals:**

- 状态权威来源、task/step/checkpoint 三类状态的职责清楚。
- 进程重新打开 store 时，不把 active task 当作可以安全重跑的任务。
- 未确认副作用保留为未知结果；恢复判断必须同时看执行引擎、task/error、checkpoint 与未完成 step。
- 已进入终态的任务在 store 初始化恢复期间保持原状态、错误和结果。

**Non-Goals:**

- 不实现跨进程活动任务接管、lease 或自动恢复。
- 不把 DSH task、RootStore task 与 SocialWork task 合并。
- 不增加通用 trace/event schema；A1 已有入口事件，跨模块事件关联仍按 B1 实施。
- 不改工具结果/checkpoint 的保留策略、字段脱敏或用户数据生命周期。

## Decisions

1. **持久 owner 是 SocialChatStore。** SQLite `social_work_tasks.status` 是 task 生命周期状态；`phase` 是更细的当前运行阶段投影。`social_work_execution_steps` 记录每个工具步骤及其副作用状态；`social_work_runtime_checkpoints` 保存 Noema 模型边界上下文；`project_plan_item_id` 与 `project_result_pending` 记录项目结果关联及投递队列状态。它们相关联但不能相互替代。
2. **Service 编排，不成为第二份持久状态。** `SocialWorkService` 负责检查 readiness、workspace identity、恢复资格和活动 run；`SocialChatService` 负责编排项目结果回报。两者都只能通过 SocialChatStore 的方法写 task durable state。Executor 以事件报告实际执行结果，不自行修改 task 表。
3. **重新打开 store 只恢复事实，不恢复执行。** 启动时将 `starting/running/verifying` task 置为 `interrupted/app_restarted`；当时仍为 `running` 的 execution step 若有副作用，置为 `outcome_unknown/unknown`；checkpoint 标记 interrupted。不得自动重放这些 task。
4. **显式恢复有窄门。** 只接受 execution engine 为 `noema`、状态/错误属于已支持的 app-restart 或 provider/tool-round/oversized-response 恢复类别、checkpoint 位于 `ready_for_model` 边界、没有 `running/outcome_unknown` step 或 `pending/unknown` effect，并确认原工作区仍为同一 real path 的任务。恢复后先以事务将 task 变成 `starting`，再由 Service 创建新 run。DSH engine、手动停止和其他失败仍需检查并重新提交。
5. **不扩大诊断承诺。** 本 change 固定 durable state 与恢复判定，不声称实现了统一 execution trace。B1 将单独补齐 transition event 与跨模块 ID。

## State Ownership Map

| 状态 | 持久来源 | 写入责任 | 作用 |
|---|---|---|---|
| task `status` | `social_work_tasks` | SocialChatStore API，由 Service 调用 | starting/running/verifying/completed/failed/interrupted |
| task `phase`、session、计数、verification | `social_work_tasks` | SocialChatStore API，由 Service 调用 | 运行阶段和累计进展；不单独授权恢复 |
| 工具 step/status/effect | `social_work_execution_steps` | SocialChatStore API，由 Service 消费 Executor 事件 | 区分安全完成与结果未知的副作用 |
| prompt/context checkpoint | `social_work_runtime_checkpoints` | SocialChatStore API，由 Service 消费 Executor 事件 | 仅模型边界 checkpoint 可作为续接输入 |
| 项目结果关联与待投递状态 | `social_work_tasks.project_plan_item_id`、`project_result_pending` | SocialChatStore API，由 SocialChatService 编排调用 | 持续投递项目执行结果，不改变 task 完成或验收语义 |
| 当前 run handle/stop 标记 | `SocialWorkService.runs` | SocialWorkService | 进程内活动执行控制；不持久、不等价于 task 状态 |

## Migration and Recovery Boundaries

- Schema 按 `social_schema_migrations` 逐版本事务升级；task 表从 v2 引入，execution step 从 v13 引入，`execution_engine` 从 v14 区分 DSH/Noema，runtime checkpoint 从 v16 引入。
- 旧 task 未因为缺少 Noema checkpoint 而获得恢复资格；迁移默认的 `execution_engine='dsh'` 与 `canResume` 的 Noema-only 条件共同阻止把 legacy session 冒充为 Noema checkpoint。
- 正常关窗后的任务继续运行属于后续 Host lifecycle 工作；本 change 描述进程真正重启或异常退出后的数据库恢复，不把 interrupted 标记当成后台运行实现。
- `completed_at` 在现有实现代表任务进入终态的时间字段；成功判断仍由 `status === 'completed'` 与适用的 verification 状态共同决定。

## Risks / Trade-offs

- 当前 task/step/checkpoint 写入共用一个 SQLite connection，但多个 store API 的调用不是全部同一个事务；工具结果与 checkpoint 的关键配对路径使用 `finishSocialWorkExecutionStepWithCheckpoint` 原子提交，其他状态转换需依具体调用路径核对。
- 步骤结果和 checkpoint 可能含用户工作区内容；本 change 不改变既有持久化政策。诊断导出/隐私控制由对应阶段处理。
- “store reopen”测试以同一 SQLite connection 上重新构造 SocialChatStore 模拟启动恢复，能验证恢复逻辑与终态筛选，不能代替进程崩溃、磁盘故障或 Windows 打包验收。

## Open Questions

无新的产品取舍。若源码核对发现上述状态条件与代码不一致，优先修复实现和测试，使其符合当前已确认的安全恢复要求。
