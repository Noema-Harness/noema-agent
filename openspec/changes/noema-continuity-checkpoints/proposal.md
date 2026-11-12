# Proposal: 连续时间线与检查点

## Why

当前主聊用“新对话 / 历史”切分上下文，编辑消息会在原线程上删除后续消息并重发。这个模型能防止上下文串线，但会丢失分支历史，也无法表达“从某一轮继续”的正常用法；用户已经明确要求把会话收敛为一条常驻时间线，用检查点和分支代替删除式 rewind。

同时，现有 `conversation_boundaries` 与 `rewindConversationToMessage` 是两套临时保护：前者插入系统消息做边界，后者直接删除 `social_messages`。在分支、崩溃恢复和旧数据迁移同时存在时，这种破坏式写入无法安全扩展。

## What Changes

- 新增 `conversation-continuity` 能力：每个用户 Agent（Noema）和每个项目 Agent 各有一条常驻时间线；主界面的“新对话 / 历史”入口不再作为主要模型。
- 新增不可变 `turn` 检查点：每个完成的回合持久化所属分支、父回合、用户消息、助手消息和提交时间。
- 编辑用户消息改为“从目标回合创建子分支 + 重发”，原分支和后续消息保留；不再删除任何消息。
- 分支有显式 head 和 CAS 版本；切换分支只改变读取/继续位置，不合并内容。
- 旧 thread/boundary 在迁移时映射为 legacy 分支，消息不丢失；旧分支先只读，用户主动继续时从末回合派生新分支。
- 增加 feature flag：先 `off/shadow` 双读验证，再切默认；`off` 保留 0.6.9 行为作为回滚。

## Capabilities

### New Capabilities

- `conversation-continuity`: 单条常驻时间线、不可变检查点、显式分支与旧会话迁移。

### Modified Capabilities

无。现有 `social-conversations` 的消息、草稿、搜索和转发行为保持不变；Phase 1 只新增连续线能力。

## Impact

- `apps/desktop/src/main/chat/migrations.mjs`：新增 schema 版本与表。
- `apps/desktop/src/main/chat/social-chat-store.mjs`：新增分支/检查点 API，保留旧方法作为回退。
- `apps/desktop/src/main/chat/social-chat-service.mjs`：回合提交和编辑入口改用分支 API（shadow 后切换）。
- `apps/desktop/src/main/ipc/root-ipc.mjs`、preload、`noema-bridge.d.ts`：分支列表/切换/派生接口。
- renderer：分支切换与“从这条消息继续”；移除主界面的新旧对话语义（在默认切换阶段）。
- 测试：schema 迁移、分支隔离、旧数据回填、CAS、崩溃恢复。
