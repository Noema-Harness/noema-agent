# agent-runtime Specification

## Purpose

定义 Noema 的 Agent 运行时归属：DSH 承担所有 Agent 循环、工具调用与会话历史；Noema 只拥有产品对象、角色策略和输入输出编排。

## ADDED Requirements

### Requirement: DSH 是唯一生产 Agent 运行时
系统 MUST 使用 DSH Headless 执行所有生产 Agent turn/run，包括 Noema 个人会话、Specialist 会话、Executor 任务和 Group lead 会话。生产代码 MUST NOT 启动第二套模型循环、工具循环或命令镜像循环，也不得在 DSH 不可用时静默回退到旧运行时。

#### Scenario: 启动普通 Noema 对话
- **WHEN** 用户在 Noema 主会话发送一条普通消息
- **THEN** 该 turn 由 DSH session 执行，Noema 只负责组装产品上下文、调用运行时并展示结果

#### Scenario: DSH 不可用
- **WHEN** DSH 运行时无法启动或中途不可用
- **THEN** 系统返回明确的不可用状态，不启动 `NoemaProjectExecutor`、RootAgent 或命令镜像作为替代

#### Scenario: 执行项目任务
- **WHEN** 项目成员或任务卡需要执行本机工作
- **THEN** 该 run 由 DSH session 执行，工作区、工具权限和证据仍由 Noema 的任务记录持有

### Requirement: 会话角色拥有不同策略但共享运行时
系统 SHALL 为 `noema`、`specialist`、`executor` 和 `group-lead` 定义明确的工具、上下文、工作区和权限策略；四类角色 MUST 共享同一 DSH 运行时，而不是各自实现模型循环。策略 MUST 在执行前确定，并在 run 记录中可追溯。

#### Scenario: Noema 个人 Agent
- **WHEN** Noema 处理用户对话
- **THEN** 它可以读取个人记忆、项目摘要、任务卡和团队信息，并调用派发、评审与综合工具；它 MUST NOT 获得任意工作区写入或宿主命令能力

#### Scenario: 执行者
- **WHEN** 执行者运行一个任务卡
- **THEN** 它获得工作区文件、命令和 DSH 工具，绑定一个工作区和一个 run；它 MUST NOT 读取个人记忆、充当联系人、创建团队或向用户发送社交消息

#### Scenario: 专家
- **WHEN** 专家处理专业对话或评审
- **THEN** 它读取自己的领域资料和当前项目上下文，默认只读；需要文件执行时 MUST 通过 Noema 创建或派发任务卡

#### Scenario: 团队 lead
- **WHEN** 团队处理复杂任务
- **THEN** lead 只负责协调、拆分、汇总和验收，成员各自拥有独立 session；团队 MUST NOT 变成共享一个上下文的超级会话

### Requirement: 产品对象与会话身份分离
系统 MUST 将 Profile、Room、Project、Task Card、Memory 和 Permission 作为 Noema 的持久产品对象，不得把 DSH session ID 当作这些对象的身份或唯一事实来源。一次 Agent turn/run 才对应一个 DSH session；产品对象可以跨多个 session 持续存在。

#### Scenario: 项目跨多次执行
- **WHEN** 同一项目先后运行多个任务卡
- **THEN** 每个任务卡拥有自己的 run/session 记录，项目身份保持稳定，不因 session 结束而丢失

#### Scenario: 查看任务历史
- **WHEN** 用户打开一个已完成任务卡
- **THEN** 系统显示该卡关联的 run、步骤、证据和结果，不要求用户理解 DSH session 内部结构

### Requirement: 旧 Agent 运行时被隔离
旧 `NoemaProjectExecutor` 和命令镜像执行器 MUST 被移入隔离目录，生产模块 MUST NOT 引用它们。隔离代码 MAY 被迁移测试、历史对照或独立验证脚本引用，但 MUST NOT 获得生产启动入口。

#### Scenario: 生产代码引用旧执行器
- **WHEN** `apps/desktop/src/main` 下的非 legacy 模块导入 legacy 执行器
- **THEN** `npm run source:check` 失败，阻止该变更进入构建

#### Scenario: 旧执行器测试
- **WHEN** 迁移测试需要验证旧 checkpoint 或历史恢复行为
- **THEN** 测试可以从 legacy 路径导入，但该测试不得成为生产回退路径

### Requirement: 上下文压缩由 DSH 拥有
系统 SHALL 由 DSH 基于真实 session history 和 token 计数执行上下文压缩；Noema MUST NOT 对同一 session 再执行第二套压缩。Noema 只负责配置上下文窗口、最大输出和保留预算，并记录/展示 DSH 产生的压缩事件。

#### Scenario: 长会话触发压缩
- **WHEN** DSH session 接近配置的上下文窗口
- **THEN** DSH 执行压缩并返回可识别的压缩事件，Noema 只记录和展示该事件

#### Scenario: DSH 未报告压缩事件
- **WHEN** headless 适配器完成压缩但没有发出事件
- **THEN** 系统补充适配器事件，不把 Noema 的旧压缩器重新接入活动路径

### Requirement: 任务卡是双向工作对象
任务卡 MUST 是可持久、可恢复、可分配的工作对象，而不是一次性表单或每条消息的附属记录。卡片 MUST 支持执行者/团队分配、双向消息、问题与阻塞、评审和验收；普通对话和只读咨询 MUST NOT 强制创建卡片。

#### Scenario: 创建可执行卡片
- **WHEN** Noema 判断用户请求需要外部副作用、交付物、审计或后续续接
- **THEN** 它创建卡片草稿，确认目标、工作区、权限和验收条件后再分配执行者或团队

#### Scenario: 执行中提出问题
- **WHEN** 执行者需要用户或 Noema 补充信息
- **THEN** 卡片进入 `waiting_for_input`，问题出现在卡片的双向消息中，回答后继续同一 run 或新 run

#### Scenario: 普通只读对话
- **WHEN** 用户只询问信息或进行不需要副作用的讨论
- **THEN** Noema 直接回答，不创建任务卡、项目或执行 session
