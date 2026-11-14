# Proposal

## Why

0.7.4–0.7.6 三个版本是在没有活动计划、没有规格增量的情况下发布的：仓库同时挂着 11 个 OpenSpec 变更，`openspec/specs` 里没有任何一条 requirement 描述团队提案、岗位模板、成员资产或项目成长。把维护门槛接入后，下一个阶段的计划不能继续这样空着。

这一阶段要解决的是两个被用户直接指出的方向性问题，它们属于“没想清楚就实现”的典型：

- 团队不是独立对象，而是项目的副产物。`apps/desktop/src/main/projects/social-project-store.mjs:1004-1020` 在创建项目时用 `team-${projectId}` 作为团队 ID、直接把项目标题当团队标题写入 `social_teams`；schema 42 的迁移（`apps/desktop/src/main/chat/migrations.mjs:1269-1289`）也是从旧项目一对一回填团队。结果是团队与项目同名、同生命周期、同层级，用户看到的是两个几乎一样的入口。
- 成长没有证据门槛。项目完成后由模型在复盘回合往 `social_agent_asset_revisions`（`apps/desktop/src/main/chat/agent-asset-store.mjs`）写资产文件，写入后下一轮直接注入提示词；没有候选状态、没有跨项目证据、没有评估或影子运行，D-014 要求的“经历 → 候选 → 证据/评估 → 版本化后启用”没有落实。用户对这条的质疑是“让 agent 给自己总结一条反思就算成长了？”。
- 团队规模没有下限：`social-project-store.mjs:981` 只要求至少一位专业成员，一个成员加 Noema 就能建团队并立项。

这些不是靠再写一个功能能修好的，必须先把对象关系与证据规则定清楚，再改代码。

## What Changes

- 把三项未定设计（团队与项目关系、成长证据门槛、维护门槛强度）连同选项与代价列清楚，交由用户决定后写进 `docs/DECISIONS.md`。
- 按决定更新 `docs/ARCHITECTURE.md` 的组织对象一节与 `docs/PRODUCT.md` 的团队/项目可观察行为，并在 `docs/STATUS.md` 记录下一阶段顺序。
- 本变更只做设计与文档：`skip_specs: true`，不改代码、不改 `openspec/specs`。确定实现后按实现范围另立变更并写规格增量，保证同一时间只有一个活的变更。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。本阶段不改可观察行为，因此没有规格增量；实现阶段会补 `project-collaboration`（团队与项目对象关系）和 `specialist-agents`（成长状态与来源）的 delta。

## Impact

- 本阶段只改文档：`docs/DECISIONS.md`（新增决定）、`docs/ARCHITECTURE.md`（组织对象）、`docs/PRODUCT.md`（团队/项目/成长的可观察行为）、`docs/STATUS.md`（下一步）。
- 决定之后的影响面（留给实现变更）：`apps/desktop/src/main/projects/social-project-store.mjs`、`apps/desktop/src/main/chat/migrations.mjs`（schema 42 的 `social_teams`/`social_team_members`、`social_projects.team_id`）、`apps/desktop/src/main/chat/agent-asset-store.mjs`、`project-growth-batch-scheduler.mjs`、`model-tools.mjs`、IPC/preload/`noema-bridge.d.ts`，以及 Projects/Teams/Members 视图。
- 迁移与兼容：无论选哪种团队模型，已有项目、团队、成员记录都必须保持可读；不删除用户数据，不恢复已废弃的任务卡或旧 social UI。
- 不改：对话历史模型（D-018 的 SQLite 不可变快照）、DSH 执行内核、六模块（属于后续阶段）。
