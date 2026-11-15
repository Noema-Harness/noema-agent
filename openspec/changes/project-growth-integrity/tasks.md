# 任务

## 1. 规格与设计

- [x] 1.1 在 `openspec/changes/project-growth-integrity/specs/specialist-agents/spec.md` 写复盘沉淀的规格增量
- [x] 1.2 `npm run plan:check` 通过

## 2. provider：工具调用文本与截断

- [x] 2.1 导出 `stripToolCallMarkup`，去掉正文里的工具调用痕迹
- [x] 2.2 带工具请求里，文本含 DSML 标记但没有完整调用时先做一次修正重试，仍失败则按可重试错误返回
- [x] 2.3 `finish_reason: length` 且没有 tool call 时返回可重试错误
- [x] 2.4 `test/main/providers/openai-compatible-client.test.mjs` 补四个用例（清洗、拒绝写文本、修正重试成功、截断拒绝）

## 3. 成长写入与注入

- [x] 3.1 `reply-status-writer.mjs` 只在 `completed` 时保存清洗后的简述
- [x] 3.2 `social-project-store.mjs` 的 `finishProjectGrowthMember` 允许 `no_change` 不带 brief
- [x] 3.3 `getPendingProjectGrowthBriefs` 只返回 `completed`
- [x] 3.4 复盘提示词要求真实工具调用、简述在调用之后且不超过 200 字

## 4. 迁移 43

- [x] 4.1 重建 `social_project_growth_members`：brief 仅 `completed` 必填
- [x] 4.2 清空历史 `no_change` 的 brief
- [x] 4.3 `SOCIAL_SCHEMA_VERSION` 升到 43
- [x] 4.4 迁移测试覆盖

## 5. 验证

- [x] 5.1 `npm run typecheck`
- [ ] 5.2 `npm run check` 全绿
- [ ] 5.3 在 #137 记录证据评论，并把评论链接写回本文件
