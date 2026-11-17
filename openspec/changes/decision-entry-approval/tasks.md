# Tasks

- [ ] 1.1 `scripts/decision-entry.mjs`：`draft` 只写 `.work/decisions-draft/<id>.md` 并打印确认问题，不碰 `docs/DECISIONS.md`
- [ ] 1.2 `scripts/decision-entry.mjs`：`accept` 要求 `--approval`（≥10 字），把原话与日期写进「来源」，校验通过后才落库，失败回滚并保留草稿
- [ ] 1.3 `scripts/decision-entry.test.mjs`：草稿不落库 / 缺原话拒绝 / 原话过短拒绝 / 合法落库带原话 / 结构不合法拒绝（验证：`npm run decision-entry:test` 全绿）
- [ ] 2.1 `package.json` 增加 `decision:draft`、`decision:accept`，新测试挂进 `tools:test`（验证：`npm run tools:test` 全绿）
- [ ] 2.2 `AGENTS.md` 与 `skills/noema-development/SKILL.md`：新建条目前先申请、起草用 draft、批准后 accept（验证：读文件）
- [ ] 2.3 `docs/OPERATIONS.md` 写命令与失败修法；`docs/DECISIONS.md` 头部补「新建条目前先申请」（验证：`npm run docs:check`）
- [ ] 3.1 全量验证 `npm run check`（验证：901 以上全绿、governance milestone OK）
- [ ] 3.2 治理图判断：`AGENTS.md` 改动使「怎么推进一件工作」章节漂移，判断结构未变后用 `--sections-changed` 记录（验证：`npm run figure:check` OK）
- [ ] 4.1 更新 `docs/STATUS.md` 最后一次验证与本轮机制（验证：`最后更新：` 为当天）
- [ ] 4.2 归档 change 并提交推送（验证：`milestone:check` OK、CI 通过）