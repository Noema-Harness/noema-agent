# design

改动落点：`apps/desktop/src/main/chat/social-agent-service.mjs`（`createAgent`）与 `apps/desktop/test/main/chat/social-agent-service.test.mjs`。
共享逻辑是否要移动：否。
是否新增路径或兼容层：否；只修正对 store 快照的读取。

## 事实影响

- 类别：行为
- 依据：新建联系人后立即出现该成员的工作目录，这是用户可观察的产品行为；行为契约写进 specialist-agents 规格增量。

## 实现选择

- 从 `getRoomSnapshot` 的 `members` 里按 `kind === 'specialist'` 取新成员，而不是改 store 返回 `agentId`：store 的直聊快照只含这一位成员，服务层读快照即可，不扩大 store 契约（维护者判断，用户可推翻）。
- 保持尽力而为：取成员与建目录都在 try 内，失败不影响联系人创建，首次任务时仍会补建。

## 用户可观察的改变

- 新建联系人后，`文档/Noema/Agents/` 下立即出现该成员的工作目录（`<名称>-<id 末 6 位>`），不必等首次派发任务。

## 手测步骤

1. 启动 Noema，在联系人列表新建一位联系人（例如「测试成员」）。
2. 打开 `~/Documents/Noema/Agents/`（Windows：`文档\Noema\Agents\`）。
3. 看到 `测试成员-xxxxxx` 目录已存在。

## 用户决策

无
