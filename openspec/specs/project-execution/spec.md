# project-execution Specification

## Purpose
定义项目执行 agent 的工具预算、部分结果交接与安全恢复，确保单段成本有界，并在续接时保留历史且不重复已完成的副作用。

## Requirements

### Requirement: 执行预算边界产生可续接的部分交接
系统 SHALL 为每段项目执行设置有限的工具调用预算。预算用尽时，系统 MUST 阻止未执行的超额工具操作，保留已完成操作及模型上下文，并向 Noema 返回明确标注“本段未完成”的进度交接；不得将其描述为工作已完成。

#### Scenario: 达到预算上限
- **WHEN** 执行成员已用完本段工具预算并准备调用更多工具
- **THEN** 系统不执行超额工具，要求成员只用文本说明已完成内容、未完成内容和建议的续接点，并把任务标记为可续接的预算暂停

#### Scenario: 模型请求的批次超出剩余预算
- **WHEN** 一个工具调用批次超过本段剩余预算
- **THEN** 系统不执行该批次中的任何工具，将“本批未执行”反馈给模型后生成预算交接

### Requirement: 预算暂停可从安全检查点续接
系统 SHALL 允许 Noema 或用户从预算暂停或可恢复的 provider 失败检查点继续任务；续接开始新的模型片段，保留任务累计工具数和历史结果，不重放此前已成功的工具。只有执行记录完整且不存在运行中或结果未知的副作用时，任务才可续接。

#### Scenario: 续接已暂停任务
- **WHEN** 用户或 Noema 选择从有效检查点继续
- **THEN** 系统以已保存的上下文开始新片段，保留累计操作记录，且此前成功的写入不重复执行

#### Scenario: 超大模型响应后续接
- **WHEN** 模型响应超过安全读取上限，且本次响应中的工具调用尚未执行
- **THEN** 系统将任务标记为可显式续接，保留上一安全模型边界；恢复时提示模型缩短输出并基于已保存上下文继续，不自动重试或重放此前成功工具

#### Scenario: 检查点存在不确定副作用
- **WHEN** 检查点含尚未确认结果的命令或写入
- **THEN** 系统不得续接，并要求检查工作区与操作记录

### Requirement: 主聊默认不发起本地文件工作
Noema 主聊 SHALL 只承载普通对话，不提供工作区入口，也不在消息上携带本地文件工作意图。系统 MUST NOT 在未创建项目时为主聊消息启用 `start_project_work`；本地文件工作只能从已绑定工作文件夹的项目会话发起。

#### Scenario: 主聊发送普通消息
- **WHEN** 用户在 Noema 主聊发送一条消息
- **THEN** 该 turn 的模型请求不包含 `start_project_work`，系统不创建 SocialWork task，也不插入工作区指令前缀

#### Scenario: 主聊请求文件工作
- **WHEN** 用户在 Noema 主聊要求修改本机文件但没有项目
- **THEN** 系统按普通对话回应，并提示需要先创建项目、选择工作文件夹后由项目成员执行

### Requirement: 项目创建时绑定工作文件夹
创建项目 SHALL 要求用户选择工作文件夹，并在同一创建事务中保存路径与身份。未选择或取消选择时 MUST NOT 创建项目。Noema 或用户创建的项目 MUST 使用同一项目绑定，不得为该项目的任一会话静默改用其他目录。

#### Scenario: 用户选择文件夹创建项目
- **WHEN** 用户填写项目信息、选择工作文件夹并提交
- **THEN** 项目与工作文件夹绑定一起保存，成员项目会话在启动任务前即可使用该绑定

#### Scenario: 用户取消选择文件夹
- **WHEN** 用户打开文件夹选择器后取消，且未选择工作文件夹
- **THEN** 系统不创建项目，也不创建成员会话或 SocialWork task

#### Scenario: 项目内的文件任务
- **WHEN** 项目成员在项目会话中启动文件任务
- **THEN** 系统使用项目创建时保存的工作文件夹和身份，不弹出新的目录选择，也不回退到主聊或其他目录

### Requirement: 执行联系人创建时获得默认工作目录
创建执行联系人时，系统 SHALL 在用户文档目录下建立只属于该联系人的默认工作目录；该目录用于联系人直接承接文件任务时的默认范围。项目任务 MUST 以项目创建时选择的工作文件夹为准，不得被联系人默认目录覆盖。默认目录创建失败 MUST NOT 阻断联系人创建。

#### Scenario: 新建执行联系人
- **WHEN** 用户创建一名可执行文件任务的联系人
- **THEN** 系统建立该联系人的默认工作目录，并在联系人资料中保留稳定身份

#### Scenario: 联系人直接执行文件任务
- **WHEN** 执行联系人承接不隶属项目的文件任务
- **THEN** 系统使用其默认工作目录，不再要求用户为该任务选择目录

#### Scenario: 联系人参与项目
- **WHEN** 执行联系人在已绑定工作文件夹的项目会话中工作
- **THEN** 系统使用项目工作文件夹，默认目录不参与该项目的读写

