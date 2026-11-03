## MODIFIED Requirements

### Requirement: 核心执行事件使用版本化且可关联的本机契约
系统 SHALL 以有版本号的本机事件记录关联应用进程、用户 turn、SocialWork task、provider request、tool call/result 和恢复事实。事件 MUST 用独立字段表达 application execution、operation execution、task、turn、request 与 tool-call identity；默认工作区路径 MUST 从 task execution identity 连到模型请求、工具步骤和恢复事件。查询 MUST 可按 execution/task identity 获得有序的有界事件页。

#### Scenario: one task spans provider and tool events
- **WHEN** 一个 SocialWork task 调用模型、执行工具并完成/失败
- **THEN** 事件以同一 task execution ID 关联，provider request 与 tool call 各保留自己的 ID，且不混淆 task 状态记录

#### Scenario: process restart recovers an interrupted task
- **WHEN** 新 main process 启动并将旧活动 task 恢复为 interrupted
- **THEN** 恢复事件使用新的 application execution ID、保留原 task ID，并区分应用退出未完成、系统关机未完成或无退出意图的进程异常退出

## ADDED Requirements

### Requirement: 主进程拥有可恢复的项目任务生命周期
SocialWork task 的持久状态 MUST 由 SocialChatStore 管理，不依赖 renderer/window 存活。正常退出或 Windows 系统会话结束必须留下受限的持久意图；下次启动据此区分未完成的应用退出、系统关机和未记录意图的进程异常退出。恢复 MUST 将活动步骤中可能产生副作用的结果标为未知，不得自动重放。只有通过现有安全 checkpoint 与未决副作用检查的 Noema task 才能显式续接。

#### Scenario: renderer detaches and reconnects
- **WHEN** renderer detach 后重新连接主进程服务并重新读取 room snapshot
- **THEN** 已运行 task 仍由主进程持有，订阅恢复后可重新查询 task 状态而不创建第二个执行 owner

#### Scenario: application exits while task is active
- **WHEN** 用户显式退出 Noema 且活动 task 在 shutdown deadline 内停止
- **THEN** task 以 `application_exit` 结束，停止前的文件变更保留，不自动回滚

#### Scenario: system shutdown exceeds the host deadline
- **WHEN** 系统关机时 task 未能在宿主期限内停止并写入终态
- **THEN** 下次启动以 `system_shutdown_incomplete` 恢复任务，活动副作用标为未知且不自动执行

#### Scenario: process is lost without a shutdown intent
- **WHEN** 新进程发现仍处于活动态的旧 task 且不存在关机意图
- **THEN** task 标记为 `process_crash` 并进入既有安全续接检查
