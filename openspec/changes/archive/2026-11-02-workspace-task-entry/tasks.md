# Tasks

## 1. Noema 主聊工作区任务入口

- [x] 1.1 在主聊 composer 增加 readiness-aware 的工作区任务切换控件；controller 在提交和排队时加入可见、可重试的本地执行意图前缀，切换聊天或发送成功后退出模式；复用现有主聊/项目工作流程，不增加任务 owner。定向服务测试确认该意图仍会使 `start_project_work` 可用；social-chat-service 测试、renderer/typecheck 均通过。
- [x] 1.2 检查默认入口、readiness 不可用原因、原生按钮键盘焦点语义，以及 680px 窄窗口下 composer 可见且无横向溢出；严格规格校验通过。切换启用后的真实任务、发送队列和 provider 失败恢复不在无真实 runner/model 的隔离 smoke 中模拟，代码沿用已覆盖的现有任务/消息流程，留待用户自用验收。
- [x] 1.3 主进程为窗口入口创建 application execution ID，并关联路由选择、首次 project-work readiness 与已创建 task ID；诊断中不得记录指令或路径。IPC 单测、隔离桌面 smoke 验证 readiness 回调、路由/readiness 事件关联及字段。

## Workflow follow-up

- [x] 归档已完成的 OpenSpec change 并核对归档规格仍包含新增场景。