### Requirement: 工作文件夹选择可用于本机诊断追踪
系统 SHALL 在本机诊断记录中关联项目工作文件夹选择、取消和项目创建结果，并保留 application execution ID。诊断事件 MUST NOT 包含项目指令、绝对路径、文件正文或凭据。

#### Scenario: 记录项目工作文件夹选择
- **WHEN** 用户为项目选择工作文件夹并创建成功
- **THEN** 诊断记录可见 selection 成功与项目创建关联，但不写入绝对路径

#### Scenario: 记录用户取消工作文件夹选择
- **WHEN** 用户打开工作文件夹选择器后取消
- **THEN** 同一 application execution ID 下记录脱敏的取消终态，且没有创建项目或 task

### Requirement: SocialWork task 状态具有唯一持久 owner
系统 SHALL 以 SocialChatStore 保存的 `social_work_tasks`、`social_work_execution_steps` 和 `social_work_runtime_checkpoints` 作为 SocialWork task、工具副作用、项目结果关联与恢复上下文的持久事实来源。SocialWorkService MUST 编排执行状态转换，SocialChatService MUST 编排项目结果投递；两者对 task 持久状态的修改 MUST 调用 SocialChatStore API。Executor MUST 通过执行事件报告结果，不直接写 durable task state。`phase`、runtime session、step outcome 与 checkpoint 不得替代 task `status`。

#### Scenario: 应用重新打开时恢复活动 task
- **WHEN** SocialChatStore 初始化时发现状态为 starting、running 或 verifying 的 SocialWork task
- **THEN** task 被持久标记为 interrupted 且原因是 app_restarted；系统不自动重新启动它

#### Scenario: 进程中断时工具副作用尚未确认
- **WHEN** 应用恢复时发现 execution step 仍处于 running
- **THEN** 有副作用的步骤变为 outcome_unknown/effect unknown；无副作用步骤变为 interrupted；task 和 checkpoint 保留可见的中断事实

#### Scenario: store 恢复期间存在已结束 task
- **WHEN** SocialChatStore 重新初始化时 task 已为 completed、failed 或 interrupted
- **THEN** 恢复逻辑保留其终态、错误和结果，不重新标为 app_restarted

### Requirement: task 只能从完整且安全的 Noema checkpoint 显式恢复
系统 MUST 仅在 task 属于 Noema executor、task 状态与错误类别受支持、checkpoint 位于可恢复的 ready_for_model 边界、没有 running/outcome_unknown step 或 pending/unknown effect，并且原工作区仍指向同一 real path 时允许恢复。恢复 MUST 由用户或已授权的项目工作流程显式触发；DSH task 与不满足条件的 task MUST NOT 自动或经 Noema checkpoint API 续接。

#### Scenario: 从安全模型边界恢复
- **WHEN** 已支持的 Noema task 有完整的 ready_for_model checkpoint，所有工具步骤结果已确定，且原工作区身份未变化
- **THEN** SocialChatStore 以事务将 task 重新置为 starting，Service 创建新 run 并保留先前完成的 step，不重复其副作用

#### Scenario: 存在结果未知的副作用
- **WHEN** task 中存在 running/outcome_unknown step 或 pending/unknown effect
- **THEN** `canResume` 为 false，恢复请求被拒绝，且已有 task/step/checkpoint 记录不被清除

#### Scenario: 旧 DSH task 没有 Noema checkpoint
- **WHEN** DSH execution engine 的 task 被请求从 Noema checkpoint 恢复
- **THEN** 请求被拒绝，不把 DSH session ID 当作 Noema 工具 ledger 或恢复上下文

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

### Requirement: 执行权限按对象持久化并可在设置中调整
系统 SHALL 在设置中提供执行权限选项，并按权限对象分别生效：项目工作文件夹固定允许；工作区外文件可选择“每次确认”（默认）或“完全允许”；网络固定禁止。选择“完全允许”时，命令访问工作区外文件 MUST NOT 再弹出逐条原生确认；选择“每次确认”时，每个新路径仍需用户当次授权。权限 MUST 由主进程持久化，renderer MUST 只通过受信 IPC 读写，且不得用单个全局开关放宽网络或项目文件夹边界。

#### Scenario: 工作区外文件选择完全允许
- **WHEN** 用户把“工作区外文件”设为“完全允许”，随后项目命令读取工作区外路径
- **THEN** 主进程直接允许该次访问，不显示原生确认窗，命令继续执行

#### Scenario: 工作区外文件保持每次确认
- **WHEN** 用户未修改权限或把权限设回“每次确认”，命令首次访问新的工作区外路径
- **THEN** 系统显示当次确认，拒绝时不执行该命令，选择只影响当前命令

#### Scenario: 网络权限不可由文件权限放宽
- **WHEN** 用户把工作区外文件设为“完全允许”
- **THEN** 项目命令仍不能联网，设置中的网络状态保持“禁止”

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

### Requirement: 本机诊断检索与导出失败不影响 Agent 工作
诊断查询、渲染和导出 MUST 与 Agent 执行和 task 状态写入隔离；诊断失败 MUST 显示可理解的本地错误并保留已有业务事实。

