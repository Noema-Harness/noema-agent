# Proposal

## Why

一期开发闭环依赖可解释的任务状态和谨慎恢复。当前实现已经将 project task、execution step 与 runtime checkpoint 保存在 SocialChatStore，并由 SocialWorkService 编排；需要把这一事实与允许恢复的条件写成稳定契约，并防止重开存储时覆盖已经结束的任务。

## What Changes

- 规定 SocialChatStore 是 SocialWork task、step、checkpoint 与项目结果关联状态的唯一持久状态 owner；Service 通过 store API 编排状态转换，Executor 只通过事件回报。
- 明确任务状态与执行阶段、工具步骤副作用状态、runtime checkpoint 各自表达的含义。
- 明确进程重启不会自动重跑任务；不确定副作用标为 outcome_unknown，只有符合当前安全检查点规则的 Noema task 才能显式恢复。
- 增加回归测试，确认重新打开 store 会中断活动任务，但保留已结束任务的终态与结果。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：补充 task 状态 owner、恢复条件与终态保留要求。

## Impact

- `openspec/specs/project-execution/spec.md`
- `apps/desktop/src/main/chat/records.mjs`
- `apps/desktop/src/main/chat/migrations.mjs`
- `apps/desktop/src/main/chat/social-chat-store.mjs`
- `apps/desktop/src/main/chat/social-chat-service.mjs`
- `apps/desktop/src/main/execution/social-work-service.mjs`
- `apps/desktop/src/main/execution/noema-project-executor.mjs`
- `apps/desktop/test/main/chat/social-chat-store.test.mjs`

不新增状态、持久表或任务 owner；不迁移或删除现存任务数据，不改变 DSH legacy task 的恢复路径。
