# Spec Delta

## MODIFIED Requirements

### Requirement: 本机诊断导出默认仅包含安全元数据
用户 MUST 主动触发诊断导出，并在保存前看到版本、采集范围、排除项和覆盖缺口；默认报告 MUST NOT 包含对话正文、prompt、task 结果正文、workspace path、命令文本、凭据或完整错误正文。用户可在单次导出中明确选择包含所选执行的有限实测上下文；路径或命令若存在于所选正文中须作为敏感资料预览，凭据形状文本 MUST 尝试脱敏，报告 MUST 在本机完整预览后由用户选址保存，且 MUST NOT 自动上传。

#### Scenario: 预览并保存报告
- **WHEN** 用户未选择实测上下文并查看导出预览后明确选择保存位置
- **THEN** 系统仅将预览中列出的事件和用量元数据写入本地报告，不自动上传

#### Scenario: 用户取消导出
- **WHEN** 用户在预览或保存对话框中取消
- **THEN** 系统不创建报告文件

#### Scenario: 报告包含受限字段
- **WHEN** 输入事件的 details 带有未允许字段或自由文本错误
- **THEN** 导出沿用本地事件 allowlist/redaction，仅输出有限状态/错误码和安全数值

#### Scenario: 用户选择实测上下文
- **WHEN** 用户为一条执行勾选实测上下文并生成导出预览
- **THEN** 报告只包含该执行关联的可见对话轮次与任务输入、结果及有限错误文本，界面完整展示报告与个人信息、路径或命令文本风险提示，凭据形状文本经过脱敏处理

#### Scenario: 用户保存或取消上下文报告
- **WHEN** 用户确认本地保存或取消导出
- **THEN** 确认时只写入所选本地文件；取消时不创建文件；两者都不发送到模型服务或远端

#### Scenario: 上下文有内容上限
- **WHEN** 所选执行上下文超过报告的字段或总量上限
- **THEN** 系统截断到硬上限并在报告中标记被截断，不读取或导出工作区文件

### Requirement: 核心执行事件使用版本化且可关联的本机契约
系统 SHALL 以有版本号的本机事件记录关联应用进程、用户 turn、SocialWork task、provider request、tool call/result 和恢复事实。事件 MUST 用独立字段表达 application execution、operation execution、task、turn、request 与 tool-call identity；默认工作区路径 MUST 从 task execution identity 连到模型请求、工具步骤和恢复事件。查询 MUST 可按 execution/task identity 获得有序的有界事件页。RootAgent turn 和 DSH 后台任务 MUST 记录开始、结束及失败/中断等终态，并关联相应 turn/task ID；事件 MUST NOT 包含消息正文、task prompt/result、PID、命令或路径。

#### Scenario: one task spans provider and tool events
- **WHEN** 一个 SocialWork task 调用模型、执行工具并完成/失败
- **THEN** 事件以同一 task execution ID 关联，provider request 与 tool call 各保留自己的 ID，且不混淆 task 状态记录

#### Scenario: process restart recovers an interrupted task
- **WHEN** 新 main process 启动并将旧活动 task 恢复为 interrupted
- **THEN** 恢复事件使用新的 application execution ID、保留原 task ID，并区分应用退出未完成、系统关机未完成或无退出意图的进程异常退出

#### Scenario: root turn starts and reaches a terminal state
- **WHEN** RootAgent 开始、完成、失败或中断用户轮次
- **THEN** 本机诊断记录轮次 ID、阶段与有限错误类别，不记录轮次正文

#### Scenario: DSH task and child process lifecycle
- **WHEN** DSH 后台任务启动、启动失败、子进程退出、停止或超时
- **THEN** 本机诊断以任务 ID 记录阶段、耗时、退出类别和清理状态，不记录 PID、命令、输出正文或路径