#### Scenario: 诊断存储不可用
- **WHEN** 本机数据库或诊断事件 owner 无法读取
- **THEN** Agent 主聊和 task 生命周期继续可用，诊断视图说明数据暂不可查

#### Scenario: 导出文件写入失败
- **WHEN** 用户选择的位置不可写或文件保存失败
- **THEN** 系统显示保存失败，在线事件与用量记录保持不变

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

### Requirement: provider request diagnostics expose privacy-safe message role sizes
每条可用的 provider 请求 MUST 允许用户在本机诊断时间线查看按固定 message role 汇总的消息对象 JSON 字符数。数据 MUST 仅包含 `system`、`developer`、`user`、`assistant`、`tool` 和 `other` 分类及非负整数，不得包含角色原值、消息正文或工具参数；MUST 明确标为字符而非 token。旧记录或无 provider 请求形状的记录 MUST 显示不可用。诊断导出 MUST NOT 包含该字段。

#### Scenario: inspect request message sizes
- **WHEN** 用户在本机诊断时间线查看一条有请求形状的 provider request
- **THEN** 系统按固定角色分类展示各类消息对象 JSON 字符数，不显示消息正文或工具参数，且单位标为字符

#### Scenario: a message has an unrecognized role
- **WHEN** provider 请求中包含固定清单以外的 message role
- **THEN** 系统只将该消息的对象 JSON 字符数计入 `other`，不持久化或展示原始 role

#### Scenario: historical request has no role measurements
- **WHEN** 用户查看升级前的用量记录或没有请求形状数据的记录
- **THEN** 各角色字符数显示不可用而非零，其他用量与事件仍可查看

#### Scenario: preview a diagnostics export
- **WHEN** 用户查看或保存本机诊断导出
- **THEN** 导出不包含任何按角色的请求字符统计

### Requirement: provider request lifecycle is locally traceable
每次通过凭据门槛的 provider request MUST 在本机记录 started 事件；首次收到非空模型文本或工具调用输出时 MUST 记录一次 first-output；结束时 MUST 记录一个 completed、failed 或 interrupted 终态。事件 MUST 共用 request ID 并关联可用的 execution、task、turn 与 operation identity。usage 缺失时 MUST 显示为 unknown 并记录明确的缺失状态；事件 MUST NOT 包含 prompt/response 正文、tool arguments/results、API credentials 或自由文本错误。

#### Scenario: provider request completes with output
- **WHEN** provider request 返回文本或工具调用并结束
- **THEN** 本机时间线按相同 request ID 显示 started、一次 first-output 和 completed 事件，且可用的任务/turn 关联保持一致

#### Scenario: request fails before first output
- **WHEN** provider request 在首个输出前遇到拒绝、传输错误或无效响应
- **THEN** 时间线显示 started 与 failed，且不会伪造 first-output 或已报告 usage

#### Scenario: request is interrupted after output
- **WHEN** 用户或上游取消已开始且已返回输出的 provider request
- **THEN** 时间线保留 started、first-output、interrupted 的顺序，并将缺少的最终 usage 保持 unknown

#### Scenario: a completed request has no usage metadata
- **WHEN** provider 正常结束但没有返回可识别的 usage
- **THEN** 时间线将请求显示为 completed，同时标出 usage missing，不将 token/cache 数显示为零

#### Scenario: diagnostics sink fails
- **WHEN** 本机生命周期事件回调或诊断存储失败
- **THEN** provider 请求继续按原 transport 结果完成或失败，不因诊断错误中断或重试模型请求

### Requirement: Windows command grants are mapped to exact filesystem policy
When a Windows command backend is eligible, the system SHALL translate the trusted command mode and approved workspace/external grants into an OS-enforced filesystem policy before process creation. The policy MUST NOT grant ambient access outside the workspace and approved runtime roots. Missing or unknown modes MUST be rejected. The command workspace MUST match the immutable SocialWork task identity before ACL mutation or process creation.

#### Scenario: explicit read-only workspace command
- **WHEN** the trusted main-process caller requests read-only mode with a verified workspace, external read grants, and runtime roots
- **THEN** the workspace is present in read roots, write roots are empty, every capability ACL is read-only, and no other filesystem access is granted
- **AND** any child-process write to the workspace is rejected by Windows ACL enforcement
- **AND** startup diagnostics expose validated backend, policy, and transport versions without executable paths

#### Scenario: read-only mode rejects write grants
- **WHEN** a read-only command includes an external write grant or a write root
- **THEN** the system returns a typed denial before ACL mutation or process creation

#### Scenario: workspace and external path grants are mapped
- **WHEN** a trusted caller explicitly requests read-write mode with a workspace grant, external path grants, and trusted runtime roots
- **THEN** the backend policy grants workspace read/write, grants each external path only its approved access, grants runtime roots read-only, and grants no other filesystem access
- **AND** the policy is not inferred from an omitted mode

#### Scenario: path identity cannot be verified
- **WHEN** a granted path has an unresolved alias, reparse, or object identity that the backend cannot safely enforce
- **THEN** the system rejects the command before process creation and reports a bounded policy reason

