# Spec Delta

## ADDED Requirements

### Requirement: 用户可在 Noema 内查询本机执行时间线
系统 MUST 提供可信主框架可调用的只读诊断查询，按最近 execution、execution ID 或 task ID 查看有序事件、关联模型用量与 task/tool 状态；查询不得修改业务状态。

#### Scenario: 查看最近执行
- **WHEN** 用户打开本机诊断视图
- **THEN** 系统显示有界的最近执行列表、时间、类型和状态，并允许用户打开一条时间线

#### Scenario: 查看 task 时间线
- **WHEN** 用户选择一个 SocialWork task
- **THEN** 系统按 task execution ID 显示关联的请求用量、工具状态和恢复事件，不展示 prompt、消息正文、结果正文或工作区路径

#### Scenario: 查询结果不完整
- **WHEN** 请求关联或数据 owner 不支持某个时间段/事件类型
- **THEN** 系统明确显示覆盖缺口，不把缺失数据呈现为零用量或成功状态

### Requirement: 本机诊断导出默认仅包含安全元数据
用户 MUST 主动触发诊断导出，并在保存前看到版本、采集范围、排除项和覆盖缺口；报告 MUST 使用版本化结构且 MUST NOT 包含对话正文、prompt、task 结果正文、workspace path、命令文本、凭据或完整错误正文。

#### Scenario: 预览并保存报告
- **WHEN** 用户查看导出预览并明确选择保存位置
- **THEN** 系统仅将预览中列出的事件和用量元数据写入本地报告，不自动上传

#### Scenario: 用户取消导出
- **WHEN** 用户在预览或保存对话框中取消
- **THEN** 系统不创建报告文件

#### Scenario: 报告包含受限字段
- **WHEN** 输入事件的 details 带有未允许字段或自由文本错误
- **THEN** 导出沿用本地事件 allowlist/redaction，仅输出有限状态/错误码和安全数值

### Requirement: 本机诊断检索与导出失败不影响 Agent 工作
诊断查询、渲染和导出 MUST 与 Agent 执行和 task 状态写入隔离；诊断失败 MUST 显示可理解的本地错误并保留已有业务事实。

#### Scenario: 诊断存储不可用
- **WHEN** 本机数据库或诊断事件 owner 无法读取
- **THEN** Agent 主聊和 task 生命周期继续可用，诊断视图说明数据暂不可查

#### Scenario: 导出文件写入失败
- **WHEN** 用户选择的位置不可写或文件保存失败
- **THEN** 系统显示保存失败，在线事件与用量记录保持不变
