Plan: https://github.com/Noema-Harness/noema-agent/issues/137

# 项目成长写入可靠性

## Why

真实库里已经有一个完整的反例：2026-11-14 的成长批次 `408915db-fe46-4a4e-8a20-24e29d51caeb`（项目 `project-25cf7724-bfa7-4618-a007-26974fc4dd14`）中，成员复盘回合把 `manage_member_assets` 的调用写成了 `<｜｜DSML｜｜ calls>` 文本，没有任何 tool call，资产版本 0 行；而这段被截断的 1803 字符文本仍被存成 brief，并被注入该成员的常驻私聊，当作"项目经历"。

链路证据：

- `apps/desktop/src/main/chat/reply-status-writer.mjs`：只用"本回合有没有资产版本"判断 `completed`/`no_change`，两种状态都把 assistant 全文写成 `brief`。
- `apps/desktop/src/main/projects/social-project-store.mjs` 的 `getPendingProjectGrowthBriefs`：`status IN ('completed','no_change')` 都会进入注入队列。
- `apps/desktop/src/main/providers/openai-compatible-client.mjs`：只有在 tool call 完整解析时才算执行过工具；文本里出现不完整 DSML 标记时，回复按普通文本完成保存。
- `openspec/specs/` 里没有任何条目描述"项目结束后的成员复盘写什么、失败怎么算"。

## What Changes

- 复盘回合只有真正产生资产版本时才保存简述；没有变更时不保存简述，也不再进入常驻私聊注入队列。
- 保存前先去掉工具调用痕迹并限长；含不完整工具调用文本、或输出被截断的回合判为可重试失败，不再算"无变更"。
- provider 层在带工具请求里发现"模型把工具调用写成文本"或"输出被截断"时给出可重试错误，不静默存成完成回复。
- 复盘提示词要求真实工具调用，简述写在调用之后且不超过 200 字。
- 迁移 43：`social_project_growth_members.brief` 只对 `completed` 必填，历史 `no_change` 的 brief 清空。

## Impact

- 规格：`specialist-agents` 新增需求「项目结束后的成员复盘只沉淀有证据的经历」。
- 代码：`apps/desktop/src/main/providers/openai-compatible-client.mjs`、`apps/desktop/src/main/chat/reply-status-writer.mjs`、`apps/desktop/src/main/projects/social-project-store.mjs`、`apps/desktop/src/main/chat/project-growth-batch-scheduler.mjs`、`apps/desktop/src/main/chat/migrations.mjs`、`apps/desktop/src/main/chat/social-chat-schema.mjs`。
- 数据：`social_project_growth_members` 的 brief 约束随迁移 43 变化，旧 `no_change` 行清空 brief。
- 不做：候选态与用户审阅队列（D-014 的完整成长审核），留给下一片，见 D-038。