#### Scenario: task workspace identity is missing or invalid
- **WHEN** a Windows command request lacks a valid immutable workspace identity from its SocialWork task
- **THEN** the system rejects it before backend setup, ACL mutation, or child creation with a bounded reason code

#### Scenario: task workspace is replaced before command admission
- **WHEN** the canonical path or filesystem identity captured for the command differs from the task's immutable workspace identity
- **THEN** the system rejects it before ACL mutation or child creation, reports `workspace_identity_changed`, and marks the command effect as not applied

### Requirement: Windows network grants are bound to one command identity
When a Windows command requests network access, the system SHALL enforce approved destinations through a network control bound to that command's sandbox identity. A UI approval or proxy configuration alone MUST NOT be treated as enforcement.

#### Scenario: command has approved network destinations
- **WHEN** the user approves one or more destinations for a command and the backend can enforce them for that command identity
- **THEN** only those destinations are reachable through the command's network path, and the approval does not grant access to other commands

#### Scenario: command identity or network enforcement is unavailable
- **WHEN** the backend cannot bind network policy to the command identity or cannot establish default-deny enforcement
- **THEN** the system rejects the command before process creation

### Requirement: Windows commands fail closed when backend capabilities are incomplete
The system SHALL compare every requested Windows command policy with the backend's declared and verified capabilities before process creation. Unsupported, unknown, or incompletely represented policy MUST produce a typed denial and MUST NOT fall back to host execution.

#### Scenario: requested policy is fully supported
- **WHEN** all requested filesystem, network, working-directory, and environment constraints are verified as enforceable by the selected backend
- **THEN** the system may proceed to the separate process-launch stage with the compiled policy

#### Scenario: backend capability is missing or unknown
- **WHEN** any requested constraint cannot be represented or backend readiness is unknown
- **THEN** the system returns a typed denial before process creation and does not invoke an unsandboxed runner

### Requirement: Windows command readiness has one trusted user-visible source
Windows 命令能力报告 SHALL 由主进程基于已验证的 runner 资源与本机设置状态生成，并通过受信 IPC 提供给 renderer。报告 MUST 包含支持状态、有限拒绝原因、backend 标识/版本及设置状态；renderer MUST NOT 根据文件存在、平台推断或缓存状态自行宣称命令可用。

#### Scenario: renderer displays Windows command readiness
- **WHEN** 主窗口读取或刷新命令能力报告
- **THEN** 主进程返回当前已验证的状态与拒绝原因，界面按报告呈现且不自行推断支持

#### Scenario: command readiness report cannot be read
- **WHEN** renderer 无法读取当前能力报告
- **THEN** 界面将 Windows 命令显示为不可用，并说明状态暂不可查

### Requirement: Windows isolation setup is explicitly user initiated
Windows 命令隔离首次设置 MUST 由用户在可信主窗口明确触发。应用启动和普通状态刷新 MUST NOT 自动调用需要管理员确认的设置；用户取消、拒绝 UAC 或设置后核验失败时，命令 MUST 保持不可用，直到用户再次主动设置并通过核验。

#### Scenario: user starts first-time setup
- **WHEN** 用户从 Windows 命令能力状态界面明确选择设置
- **THEN** 主进程运行设置并重新核验状态，随后更新能力报告

#### Scenario: setup is canceled or fails verification
- **WHEN** 用户取消设置、拒绝系统确认或设置核验失败
- **THEN** 能力报告保持不可用并显示有限原因，命令执行不启动

#### Scenario: application starts with setup missing
- **WHEN** 应用启动时发现隔离设置未完成
- **THEN** 应用仅执行只读状态检查，不自动请求管理员确认，命令保持不可用

### Requirement: Windows runner package identity matches the executable backend
Windows 安装包 MUST 包含恰好一个由应用实际使用的 Noema Windows runner 资源，其平台、架构、协议和版本 MUST 与主进程支持报告一致。资源缺失、重复、不可读取或身份不符时，系统 MUST 禁止新命令，且 MUST NOT 调用 SRT helper 或宿主 shell 作为替代。

#### Scenario: packaged runner matches the reported backend
- **WHEN** Windows 安装版启动并验证已打包的 runner
- **THEN** 主进程报告与执行器使用同一 runner 身份和版本

#### Scenario: packaged runner is missing or mismatched
- **WHEN** Windows 安装版发现 runner 缺失、重复、损坏或版本/协议不匹配
- **THEN** 命令能力报告为不可用，执行入口给出受限原因，且不启动其他命令后端

### Requirement: runtime capability changes close the Windows command gate
Windows runner 资源或设置的运行时探测结果变化时，主进程 MUST 更新能力报告并阻止新的命令。已启动命令 MUST 按现有 runner 取消、超时与收尾契约处理；能力变化 MUST 通过本机诊断事件关联到相应 application execution 与 task identity。

#### Scenario: readiness changes before a new command
- **WHEN** 主进程在执行前发现 runner 或设置能力已不再匹配
- **THEN** 新命令被拒绝，界面收到更新后的有限原因，且记录关联的探测变化

