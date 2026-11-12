# Design

## Scope

复用现有 `SocialWorkService`、`SocialChatStore`、application execution ID 和诊断查询链。只补入口状态与取消结果的可追踪字段，不增加任务 IPC、执行器、持久化 owner 或恢复路径。

## Decisions

- readiness 增加有限 reason code：`app_shutting_down`、`executor_unavailable`、`provider_unconfigured`、`model_unselected`、`provider_checking`、`provider_unavailable`、`model_unavailable`；可用时 `reasonCode: null`。SocialChatService 将 SocialWork 的执行器/凭据/模型选择状态与当前主进程模型连接状态合并，展示文案仍由主进程生成。
- 文件夹选择返回取消时记录 `workspace.selection` / `canceled`，详情仅含 `reasonCode: user_cancelled`。主进程诊断包装器负责补当前 application execution ID。
- composer 的工作区任务模式随当前消息经 preload 与 Social IPC 传入主进程；主聊默认为关闭，主进程只在显式开启时向该 turn 提供 `start_project_work`，并在处理模型工具调用时再次检查本 turn 的可用状态。关闭时同一文本不触发本机文件执行。排队消息保留提交时的模式状态；模式不跨 room 或新 turn 延续。
- 拒绝或取消没有 task ID；仅成功保存 SocialWork task 后写 `task.created` 与入口关联事件。
- 项目成员会话与已授权项目报告续接保留原来的工作入口；本变更只约束 Noema 主聊的直接 workspace task turn。普通聊天、Root/DSH 历史与现有任务 owner 不变。

## Verification

覆盖各 readiness 分支、workspace mode on/off 同文提交、排队 turn 模式保留、取消时无任务/执行器调用、事件无指令/路径、IPC readiness contract，以及 SocialWork 创建链的 ID 关联和诊断查询 allowlist。
