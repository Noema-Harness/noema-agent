# 新建联系人时创建成员工作目录

Plan: https://github.com/Noema-Harness/noema-agent/issues/141

## 为什么

招募（新建联系人）时应当为新成员准备默认工作目录（`ensureAgentDirectory`，在 `Documents/Noema/Agents/<名称>-<id 末 6 位>`）。但 `SocialAgentService.createAgent` 从 `store.createAgent` 的返回值读 `room.agent.id` / `room.agent.name`，而 store 返回的是房间快照 `{ room, members, messages, ... }`，没有 `agent` 字段。每次都抛 TypeError 并被“尽力而为”的 catch 吞掉，结果新建联系人从未创建工作目录，只能等首次任务时补建。TS 迁移第二阶段（PR #146）发现了它，但那次只允许改类型，修复单独做。

## 改什么

- `SocialAgentService.createAgent` 从快照的 `members` 中取新成员（直聊房间只有这一位成员），把正确的 `agentId` 与 `name` 交给 `ensureAgentWorkspace`。
- 新增服务层测试：新建联系人后 `ensureAgentWorkspace` 收到正确的 `agentId` 与 `name`。

## 不改什么

- 不改 store 的返回形状，不改目录命名规则，不改“建目录失败不阻断创建”的尽力而为语义。