#### Scenario: readiness changes while a command is running
- **WHEN** 探测结果变化时已有命令运行
- **THEN** 主进程关闭后续命令准入并按现有 runner 生命周期收束当前命令，诊断记录状态变化与收尾结果

### Requirement: Windows command setup UI does not promise the retired SRT backend
Windows 命令能力界面 MUST 只展示当前实际 runner 的支持状态和操作。界面 MUST NOT 提示安装或使用不参与执行的 SRT helper；能力报告不可用时，界面 MUST 说明当前原因且不得暗示命令会回退到宿主环境。

#### Scenario: Windows command capability is unavailable
- **WHEN** 用户查看 Windows 命令能力状态
- **THEN** 界面显示主进程提供的 runner 拒绝原因，并且不出现旧 SRT 安装承诺

#### Scenario: Windows command capability is available
- **WHEN** runner 资源与隔离设置均通过主进程核验
- **THEN** 界面仅依据当前主进程报告显示命令可用及对应 runner 身份

### Requirement: Project tasks bind to a verified workspace object

The system MUST resolve a user-selected workspace in the trusted main process and capture a versioned filesystem identity for the directory before admitting project work. It MUST persist the identity with the task, and for project tasks it MUST bind the project to that workspace. Missing, invalid, or unavailable identity metadata MUST fail closed before task creation.

#### Scenario: First task binds a project

- **WHEN** a user starts work for an unbound project and explicitly selects an accessible directory
- **THEN** the system resolves the canonical directory and captures its filesystem identity
- **AND** the project binding and immutable task snapshot are stored before execution starts

#### Scenario: Existing binding still matches

- **WHEN** a user selects a directory whose canonical path and filesystem identity match the project's binding
- **THEN** the task is admitted with a new immutable identity snapshot

#### Scenario: Project workspace changed

- **WHEN** a selected path or its filesystem identity differs from the project's binding
- **THEN** the system pauses before task creation and asks the user to confirm rebinding or cancel
- **AND** cancellation creates no task and changes no project binding
- **AND** confirmation updates the project binding only when no project task is active

#### Scenario: Identity capture fails

- **WHEN** the selected path is missing, is not a directory, or the filesystem identity cannot be captured
- **THEN** the system rejects admission before creating a task or starting an executor

### Requirement: Resume validates the saved workspace identity

Before resuming a task, the system MUST recapture the directory identity and compare it with the immutable task snapshot. Missing legacy snapshots, path changes, replacement directories, or identity capture errors MUST deny resume without changing task status or replaying an action.

#### Scenario: Workspace still matches on resume

- **WHEN** the saved path resolves to the same canonical directory and filesystem identity
- **THEN** the system may continue existing resume admission checks

#### Scenario: Workspace moved or replaced

- **WHEN** the saved path is missing, resolves elsewhere, or has a different filesystem identity
- **THEN** the system rejects resume without mutating the task
- **AND** tells the user to select the intended workspace and start a new task

#### Scenario: Legacy task has no identity

- **WHEN** a task created before this requirement has no saved workspace identity
- **THEN** the system preserves its history but rejects automatic resume

### Requirement: Workspace identity diagnostics protect local data

Workspace identity diagnostics MUST use stable bounded reason codes and MUST NOT include absolute paths, filesystem device identifiers, file indexes, or directory contents.

#### Scenario: Identity decision is traced

- **WHEN** identity capture, bind, rebind, or resume comparison completes
- **THEN** a local diagnostic event records the decision and schema version
- **AND** sensitive filesystem identity fields are omitted

### Requirement: 项目文件工具限于经过检查的工作区

项目文件工具 MUST 将相对路径解析在当前 task 已绑定的 workspace identity 内。符号链接、reparse point、普通文件硬链接计数大于 1、文件系统元数据查询错误、扫描超出界限或 workspace identity 变化 MUST 在读写发生前拒绝该工具调用。目录搜索 MUST 对它可能读取的 workspace 树应用同一拒绝策略。工具 MUST NOT 通过根目录外路径、别名或文件系统链接读写目录外对象。

#### Scenario: 读取普通工作区文件
- **WHEN** task identity 仍匹配，且 workspace 扫描无 reparse point、hard link 或查询错误
- **THEN** 文件工具只读取 workspace 内解析出的普通文件

#### Scenario: workspace 含硬链接或重解析点
- **WHEN** 任一文件工具准备访问 workspace，且检查发现普通文件 hard link、reparse point、扫描超限或元数据错误
- **THEN** 工具在读取内容或修改文件之前拒绝调用，并返回可理解的有限原因

#### Scenario: workspace 路径身份已变化
- **WHEN** 文件工具执行前重新解析的 workspace identity 与 task snapshot 不匹配
- **THEN** 工具拒绝访问，不跟随替换后的目录继续工作

### Requirement: 项目文件写入产生可审阅的持久变更记录

