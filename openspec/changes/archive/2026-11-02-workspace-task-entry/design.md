# Design

## Context

见 [proposal.md](proposal.md) 与 `project-execution` delta。默认界面是 `SocialChatApp`；自然语言请求会使 `SocialChatService` 暴露现有项目工作工具，`SocialWorkService` 负责用户选择工作区、创建任务并启动执行。当前入口依赖用户知道该怎样向模型描述文件操作。

## Goals / Non-Goals

**Goals:**

- 在 Noema 主聊 composer 增加清楚、可撤销的工作区任务模式。
- 发送后以可见、持久的用户消息表达本地执行意图，让现有工具选择、工作区授权披露和任务卡片继续承担职责。
- 将 readiness 原因用于禁用态，避免入口显示可用但实际无法启动。
- 让默认路由、工作区执行器 readiness 和已创建任务可在本机现有诊断日志中追踪。

**Non-Goals:**

- 不绕过模型请求，不新建 IPC 或 SocialWork task owner，不启动第二个 harness。
- 不移除 `#legacy` 路由；当前它不是默认入口，A1 不需要迁移旧会话或删除代码。
- 不解除 Windows command fail-closed，也不调用真实模型验证入口。

## Decisions

1. **在主聊 composer 增加显式切换按钮。** 仅 Noema 主聊显示；未启用时普通聊天行为不变。它放在现有附件/发送控件附近，采用当前 social-chat composer 的按钮尺寸、颜色和键盘焦点规则，不引入新面板。
2. **模式只在发送时转成自然语言请求前缀并随用户消息持久化。** 使用稳定短句“请在本机工作区执行以下任务：”，再附用户输入和已处理文字附件。这样现有 `shouldExposeExistingProjectTools`、project-work readiness 与模型工具契约继续生效；重试也能从已保存用户消息恢复原始意图，无需新增数据库列或隐藏 ephemeral metadata。
3. **readiness 仅控制入口可用性，服务端仍作最终校验。** renderer 使用 `NoemaSocialState.projectWork` 展示可用状态和原因；发送后服务端沿现有 `start_project_work` 和 `SocialWorkService` 校验。状态过期或执行器失败时按现有错误路径拒绝，不回退到 RootAgent/DSH 或宿主 shell。
4. **任务模式在当前 Noema 主聊范围内临时存在。** 切换房间或成功发送后关闭；发送失败则保留草稿和模式以便用户修改/重试。排队消息先带上明确前缀再保存，因此后续派发不丢委托语义。
5. **入口诊断由主进程记录。** 每次窗口载入时生成 application execution ID，并写入 `entry_route_selected`；默认主聊首次读取状态时记录执行器是否可用；实际创建 SocialWork task 后记录其 task ID。事件复用本机有界 `renderer-health.jsonl`，不写用户指令、文件正文、密钥或工作区路径。后续统一诊断事件 schema 时再迁移这些入口事件。

## Risks / Trade-offs

- [模型未调用工作工具] → 用户消息已明确记录本地任务意图，project-work 工具会按现有规则进入可选工具集；A1 不承诺绕过模型直接启动，工具选择偏差留到 E 阶段工作流验收。
- [readiness 在显示后变化] → UI 状态只作提示，`SocialWorkService` 仍在启动前复核；失败显示真实原因且不创建任务。
- [入口事件暂存于 renderer health 日志] → 复用现有本机有界日志，字段严格限于 route、execution/task ID 和 readiness 布尔值；统一诊断基础设施建立后迁入版本化事件 schema。
- [前缀被用户视为噪音] → 采用一句短指令并保存为用户可见消息，避免隐藏元数据；实际运行检查用户消息呈现与 task card 关联。

## Migration Plan

不改数据库 schema。部署时普通聊天保持原行为；readiness 不可用时显示禁用态。若回滚，只移除 composer mode 控件和发送前缀，不需数据迁移；已发送的用户消息保留为普通可读对话。

## Open Questions

无。具体按钮放置和提示文案是局部可逆 UI 决策，依据现有 composer 布局实现。
