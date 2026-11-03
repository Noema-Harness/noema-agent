# Spec Delta

## MODIFIED Requirements

### Requirement: 用户可在 Noema 内查询本机执行时间线
系统 MUST 提供可信主框架可调用的只读诊断查询，按最近 execution、execution ID 或 task ID 查看有序事件、关联模型用量与 task/tool 状态；查询不得修改业务状态。每条可用 provider 请求还 MUST 展示已记录的请求 JSON 字符数、tool definition 字符数、message 数与 tool 数；这些值只能作为请求形状指标，MUST NOT 标成 token 数或推导为 cache hit。查询结果 MUST NOT 展示 prompt、消息正文、结果正文或工作区路径。

#### Scenario: 查看最近执行
- **WHEN** 用户打开本机诊断视图
- **THEN** 系统显示有界的最近执行列表、时间、类型和状态，并允许用户打开一条时间线

#### Scenario: 查看 task 时间线
- **WHEN** 用户选择一个 SocialWork task
- **THEN** 系统按 task execution ID 显示关联的请求用量、请求形状字符数与计数、工具状态和恢复事件，不展示 prompt、消息正文、结果正文或工作区路径

#### Scenario: 请求形状度量不可用
- **WHEN** 某条旧用量记录或非 provider 用量记录没有请求形状字段
- **THEN** 系统以不可用状态呈现这些字段，不显示为 0，且不影响其他用量和事件查询

#### Scenario: 查询结果不完整
- **WHEN** 请求关联或数据 owner 不支持某个时间段/事件类型
- **THEN** 系统明确显示覆盖缺口，不把缺失数据呈现为零用量或成功状态
