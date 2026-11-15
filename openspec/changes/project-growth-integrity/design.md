# 项目成长写入可靠性：设计

## Context

成长批次的当前实现：

1. 项目完成时 `social-chat-service.mjs` 创建批次、由 `project-growth-batch-scheduler.mjs` 逐个成员开一个复盘回合（`isProjectGrowthTurn`、`projectGrowthBatchId`）。
2. 复盘回合的工具集只有 `manage_member_assets`（`project-tool-policy.mjs`）。
3. 回合结束后 `reply-status-writer.mjs` 查 `social_agent_asset_revisions` 是否有本回合写入：有则 `completed`，无则 `no_change`，两者都写 brief。
4. 常驻私聊下一次对话把 `completed` 和 `no_change` 的 brief 都注入提示词。

真实失败形态：模型没有发出 tool call，而是在正文末尾输出了 `<｜｜DSML｜｜ calls>` 文本（且被截断），于是"没有资产版本 + 有正文"被记成 `no_change`，截断文本进入注入队列。

## Goals

- 复盘回合的产物只有两种可信结果：写入了一条经历（`completed`），或明确无变更（`no_change`）。
- 任何"工具调用没真正发生"的回合都不产生经历，也不产生注入文本。
- 历史上被污染的 `no_change` 简报不再被注入。

## Non-Goals

- 不引入候选态、证据门槛、用户审阅界面（D-014 的成长审核队列，见 D-038）。
- 不改动成员资产路径、版本表结构、`manage_member_assets` 的参数。
- 不改看板 C6 的交付范围，本片只做写入可靠性。

## 取舍

### 判断"无变更"只能靠资产版本，不能靠正文

正文里出现"我已写入"这类自述不可信（真实数据里正是自述存在而资产为 0）。因此保留 `social_agent_asset_revisions` 作为唯一判据，并让无变更的回合不保存简述。

### 工具调用文本与截断在 provider 层处理

这类错误发生在模型输出解析层，业务层无法区分"模型只是写了段文字"和"模型想调用但调用丢了"。provider 已经维护 `parseDsmlToolCalls` 和一次修正重试（`buildToolCorrectionMessages`），把该重试扩展到"有工具、文本含 DSML 却没有完整调用"的情形，比在每处业务调用点加防御更可靠。

### 迁移里清空历史 no_change brief

历史 brief 已被工具标记污染，继续保留只会被注入；清空是唯一不会误导后续提示词的做法，且 `Git` 与真实库自带历史可追溯。

## Risks

- provider 重试会多花一次模型调用；只在出现不完整 DSML 或 `finish_reason: length` 时触发，且沿用现有的最多一次修正上限。
- 迁移重建表；本地真实库只有 1 行成员记录，测试库由 migration 测试覆盖。
- 简述去掉工具痕迹后可能变短，但"不超过 200 字"本来就是提示词要求，删掉调用文本不影响语义。

## 验证

- provider 单测：SSE 里出现不完整 DSML、或 `finish_reason: length` 且带工具请求时，返回可重试错误；完整 tool call 不受影响。
- 写入单测：`no_change` 不写 brief、不进注入队列；`completed` 的 brief 去掉工具痕迹并限长。
- 迁移测试：旧 `no_change` 行的 brief 被清空，`completed` 保留。
- 回归：`npm run check`。

## 待用户决定

