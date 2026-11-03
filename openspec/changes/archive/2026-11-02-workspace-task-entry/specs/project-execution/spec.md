# Spec Delta

## ADDED Requirements

### Requirement: 用户可从 Noema 主聊明确提交工作区任务
系统 SHALL 在 Noema 主聊提供显式工作区任务模式。用户启用该模式并提交内容时，系统 MUST 保留其任务指令并把本地文件工作意图交给现有项目工作执行链；用户确认工作区前不得创建或声称已启动任务。普通聊天仍是默认模式，且用户可以在发送前退出任务模式。

#### Scenario: 提交工作区任务请求
- **WHEN** 用户在 Noema 主聊启用工作区任务模式、填写指令并发送
- **THEN** 系统将该指令作为明确的本地文件工作委托交给现有项目工作工具链，并在工作区选择确认前不创建任务

#### Scenario: 在发送前退出工作区任务模式
- **WHEN** 用户启用工作区任务模式后、发送前将其关闭
- **THEN** 后续提交按普通聊天处理，不携带本地文件工作委托意图

### Requirement: 不可用的工作区任务入口说明阻塞原因
当项目工作执行器尚未就绪时，系统 MUST 禁用工作区任务模式并向用户说明当前不可用原因，且 MUST NOT 将该委托改送到旧 DSH 路径或未隔离的宿主命令执行。

#### Scenario: 项目工作执行器未就绪
- **WHEN** Noema 主聊中的项目工作 readiness 为不可用
- **THEN** 工作区任务入口不可启用并呈现 readiness 原因，普通聊天不因此改变

### Requirement: 默认工作区入口可用于本机诊断追踪
系统 SHALL 为应用入口建立 execution ID，并在本机诊断记录中关联默认路由选择、工作区执行器可用性和成功创建的 SocialWork task ID。诊断事件 MUST NOT 包含用户指令、工作区路径、文件正文或凭据。

#### Scenario: 记录默认入口状态
- **WHEN** 主窗口载入默认 Noema 主聊并首次读取 social state
- **THEN** 本机诊断记录包含同一 application execution ID 下的入口路由和项目工作执行器可用状态

#### Scenario: 记录通过入口创建的工作区任务
- **WHEN** Noema 主聊经现有项目工作链成功创建 SocialWork task
- **THEN** 本机诊断记录 task ID 并关联当前 application execution ID，且不写入任务指令或工作区路径
