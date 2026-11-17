# 任务

- [x] 1.1 `AGENTS.md` §1 写入讨论/开工边界、计划模式、授权来源与用户原话（验证：读 §1）
- [x] 1.2 `skills/noema-development/SKILL.md` 新增「0 讨论、开工、执行」与决定行模板（验证：`npm run skill:install` 两行 OK）
- [x] 2.1 `scripts/maintenance.mjs` 决策层门接受 `用户原话：「…」，日期`，拒绝短引用（验证：`node --test scripts/maintenance.test.mjs` 25/25）
- [x] 2.2 `scripts/workspace.mjs` + `workspace.config.json` 增加保留期与 keep，输出 MB（验证：`node --test scripts/workspace.test.mjs` 1/1）
- [x] 3.1 `docs/OPERATIONS.md` 新增「过程材料（.work/）」小节与计划模式说明（验证：`npm run docs:check`）
- [x] 3.2 清理 `.work` 超期材料并记录回收量（验证：`npm run workspace:clean -- --apply` 输出）
- [x] 4.1 `npm run check` 全绿（验证：输出 903/903 与 `governance: milestone OK`）
- [x] 4.2 更新卡片正文：无卡片（`Plan: none` 治理变更）
- [ ] 4.3 用户读 §1 与技能第 0 节确认边界后收口归档