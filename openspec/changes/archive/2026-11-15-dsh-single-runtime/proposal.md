# Proposal

## Why

Noema 仍同时保留多套 Agent 循环：RootAgent、SocialChatService 自己的模型循环、`NoemaProjectExecutor` 和 DSH Headless。执行记录因此同时出现 `agent_id='noema'`、项目成员执行者和 `noema-executor`，同一条工作既可能由 Noema 自身执行，也可能由旧执行器或 DSH 执行。用户无法从产品上判断“谁在执行、谁在负责、上下文归谁”。

这不是单纯的代码重复，而是职责边界混乱：会话历史、工具权限、压缩和恢复被多个运行时分别拥有。继续在旧循环上打补丁只会制造更多身份和状态。

## What Changes

- DSH Headless 成为唯一 Agent 运行时；Noema 不再保留生产路径上的模型循环和工具执行循环。
- 将 `NoemaProjectExecutor` 移入 `main/legacy/`，生产代码不得引用；旧的命令镜像执行器只保留为迁移测试和 Windows 镜像验证材料。
- 执行层统一经 `SocialWorkService` 调用 DSH；项目成员路径与任务卡路径最终共享同一执行器，而不是各自维护运行时。
- 明确会话角色：Noema 个人 Agent、Specialist、Executor、Group lead 使用同一 DSH 运行时，但拥有不同的工具集、上下文来源、工作区和权限策略。
- 产品对象与会话分离：Profile、Room、Project、Task Card、Memory 是 Noema 持久对象；只有一次 Agent turn/run 是 DSH session。
- 任务卡取代 ticket 作为产品术语；卡片可分配给单个执行者或团队，团队由 lead session + member sessions 组成，不成为第二套运行时。
- DSH 拥有 session history、token 计数和压缩；Noema 只配置上下文窗口、最大输出和保留预算，并记录压缩事件，不重复压缩。
- 旧运行路径先隔离，再按迁移任务逐项删除；不在本次变更中删除项目、专家、群聊等核心产品能力。

## Capabilities

### New Capabilities

- `agent-runtime`: Agent 会话归属、角色隔离、DSH 唯一运行时、旧运行时隔离和上下文压缩所有权。

### Modified Capabilities

- `project-execution`: 项目执行必须使用 DSH 运行时，并通过任务卡/执行记录返回结果；旧的 Noema 执行器不得作为生产回退。

## Impact

- `apps/desktop/src/main/main.ts` 不再构造 `NoemaProjectExecutor` 或命令镜像执行器；`SocialWorkService` 只接收 DSH（或合成测试适配器）。
- `apps/desktop/src/main/legacy/` 新增隔离目录和边界检查；`npm run source:check` 拒绝生产代码引用。
- 现有 `NoemaProjectExecutor` 测试和迁移脚本继续引用 legacy 路径，仅用于回归和历史对照。
- 后续阶段迁移 RootAgent 与 SocialChatService 的模型循环；本阶段不改变 UI、数据库 schema 或用户可见工作流，只先关闭执行层的第二个运行时。

---

## 归档说明（2026-11-15）

本变更已关闭，不再作为活动计划：剩余任务要么已由后续交付覆盖，要么已被新决定替代（见 `docs/DECISIONS.md` 与 `docs/STATUS.md`），规格增量未合并进 `openspec/specs`。需要继续时按新变更重新立项，不要恢复旧任务表。
