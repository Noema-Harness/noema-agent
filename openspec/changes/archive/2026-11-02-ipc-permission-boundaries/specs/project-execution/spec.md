# Spec Delta

## ADDED Requirements

### Requirement: 工作区执行相关 IPC 只接受可信主框架
系统 MUST 仅接受当前 Noema 主窗口的主框架发出的工作区选择、任务创建和 task control IPC。来自子框架、其他窗口、未知或缺少 frame 身份的请求 MUST 被拒绝，且不得触发目录选择、授权提示、文件操作或 task 状态变化。

#### Scenario: trusted main frame invokes a workspace action
- **WHEN** 当前主窗口的主框架请求选择工作区或控制已有 SocialWork task
- **THEN** 系统按对应的主进程授权与 task 状态门禁执行请求

#### Scenario: child frame invokes an exposed channel
- **WHEN** trusted `webContents` 中的 iframe 或嵌套 frame 请求任何 root IPC 或 window control
- **THEN** 系统拒绝请求且不调用对应 handler

#### Scenario: frame identity is missing
- **WHEN** IPC event 没有 `senderFrame` 或其 frame 不等于 sender 的 main frame
- **THEN** 系统拒绝请求且不赋予目录或任务权限

### Requirement: 敏感数据遵守主进程授权与本地导出边界
系统 MUST 将 provider credentials 保存在主进程并加密；配置/状态响应 MUST NOT 返回 credential 内容。诊断导出 MUST 是本机用户明确触发的本地操作；其内容范围须按可能包含聊天、任务 prompt/result、错误和 workspace path 的敏感资料处理，并在终端与导出文件中说明，不得当作匿名 telemetry。

#### Scenario: configure provider credentials
- **WHEN** 用户从可信主框架提交 provider credential
- **THEN** main 使用安全凭据存储保存它，后续状态和模型响应不包含 credential 内容

#### Scenario: operator creates diagnostics export
- **WHEN** 用户明确运行本地 diagnostics CLI
- **THEN** 导出保留本地文件，不自动上传，并告知调用者该文件可能包含个人对话、任务内容、错误及路径

### Requirement: 人类授权事件可本机追踪且不记录授权内容
系统 MUST 为工作区访问与导入对话外发 consent 记录 requested、granted、denied、revoked 中实际发生的决策；事件 SHALL 关联当前 application execution ID，且 MUST NOT 记录工作区路径、对话正文或凭据。

#### Scenario: 用户选择或拒绝工作区授权
- **WHEN** 主进程显示工作区目录选择或 disclosure，随后用户选择、取消或因窗口不可用而拒绝
- **THEN** 本机诊断记录能力、决策与有限原因，不记录选择的路径或任务 prompt

#### Scenario: 用户同意或撤回导入对话外发
- **WHEN** 用户在导入对话首次外发提示中同意/拒绝，或之后移除该导入
- **THEN** 本机诊断记录 requested/granted/denied/revoked，不记录快照内容或 API key
