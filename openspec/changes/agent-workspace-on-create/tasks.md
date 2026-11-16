# tasks

- [x] `SocialAgentService.createAgent` 从快照 `members` 取新成员并调用 `ensureAgentWorkspace`（`5942085`）
- [x] 测试：新建联系人后 `ensureAgentWorkspace` 收到正确的 `agentId` 与 `name`（`social-agent-service.test.mjs` 新增用例）
- [x] 规格增量：specialist-agents 新增「新建成员即准备默认工作目录」
- [ ] 用户验收：新建联系人后工作目录立即存在
- [ ] [用户] 新建一位联系人，检查 `文档/Noema/Agents/` 下出现 `<名称>-<id 末 6 位>` 目录 → 截图或目录列表
- [ ] 收口：更新卡片正文（#141）并归档本变更
