# Design: 连续时间线与检查点

## Context

当前 `social_messages` 是房间级追加日志，`turn_id` 只用于把同一回合的用户/助手消息分组。`createConversationBoundary` 插入一条 system 边界消息，`listConversationThreads` 按边界分组，`rewindConversationToMessage` 直接删除 `seq >= target.seq` 的消息。这个实现把“切换上下文”和“删除历史”绑定在一起，无法支持编辑后保留原分支，也无法在崩溃后安全恢复。

Phase 1 先建立数据库与读取模型，不改变旧 UI 的默认行为。所有新表 additive；通过 `NOEMA_CONTINUITY_MODE=off|shadow|on` 控制：

- `off`：完全旧行为，新表不写。
- `shadow`：旧读取不变，新回合同时写检查点，用于校验。
- `on`：读取/编辑走分支模型，旧 `rewind` 禁用。

默认先 `shadow`，完成迁移和回放校验后切 `on`。

## Goals

- 每个 Agent（主聊或项目 Agent）一条常驻时间线。
- 每个完成回合一个不可变检查点。
- 编辑 = 从目标回合派生分支并重发，不删除旧消息。
- 分支读取严格隔离，不自动合并。
- 旧 thread/boundary 可迁移、可回看、可继续，消息不丢失。
- 崩溃后已提交回合可见，未完成回合可重试且不重复用户消息。

## Non-goals

- 不在 Phase 1 做跨设备同步、多人协作或自动分支合并。
- 不重写现有 `social_messages` 表，不迁移消息正文到新表。
- 不改变项目任务/工作区协议；项目 Agent 只使用自己的 room/branch。
- 不实现完整记忆沉淀；那是 Phase 3。

## Data Model

新增表（schema version 37）：

```sql
CREATE TABLE conversation_branches (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES social_rooms(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES social_agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  parent_branch_id TEXT REFERENCES conversation_branches(id) ON DELETE SET NULL,
  forked_from_turn_id TEXT,
  head_turn_id TEXT,
  head_version INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL CHECK (origin IN ('main','fork','legacy')),
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES conversation_branches(id) ON DELETE CASCADE,
  parent_turn_id TEXT REFERENCES conversation_turns(id) ON DELETE SET NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','complete','interrupted','failed')),
  checkpoint_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (branch_id, ordinal)
);

CREATE TABLE conversation_active_branch (
  room_id TEXT PRIMARY KEY REFERENCES social_rooms(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES conversation_branches(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);
```

`conversation_turns` 是检查点元数据，不复制消息正文。一个回合的用户/助手消息仍由 `social_messages.turn_id` 关联；祖先链通过 `parent_turn_id` 跨分支读取。`head_turn_id` 指向当前分支最后一个已提交回合，`head_version` 用于 CAS。

关键不变量：

- `status='complete'` 的 turn 必须有 `checkpoint_at` 和 `assistant_message_id`；`pending/interrupted/failed` 不得有 `checkpoint_at`，也不进入可继续上下文。
- `head_turn_id` 为空时，分支只能从 `forked_from_turn_id` 派生。
- `parent_turn_id` 必须属于同一 branch 或祖先 branch；禁止跨 room。
- `branch.read_only=1` 时禁止追加 turn，除非先派生新分支。
- `social_messages` 一轮的两条消息必须同 room、同 turn；已有数据校验失败时迁移中止并记录。

## Write Path

1. 用户发送：开启 SQLite `IMMEDIATE` 事务，写入用户消息（`status='complete'`），创建 `conversation_turns(status='pending')`；事务提交后该回合可见但不可继续，`checkpoint_at` 为空。
2. 助手完成后：同一写连接事务更新助手消息为 `complete`、写 turn `status='complete'`、`checkpoint_at=now`、`assistant_message_id`，CAS 更新 branch head 与 `head_version`。
3. 失败/中断：助手消息 `failed/interrupted`，turn 保持未提交；不会成为可继续检查点。
4. 重试：复用同一 user message 和 turn，`attempt+1`，不新增 user 行；成功后提交同一 turn 检查点。
5. 编辑：从目标 user message 之前的已完成 turn（或 branch fork 点）创建新 branch，`parent_branch_id`、`forked_from_turn_id` 指向该检查点；写入新 user message/turn；旧分支不变。

