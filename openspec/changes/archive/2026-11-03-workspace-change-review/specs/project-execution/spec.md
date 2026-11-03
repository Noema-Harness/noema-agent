## ADDED Requirements

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
