# Spec Delta

## Purpose

让用户在退役 Root/Legacy 操作后仍能在本机只读查询并导出其历史记录，同时阻止历史内容重新成为活动对话、授权或任务执行输入。

## ADDED Requirements

### Requirement: 用户可只读查询 Root 与 Legacy 历史记录
系统 SHALL 在 Noema 内提供与活动 Social 会话分开的 Root/Legacy 历史查询，覆盖 root turns/messages、DSH background tasks/events、captured moments、Codex context snapshots/consents 和 interaction adjustments。查询 MUST 有界、只读、显示原始来源类型，并且 MUST NOT 调用旧操作 API 或恢复任务。

#### Scenario: 查询历史 Root turn
- **WHEN** 用户在历史记录视图选择一个 Root turn
- **THEN** 系统显示该 turn 的历史消息和来源标记，但不提供发送、重试、停止或续跑操作

#### Scenario: 查询 DSH 历史任务
- **WHEN** 用户打开一条旧 DSH task
- **THEN** 系统显示已保存的任务状态和结果事件，不启动或恢复 DSH session

#### Scenario: 超出查询边界
- **WHEN** 查询请求包含无效、过长或超出页大小的参数
- **THEN** 系统拒绝无效值或返回有界结果，不扩大到无界全库扫描

### Requirement: 历史记录不可作为活动 Agent 输入或授权
系统 MUST 将 Root/Legacy 历史数据与活动 Social context、provider request、task recovery 和权限判定隔离。历史 imported-context consent MUST NOT authorize future transmission, and historical Root/DSH records MUST NOT create new active lifecycle events.

#### Scenario: 历史快照被查询
- **WHEN** 用户查看或导出一条 Codex context snapshot
- **THEN** 该快照仅作为历史资料展示，不进入 Social provider request，也不授权外发

#### Scenario: 应用启动时存在旧 DSH 活动记录
- **WHEN** Noema 启动并发现旧数据库中未终结的 DSH task/session
- **THEN** 系统不启动 DSH、不重试任务、不生成新的 Root/DSH 活动事件，并保留原记录供只读查询

### Requirement: 历史数据导出必须由用户明确触发
系统 MUST 允许用户选择历史记录类别并预览本机导出内容；保存 MUST 由用户明确确认， MUST NOT 自动上传或发送给模型。导出 MUST 保留记录来源和原始关联 ID，并报告被省略或不可读取的数据。

#### Scenario: 用户保存选定历史记录
- **WHEN** 用户选择记录类别、检查导出预览并确认本地保存
- **THEN** 系统仅写入用户选择的本地目标文件，保持记录与来源关联，且不触发网络请求

#### Scenario: 用户取消导出
- **WHEN** 用户取消文件选择或关闭预览
- **THEN** 系统不写文件、不删除或修改源数据库记录

#### Scenario: 部分历史记录不可读取
- **WHEN** 存储记录损坏、字段无法安全投影或结果超过有界上限
- **THEN** 系统保留源数据不变，并在查询或导出结果中显示缺失/省略状态，不将其报告为完整导出
