# Tasks

## 1. 建立当前行为基线

- [x] 1.1 写入聊天连续性规格；以搜索、续接、转发和附件自动化场景核对每项要求。
- [x] 1.2 写入专业成员规格；以成员创建、资料修改、能力切换、归档恢复与委派 E2E 核对要求。
- [x] 1.3 写入项目协作规格；以计划证据、成员项目会话、评审与归档恢复测试核对要求。

## 2. 固定资料权威边界

- [x] 2.1 更新 OpenSpec 配置与 `docs/PROJECT_OPERATIONS.md`，明确 specs、changes、archive、路线图、架构和流程图各自的权威范围；检查文档链接。
- [x] 2.2 更新根 README 的“当前行为规格”入口；确认 README、AGENTS、CONTRIBUTING 的读者和加载边界无重复歧义。

## 3. 防止规格目录再次空置

- [x] 3.1 在 `.codex/workspace.json` 声明 OpenSpec 基线目录；更新 `workspace:check`，在没有任何 `spec.md` 时失败，并为该边界补工具测试。
- [x] 3.2 运行 `openspec validate baseline-implemented-capabilities --strict --no-interactive`、`npm run workspace:check` 和 `npm run workspace:test`，修复所有失败。

## Workflow follow-up

- 用 OpenSpec archive 将已核对的差异应用到当前 specs；随后确认 `openspec list --specs --json` 能枚举三项基线，活动 change 已清空。