`edit_file` 与 `write_file` MUST 在已授权项目任务中立即应用成功的修改，同时持久记录 workspace-relative path、created/modified 类型、修改前后内容摘要、可审阅的有界文本差异和恢复所需的原始字节。变更记录 MUST 与 task 和 tool step 关联，renderer MUST 向用户展示；诊断事件 MUST NOT 包含路径、哈希、内容、diff 或工具参数。超过恢复存储上限时，写工具 MUST 在修改工作区之前拒绝操作。

#### Scenario: 新建文件
- **WHEN** 用户授权的项目任务通过 `write_file` 创建文件并完成写入校验
- **THEN** task 记录显示相对路径、创建状态、前后摘要和可审阅差异

#### Scenario: 修改现有文件
- **WHEN** `edit_file` 或 `write_file` 成功替换现有普通文本文件
- **THEN** task 记录保留修改前字节及修改后摘要，向用户展示该文件的有界差异

#### Scenario: 写入失败或结果未知
- **WHEN** 文件修改开始后工具报错、中断或无法核实写入结果
- **THEN** task 记录标明未应用或结果未知；系统不伪报成功，且不自动撤回或重放该写入

#### Scenario: 恢复依据容量耗尽
- **WHEN** 保存该文件的恢复依据会超过配置的 task 或应用存储上限
- **THEN** 工具拒绝写入，工作区文件保持原样，并向 Agent 和用户说明限制

### Requirement: 用户可以保留或安全撤回已结束任务的文件变更

用户 MUST 能在 task 结束后按 workspace-relative path 查看文件工具产生的变更，并明确选择保留或撤回。撤回 MUST 仅在 workspace identity 仍匹配且磁盘当前内容摘要等于记录的最新修改后摘要时写回原始字节；对新建文件只可在内容仍匹配时删除。内容已被用户或其他程序改动、身份无法验证、或原始状态未知时，系统 MUST 拒绝覆盖并说明冲突。多文件撤回可部分成功，MUST 逐文件报告最终状态且不得声称原子回滚。

#### Scenario: 用户保留文件修改
- **WHEN** 用户在 task 结束后明确选择保留某个已审阅文件的修改
- **THEN** 系统保留工作区内容并释放该文件的原始字节恢复副本，同时保留可见的差异摘要

#### Scenario: 用户撤回仍未被改动的文件
- **WHEN** 用户明确撤回且当前文件摘要仍等于 Noema 记录的最新写入摘要
- **THEN** 系统对现有文件恢复原字节，或删除由 Noema 创建且未再改动的文件，并记录撤回结果

#### Scenario: 文件在 task 结束后被外部修改
- **WHEN** 用户请求撤回但当前文件摘要与 Noema 写入后的摘要不同
- **THEN** 系统不写入、不删除该文件，并显示并发修改冲突

#### Scenario: 多文件撤回中部分文件冲突
- **WHEN** task 含多个文件且撤回时部分文件可恢复、部分文件已发生冲突
- **THEN** 系统仅恢复符合校验的文件，逐文件显示成功或冲突，不声称整个 task 已完全回滚

### Requirement: 用户可只读审阅 Git 工作区变更

对于 Git 工作区，Noema MUST 提供只读的 tracked/staged 与未跟踪文件变更审阅，并对无效仓库、超限结果或 Git 查询错误明确显示不可用原因。审阅 MUST NOT 执行 commit、stage、reset、clean、checkout、network 操作或调用外部 diff/textconv。界面 MUST 标明此视图展示当前工作区状态，可能包含 task 开始前已存在的用户变更；不得将其冒称为 task 独占差异。

#### Scenario: 查看 tracked 与未跟踪文件
- **WHEN** 用户查看绑定 Git workspace 的 task 文件审阅
- **THEN** 系统以有界列表和差异呈现当前 tracked/staged 与未跟踪修改，并标出内容来自工作区当前状态

#### Scenario: Git 审阅不可用
- **WHEN** 目录不是可用 Git 工作区或只读状态检查失败/超限
- **THEN** 系统显示不可用及原因，不展示为空的成功审阅，也不运行替代修改命令

#### Scenario: Git 仓库配置包含外部 diff 工具
- **WHEN** 用户请求查看差异且仓库配置了 external diff 或 textconv
- **THEN** 审阅仍只用 Noema 内置差异呈现，不调用外部程序

### Requirement: 项目任务显示真实的执行阶段
项目任务 MUST 将实际执行阶段持久化并呈现，使用户能够区分模型请求/响应、模型已请求工具、等待用户授权、工具执行、限流等待、结果核验及终态。阶段说明 MUST 来源于执行链事实；系统 MUST NOT 显示隐藏推理或推测未观察到的活动。

#### Scenario: 正在请求模型并接收回复
- **WHEN** 任务执行器向模型发出请求或收到模型的可见响应内容
- **THEN** 任务卡显示正在等待模型或正在接收模型回复，不把它标为工具执行

#### Scenario: 模型已请求工具
- **WHEN** 模型返回工具调用且 Noema 尚未开始执行该工具
- **THEN** 任务卡显示工具准备/待执行阶段，并且不宣称副作用已经发生

