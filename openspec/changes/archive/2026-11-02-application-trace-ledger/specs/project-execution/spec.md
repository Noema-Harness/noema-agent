# Spec Delta

## ADDED Requirements

### Requirement: 核心执行事件使用版本化且可关联的本机契约
系统 SHALL 以有版本号的本机事件记录关联应用进程、用户 turn、SocialWork task、provider request、tool call/result 和恢复事实。事件 MUST 用独立字段表达 application execution、operation execution、task、turn、request 与 tool-call identity；默认工作区路径 MUST 从 task execution identity 连到模型请求、工具步骤和恢复事件。查询 MUST 可按 execution/task identity 获得有序的有界事件页。

#### Scenario: one task spans provider and tool events
- **WHEN** 一个 SocialWork task 调用模型、执行工具并完成/失败
- **THEN** 事件以同一 task execution ID 关联，provider request 与 tool call 各保留自己的 ID，且不混淆 task 状态记录

#### Scenario: process restart recovers an interrupted task
- **WHEN** 新 main process 启动并将旧活动 task 恢复为 interrupted
- **THEN** 恢复事件使用新的 application execution ID、保留原 task ID，并记录 app_restarted 的原因码

### Requirement: 诊断事件受字段白名单、容量和故障隔离约束
诊断事件 MUST NOT 持久化 prompt、消息正文、workspace path、命令文本、tool arguments/results、credentials 或完整错误正文。事件写入与业务 side-effect MUST 不共享原子成功条件；诊断写入失败 MUST 不阻断 Agent 行为，并增加可查询的本地诊断失败计数。事件保留量 MUST 有严格配置上限。

#### Scenario: event details contain user text or credentials
- **WHEN** 事件输入带有未允许字段或疑似 credential
- **THEN** 未允许字段不写入；字符串按限长与凭据 redaction 处理

#### Scenario: diagnostics database write fails
- **WHEN** 诊断存储不可写或已关闭
- **THEN** 调用方继续执行其原有业务操作，诊断 owner 增加 failure count 并暴露不可用状态

#### Scenario: retention limit is reached
- **WHEN** 新事件会使事件数量超过配置上限
- **THEN** 最旧的事件被清理，事件总量不超过上限，剩余事件仍可按 execution/task 查询