CAS 失败时重新读取 branch head；若 head 已变化，返回冲突并要求重新确认，不静默覆盖。

## Read Path

`getContinuityContext(roomId, branchId, limits)`：

1. 从 `conversation_active_branch` 取当前 branch（或指定 branch）。
2. 沿 `parent_turn_id` 回溯到根，得到祖先 turn 链；不读取 siblings。
3. 按时间线顺序取消息，过滤 system boundary marker。
4. 只把 `status='complete'` 且 `checkpoint_at` 非空的 turn 放入可继续上下文；未完成回合作为中断提示。
5. 预算/截断沿用现有 context 参数；Phase 2 再交给 ContextCompiler。

`shadow` 模式仍调用旧 `getContext`；新读取用于后台校验（比较消息集合、顺序、是否缺少祖先）。

## Legacy Migration

在 schema 37 事务中：

1. 为每个 room 创建 `origin='main'` 分支；如果已有边界，按边界分组创建 `origin='legacy'` 分支。
2. 扫描 `social_messages`，按 `turn_id` 聚合；每个 turn 生成 `conversation_turns`，`ordinal` 按 seq 顺序；user/assistant 配对校验。
3. 每个旧 thread 的最后一个完整 turn 设为其 head；`read_only=1`。
4. 最新 thread 的 head 设为 room 的 active branch（shadow/on 初始化）。
5. 不删除 boundary 消息；新读取过滤它们。
6. 迁移失败整体回滚，保留旧 schema 可回退。

重复执行：以 `conversation_active_branch`/`conversation_turns` 已存在为幂等标记；不重复插入，不覆盖已存在 turn。

## UI / API

API（IPC/preload/contracts）：

- `continuityGetState(roomId)` → `{ mode, activeBranch, branches }`
- `continuityListBranches(roomId)`
- `continuityCreateBranch({ roomId, fromTurnId, title })`
- `continuitySwitchBranch({ roomId, branchId, expectedVersion })`
- `continuityEditMessage({ roomId, messageId, content })`（on 模式）
- 旧 `rewindConversationToMessage` 在 on 模式返回 `continuity_branch_required`，不删除。

UI（默认切换阶段）：

- 顶部显示当前分支名/“从某轮继续”；分支菜单替代“新对话/历史”主入口。
- 编辑确认改为“这会从该轮创建新分支并重发，原分支保留”。
- 旧 legacy 分支标记“旧记录 · 只读”，继续时派生新分支。
- 删除/归档分支不进入 Phase 1；先只读保留。

## Crash Recovery

启动时扫描 `assistant status='streaming'`：

- 若对应 turn 已 complete：修复消息状态，不重复提交。
- 若未 complete：助手消息置 `interrupted`，turn 保持未提交；保留 user 消息；提示可重试。
- 不自动删除任何分支或消息。

## Rollout

1. schema 37 + backfill。
2. shadow 写路径 + 后台一致性检查。
3. on 读路径用于内部测试房间。
4. on 默认切换；旧 `rewind` 只返回错误。
5. 保留 `off` 回退至少一个版本。

## Testing

- 迁移：消息/顺序/分支数量与旧数据一致；重复执行幂等；失败回滚。
- 分支：A/B 隔离；祖先链正确；编辑不删除旧消息；CAS 冲突。
- 上下文：sibling 不进入 prompt；system marker 不进入消息。
- 崩溃：streaming 恢复、重试不重复 user、已完成 checkpoint 不重写。
- shadow：新旧读取的消息集合差异可报告，不改变用户结果。
- 性能：1000 turn/分支回溯 < 100ms（本地基准，目标值待测）。

## Risks

- 旧 boundary 数据可能没有完整 turn 配对；需要迁移前诊断并允许跳过异常 thread。
- branch head CAS 与现有单写连接需要严格事务；否则 shadow 下可能双写不一致。
- 旧 UI 删除“新对话/历史”前必须保留回退入口；Phase 1 默认仍可 off。
- 分支数量长期增长需要 GC/归档策略，Phase 1 不删除。