#### Scenario: 工具等待用户授权
- **WHEN** 命令执行链正在等待用户批准额外路径或网络访问
- **THEN** 任务卡显示等待本次用户授权；在授权前不显示命令已经运行

#### Scenario: 工具正在执行
- **WHEN** 持久 execution step 处于 running
- **THEN** 任务卡显示对应的有限工具类别和执行中状态

#### Scenario: 限流暂停和核验
- **WHEN** 任务正在等待限流冷却或独立核验文件条件
- **THEN** 任务卡分别显示等待重试或核验中，不将其呈现为模型/工具仍在运行

#### Scenario: 未知执行阶段
- **WHEN** 读取到旧记录或无法识别的 phase
- **THEN** 任务卡显示中性“处理中/状态未知”说明，不据此臆测具体动作或授权结果

### Requirement: 任务进度投影保持持久状态为唯一事实
任务进度 UI MUST 以持久任务快照和 execution-step 记录为权威数据。进度事件只用于触发快照刷新；renderer 重载或事件乱序后 MUST 恢复最新状态，且不得由事件到达顺序覆盖较新的任务事实。

#### Scenario: 窗口重载时任务仍在运行
- **WHEN** renderer 重载并读取一个仍活动的任务
- **THEN** 页面从持久任务状态显示当前阶段与当前工具步骤，而非从空白临时 UI 开始

#### Scenario: 任务更新事件乱序
- **WHEN** 较旧的房间读取请求晚于更新的读取结果返回
- **THEN** renderer 保留更新的持久快照，不回退到过期进度或终态

#### Scenario: 执行步骤结果未知
- **WHEN** command/tool step 的执行或清理结果为 unknown
- **THEN** UI 明确显示结果不确定及检查提示，不显示成功，也不提供自动重放暗示

### Requirement: 未完成任务的已保存文本明确标记为阶段内容
项目任务界面 MUST 区分成功完成的执行结果与 failed、interrupted 或仍活动任务中的已保存文本。未完成任务 MUST 显示其未完成状态及现有恢复/检查提示，且 MUST NOT 将阶段文本称为成功交付。

#### Scenario: 完成任务显示执行结果
- **WHEN** task status 为 completed 且存在结果文本
- **THEN** task card 将文本标为执行结果，并保留独立核验状态说明

#### Scenario: 用户停止任务后有部分文本
- **WHEN** task status 为 interrupted 且存在已保存文本
- **THEN** task card 将其标为停止前保存的部分内容，并说明任务未完成

#### Scenario: 失败任务保留部分输出
- **WHEN** task status 为 failed 且存在已保存文本
- **THEN** task card 将其标为未完成任务的已保存内容，并同时呈现失败原因和恢复提示

#### Scenario: 续接期间仍保留前序文本
- **WHEN** task 正在安全 checkpoint 续接且已有前序已保存文本
- **THEN** task card 明确说明当前任务尚未完成，文本为已有阶段内容，当前执行阶段由 task status 展示

### Requirement: Resumed execution segments have distinct diagnostic identity
Noema MUST keep the durable task ID stable when resuming and assign each resumed execution segment a distinct diagnostic execution ID. Segment diagnostics MUST retain both IDs.

#### Scenario: Safe checkpoint resume begins a new execution segment
- **WHEN** a user explicitly resumes a task from a permitted model-boundary checkpoint
- **THEN** the task ID remains the historical grouping key, a new execution ID identifies this segment, and a task-scoped diagnostic query can retrieve both the resume event and the segment events

### Requirement: Resume diagnostics identify the checkpoint without exposing content
The resume event MUST record the checkpoint phase and bounded recovery reason. Segment lifecycle diagnostics MUST use the segment execution ID and durable task ID. Diagnostics MUST NOT include checkpoint messages, prompts, workspace paths, tool arguments, command text, or result content.

#### Scenario: Safe checkpoint resume records bounded context
- **WHEN** a safe checkpoint is explicitly resumed
- **THEN** the diagnostic event records only its phase and recovery reason in addition to IDs, with no checkpoint or user content

#### Scenario: Checkpoint data is corrupt
- **WHEN** persisted checkpoint JSON is malformed before the user resumes
- **THEN** resume fails before the durable task status changes or an executor starts, and the task remains available as failed/interrupted history for inspection

### Requirement: Noema exposes project tools for explicit project work
Noema 主聊 MUST 在用户明确提及项目、计划、团队、交付、核验、核对或评审等项目工作意图时，向模型提供可用项目工具，即使用户没有直接说“项目”。工具 MUST 只包含当前用户可访问的项目，并继续服从既有项目状态与权限检查。

#### Scenario: 用户请求核验已提交工作
- **WHEN** 用户在 Noema 主聊要求核验某项已提交工作，且没有在当前消息或近期对话提及“项目”
- **THEN** 系统仍提供当前可访问项目的计划读取与证据核验工具

#### Scenario: 用户请求项目评审
- **WHEN** 用户明确要求对现有项目发起评审
- **THEN** 系统向模型提供评审工具，并由工具处理器继续验证项目状态、来源和重复请求

