# Spec Delta

## MODIFIED Requirements

### Requirement: 人类授权事件可本机追踪且不记录授权内容
系统 MUST 为仍受支持的工作区与业务操作记录 requested、granted、denied、revoked 中实际发生的授权决策；事件 SHALL 关联当前 application execution ID，且 MUST NOT 记录工作区路径、对话正文或凭据。已退役的 Root/Legacy 操作与历史 imported-context consent 不产生新的授权决策，也不授权未来发送。

#### Scenario: 用户选择或拒绝工作区授权
- **WHEN** 主进程显示 SocialWork 工作区目录选择或 disclosure，随后用户选择、取消或因窗口不可用而拒绝
- **THEN** 本机诊断记录能力、决策与有限原因，不记录选择的路径或任务 prompt

#### Scenario: 用户同意或撤回导入对话外发
- **WHEN** 历史 imported-context consent 记录存在，或旧 renderer 对应 handler 被调用
- **THEN** 旧 handler fail closed；该记录不授权 provider request，历史 snapshot 不进入 request，且不生成新的授权事件

### Requirement: 核心执行事件使用版本化且可关联的本机契约
系统 SHALL 以有版本号的本机事件记录关联应用进程、SocialWork task、provider request、tool call/result 和恢复事实。事件 MUST 用独立字段表达 application execution、operation execution、task、request 与 tool-call identity；默认工作区路径 MUST 从 task execution identity 连到模型请求、工具步骤和恢复事件。查询 MUST 可按 execution/task identity 获得有序的有界事件页。已退役的 Root turn 与 DSH task 不产生新的活动事件，也不通过启动恢复重新执行；历史事件仅供只读查询。

#### Scenario: one task spans provider and tool events
- **WHEN** 一个 SocialWork task 调用模型、执行工具并完成/失败
- **THEN** 事件以同一 task execution ID 关联，provider request 与 tool call 各保留自己的 ID，且不混淆 task 状态记录

#### Scenario: process restart recovers an interrupted task
- **WHEN** 新 main process 启动并将旧活动 SocialWork task 恢复为 interrupted
- **THEN** 恢复事件使用新的 application execution ID、保留原 task ID，并区分应用退出未完成、系统关机未完成或无退出意图的进程异常退出

#### Scenario: root turn starts and reaches a terminal state
- **WHEN** 启动恢复检查发现旧 Root turn 或旧活动 Root 操作被请求
- **THEN** 系统不启动或续接该 turn，不生成 Root 活动事件，并保留已有记录供只读历史查询

#### Scenario: DSH task and child process lifecycle
- **WHEN** 启动恢复检查发现旧 DSH task/session，或旧 DSH 操作 handler 被调用
- **THEN** 系统不启动、停止、续接或重试该任务，不生成新的 DSH 活动事件，并保留已有记录供只读历史查询
