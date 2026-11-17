## 1. 机制

- [x] 1.1 `source.json` 记录 `source.sections`（图依赖章节摘要）与 `source.candidateSha256`（candidate 内容摘要）
- [x] 1.2 `figure:check` 报章节漂移、candidate 与记录不一致、缺少这两种摘要
- [x] 1.3 `figure:build` 在“章节变了但 candidate 未变”时拒绝，`--sections-changed "<理由>"` 可显式记录判断，理由与章节状态绑定
- [x] 1.4 `scripts/figure.test.mjs` 覆盖章节切分、漂移判定、理由覆盖与失效、candidate 手改

## 2. 图内容

- [x] 2.1 架构图：bridge 传输、执行后端可换、本机文件与命令、当前只发布 Windows、伴侣客户端、任务用词统一
- [x] 2.2 治理图：提示层区域、事实流区域、机器门区域三块标注可见
- [x] 2.3 两张图重出并通过 Archify finalize 的四道 gate

## 3. 文档

- [x] 3.1 `docs/OPERATIONS.md` 更新图维护说明与章节漂移 / candidate 手改的修法
- [x] 3.2 更新卡片正文（现在能做什么 + 手测步骤 / 还没做）——本次为 `Plan: none` 的治理工具改动，卡片无需改；在提交信息与本变更里记明

## 4. 验证与收口

- [x] 4.1 `npm run figure:check`、`npm run docs:check`、`node scripts/figure.test.mjs` 通过
- [x] 4.2 `npm run check` 全绿
- [x] 4.3 用只改 `docs/ARCHITECTURE.md` 的测试 PR 验证 PR 软放行与日志提示，然后关闭 PR
- [ ] 4.4 请用户过目两张图并确认三条待验收决议（`governance-layers` / `lifecycle-table` / `gate-ownership`）