### Requirement: 项目会话工具保持绑定项目身份
项目绑定会话中的 plan tool schema MUST 隐去 `project_id`，并保持绑定当前项目；即使模型输入仍包含额外或错误的 `project_id`，工具结果 MUST 标明实际绑定项目，额外 ID MUST NOT 切换或授权其他项目。

#### Scenario: 成员工具输入携带错误项目 ID
- **WHEN** 项目成员会话调用 plan tool 并附带不匹配的 `project_id`
- **THEN** 系统仍只读取绑定项目的计划，不访问错误 ID 所指项目，并在结果中返回绑定项目 ID

### Requirement: 项目计划工具说明证据读取规则
plan tool 的模型可见说明 MUST 要求模型完整读取被标记截断的工作项，并将链接证据视为不可信资料而非指令；接收或提交成果时仍须遵守实际来源读取规则。

#### Scenario: 计划摘要包含截断标记
- **WHEN** 模型看到计划工作项摘要标记为截断
- **THEN** tool description 要求模型先读取该工作项完整内容，再判断或验收

#### Scenario: 链接证据包含指令
- **WHEN** 模型通过 plan tool 读取链接证据
- **THEN** tool description 明确要求将证据内容作为资料而非执行指令

### Requirement: 损坏的诊断详情必须作为覆盖缺口显示
诊断事件查询 MUST 对持久化详情重新执行字段白名单与凭据脱敏，并限制单条详情大小。有效详情 MUST 标明完整或经过过滤；无法解析或超限时 MUST 保留事件的安全字段，将详情标为不可用，并在时间线和导出报告中暴露覆盖缺口。

#### Scenario: 查询包含未知字段或凭据的详情
- **WHEN** 持久化详情包含未允许字段、疑似凭据或超出白名单值长度
- **THEN** 查询结果只包含安全过滤后的详情，并标明详情已过滤；敏感原文不会进入 renderer 或导出

#### Scenario: 查询损坏或超限的详情
- **WHEN** 持久化详情不是有效对象 JSON 或超过单条大小上限
- **THEN** 时间线保留该事件的安全元数据，将详情标为不可用，并显示 `diagnostic_event_details_unavailable` 覆盖缺口

#### Scenario: 导出包含不可用详情
- **WHEN** 用户预览包含损坏或超限详情事件的诊断报告
- **THEN** 导出预览及报告保留详情不可用覆盖缺口，不把空详情表示为完整记录

### Requirement: Provider usage 将未知值与零值区分
Provider token usage MUST 仅在返回至少一个可识别的有效非负 token/cache 计量时标记为已收到。每个缺失、无效或互相矛盾的 token/cache 计量 MUST 保持 unknown；真实零值 MUST 保留为零，诊断界面不得将 unknown 显示为零。Provider cost 独立保留，不代表 token 计量已收到；cache-write 字段只从所适配协议明确规定的响应路径读取。

#### Scenario: 空或不可识别的 usage 对象
- **WHEN** provider 响应包含空 usage、仅有未知字段或所有已知字段均无效
- **THEN** 本机请求保持 usage missing，token/cache 数值均为 unknown，不显示为零

#### Scenario: Provider 明确报告零 token
- **WHEN** provider 对有效 usage 字段明确报告数值 0
- **THEN** 系统将该字段记录为零并标记 usage 已收到

#### Scenario: Provider 只报告部分计量
- **WHEN** provider 返回输入或输出 token 的部分有效字段而缺少其它字段
- **THEN** 有效字段照常展示，缺失字段显示 unknown 而不是零

#### Scenario: Provider 报告或省略 cache-write 计量
- **WHEN** 响应包含受支持协议的 cache-write 数值，或没有该字段
- **THEN** 明确返回的数值（包括零）显示在时间线和本地报告中；缺失字段保持 unknown

#### Scenario: 缓存分解与输入总量矛盾
- **WHEN** provider 报告的缓存命中与未命中合计不等于输入 token 总量，或单项大于总量
- **THEN** 有矛盾的缓存分解保持 unknown，不静默修正为零或推算命中

### Requirement: Provider requests retain distinct task and segment identities
Every SocialWork provider request MUST use the durable task ID as its interaction identity and the current execution segment ID as its execution identity. Resuming a task MUST use a new execution identity while keeping the same task identity.

#### Scenario: Resumed task request is attributed to its new segment
- **WHEN** a user explicitly resumes a permitted task from a checkpoint
- **THEN** the request and usage records retain the same durable task ID and use the new segment execution ID

### Requirement: Provider request preserves source-turn identity
When a SocialWork task has an originating Social turn, every provider request MUST retain that turn ID in request and usage records. A missing source turn MUST remain absent rather than being inferred from a later resume action.

#### Scenario: Initial or resumed request retains its source turn
- **WHEN** a task has an originating Social turn and makes an initial or resumed provider request
- **THEN** the request and usage records use that original turn ID

#### Scenario: Request diagnostic identity is safe
- **WHEN** the provider request emits a diagnostic event
- **THEN** it retains the task and segment IDs and contains no prompt, checkpoint, path, tool argument, command, or result content
