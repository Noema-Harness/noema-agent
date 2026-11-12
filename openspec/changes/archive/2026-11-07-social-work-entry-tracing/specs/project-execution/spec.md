## MODIFIED Requirements

### Requirement: 不可用的工作区任务入口说明阻塞原因
当项目工作执行器、模型服务或所选模型尚未就绪时，系统 MUST 禁用工作区任务模式并向用户说明当前不可用原因，且 MUST NOT 将该委托改送到旧 DSH 路径或未隔离的宿主命令执行。主进程提供的 readiness 状态 MUST 同时包含稳定的 reason code 和用户可读说明；可用状态的 reason code 与说明 MUST 为 null。

#### Scenario: 项目工作执行器未就绪
- **WHEN** Noema 主聊中的项目工作执行器、模型服务连接或所选模型为不可用/检查中
- **THEN** 工作区任务入口不可启用、呈现主进程提供的原因说明，并保留可供诊断关联的稳定 reason code；普通聊天不因此改变

#### Scenario: 工作区任务模式显式开启
- **WHEN** 用户在 Noema 主聊启用工作区任务模式并发送一条消息
- **THEN** 该 turn 才能调用 `start_project_work`，并在启动任务前由用户选择工作区；模式状态由主进程校验，不只依赖发给模型的提示文字

#### Scenario: 工作区任务模式关闭
- **WHEN** 用户在 Noema 主聊关闭工作区任务模式并发送与开启状态相同的文字
- **THEN** 该 turn 按普通聊天处理，模型请求不包含 `start_project_work`，也不会创建 SocialWork task

#### Scenario: 排队中的工作区任务消息
- **WHEN** 用户在工作区任务模式开启时提交消息，但当前回复尚未结束而进入发送队列
- **THEN** 该队列项保留提交时的模式状态，后来切换模式不会改写该条已提交消息的准入选择

### Requirement: 默认工作区入口可用于本机诊断追踪
系统 SHALL 为应用入口建立 execution ID，并在本机诊断记录中关联默认路由选择、工作区执行器可用性和成功创建的 SocialWork task ID。工作区选择被用户取消时，系统 MUST 在相同 application execution ID 下记录脱敏的取消终态，但不得创建或伪造 task ID。诊断事件 MUST NOT 包含用户指令、工作区路径、文件正文或凭据。

#### Scenario: 记录默认入口状态
- **WHEN** 主窗口载入默认 Noema 主聊并首次读取 social state
- **THEN** 本机诊断记录包含同一 application execution ID 下的入口路由和项目工作执行器可用状态，readiness unavailable 时包含有限 reason code

#### Scenario: 记录通过入口创建的工作区任务
- **WHEN** Noema 主聊经现有项目工作链成功创建 SocialWork task
- **THEN** 诊断记录 task ID 并关联当前 application execution ID，且不写入任务指令或工作区路径

#### Scenario: 记录用户取消工作区选择
- **WHEN** Noema 主聊的工作区任务请求打开工作区选择器后，用户取消选择
- **THEN** 同一 application execution ID 的诊断查询可见 user_cancelled 终态，且没有对应 SocialWork task ID 或 task 记录
