# Spec Delta

## MODIFIED Requirements

### Requirement: 项目文件工具限于经过检查的工作区

项目文件工具与 SocialWork 命令 MUST 只访问与 task workspace identity 绑定、经主进程复核的工作区对象。文件工具 MUST 拒绝符号链接、reparse point、普通文件硬链接计数大于 1、特殊文件、扫描超限或元数据错误。SocialWork `run_command` MUST 在命令专属隔离副本中运行，且真实工作区不得进入该命令的写 capability。命令副本 MUST 由已通过边界检查的完整工作区快照生成，包含隐藏、未跟踪和被忽略的普通文件；身份、复制内容或限制校验不一致时 MUST 在启动子进程前拒绝。

#### Scenario: 读取普通工作区文件
- **WHEN** task identity 仍匹配，且 workspace 扫描无 reparse point、hard link 或查询错误
- **THEN** 文件工具只读取 workspace 内解析出的普通文件

#### Scenario: workspace 含硬链接或重解析点
- **WHEN** 任一文件工具准备访问 workspace，且检查发现普通文件 hard link、reparse point、扫描超限或元数据错误
- **THEN** 工具在读取内容或修改文件之前拒绝调用，并返回可理解的有限原因

#### Scenario: workspace 路径身份已变化
- **WHEN** 文件工具执行前重新解析的 workspace identity 与 task snapshot 不匹配
- **THEN** 工具拒绝访问，不跟随替换后的目录继续工作

#### Scenario: 创建命令快照时工作区不稳定或超过界限
- **WHEN** SocialWork 命令准备副本时发现 workspace identity 变化、源/副本清单不一致、特殊对象、扫描/复制失败或空间/配额不足
- **THEN** 命令在 child spawn 前拒绝，真实工作区不被修改，诊断只记录有限原因码

#### Scenario: 命令仅在隔离副本写入
- **WHEN** SocialWork `run_command` 通过执行准入并启动子进程
- **THEN** cwd 和可写 filesystem capability 只指向该命令副本，真实 workspace 只可读，运行中的副作用不出现在真实目录

#### Scenario: 命令请求写入额外根目录
- **WHEN** 命令请求对 workspace mirror 之外的路径取得写权限
- **THEN** 主进程拒绝该写 capability，且不得以宿主权限或另一个 runner 作为回退

### Requirement: 项目文件写入产生可审阅的持久变更记录

`edit_file`、`write_file` 与 SocialWork 命令写入 MUST 在真实工作区改变前持久记录恢复所需的原始状态。命令 MUST 按 task、命令 step 和相对路径记录来源、base/proposed/current 摘要、恢复材料及有界差异；单个命令可影响多个路径，且所有路径记录归属于同一持久 command batch。记录 MUST 进入现有 SocialWork task/file-change owner，不得创建旁路 task store 或第二套文件审阅/撤回库。诊断 MUST NOT 包含路径、哈希、正文、diff、命令文本或工具参数。

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

#### Scenario: 命令产生多路径变更
- **WHEN** 一个 SocialWork 命令创建、修改或删除多个普通文件
- **THEN** 所有路径变更都能追溯到同一 task 与 command step，并在任何真实路径同步前持久保存其恢复材料和 proposed 版本

#### Scenario: 命令崩溃或副作用结果未知
- **WHEN** 进程树未能确认收束、或持久记录与磁盘状态无法核对
- **THEN** batch 与路径记录保持 unknown/recovery-needed，保留 mirror 和恢复材料，不重放该命令

### Requirement: 用户可以保留或安全撤回已结束任务的文件变更

用户 MUST 能在 SocialWork task 结束后按工作区相对路径审阅文件工具及命令产生的变更，并明确选择保留或撤回。撤回 MUST 仅在 workspace identity 仍匹配且当前对象仍匹配 Noema 最后确认写入版本时恢复原状态；新建文件仅可在内容仍匹配时删除。用户并发修改、对象替换、身份无法验证或恢复材料未知时 MUST 拒绝覆盖。多路径同步和撤回允许部分成功，但 MUST 逐路径报告结果、保留冲突材料且不得声称批次原子回滚。

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

#### Scenario: 命令结束后自动同步无冲突变更
- **WHEN** command/job 的完整进程树已确定收束，且目标路径仍匹配其 base 对象与摘要
- **THEN** Noema 在工具返回前持久化恢复材料并逐路径同步变更，之后可在 task 审阅中选择保留或撤回

#### Scenario: 写回时检测到并发改动
- **WHEN** command batch 同步前发现真实文件已偏离 base 对象或摘要
- **THEN** Noema 不覆盖该路径，将 proposed 版本和必要恢复材料保留为 conflict，其他无冲突路径仍可逐一完成

#### Scenario: 命令写回中断
- **WHEN** 多路径同步发生错误、磁盘不足或应用崩溃
- **THEN** Noema 根据持久逐路径状态呈现 applied/conflict/unknown，保留 mirror/备份并阻止副作用未知的自动重跑

### Requirement: 用户可只读审阅 Git 工作区变更

对于 Git 工作区，Noema MUST 提供只读的 tracked/staged 与未跟踪文件变更审阅，并对无效仓库、超限结果或 Git 查询错误明确显示不可用原因。审阅 MUST NOT 执行 commit、stage、reset、clean、checkout、network 操作或调用外部 diff/textconv。界面 MUST 标明此视图展示当前工作区状态，可能包含 task 开始前已存在的用户变更；不得将其冒称为 task 独占差异。SocialWork 命令 MUST 将真实 Git metadata（包括 index、refs、config 及仓库管理数据）限制为只读；该 metadata MUST NOT 随 mirror 工作区变更回写。

#### Scenario: 查看 tracked 与未跟踪文件
- **WHEN** 用户查看绑定 Git workspace 的 task 文件审阅
- **THEN** 系统以有界列表和差异呈现当前 tracked/staged 与未跟踪修改，并标出内容来自工作区当前状态

#### Scenario: Git 审阅不可用
- **WHEN** 目录不是可用 Git 工作区或只读状态检查失败/超限
- **THEN** 系统显示不可用及原因，不展示为空的成功审阅，也不运行替代修改命令

#### Scenario: Git 仓库配置包含外部 diff 工具
- **WHEN** 用户请求查看差异且仓库配置了 external diff 或 textconv
- **THEN** 审阅仍只用 Noema 内置差异呈现，不调用外部程序

#### Scenario: 命令尝试修改真实 Git metadata
- **WHEN** SocialWork 命令对真实仓库 index、refs、config 或其他 Git metadata 执行写入
- **THEN** Windows runner 的文件 capability 拒绝写入，真实 Git metadata 保持不变，命令不会通过环境变量约定绕过此限制

#### Scenario: Git metadata 布局无法安全解析
- **WHEN** workspace 的 Git metadata/linked-worktree/submodule 布局无法解析并授予只读访问
- **THEN** Noema 在 spawn 前拒绝该写命令并说明有限原因，不授予真实 Git metadata 写 capability
