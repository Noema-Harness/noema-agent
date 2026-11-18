# Tasks

- [ ] 1.1 建 `governance/README.md`：三层结构、四道门、三阶段规则包、条目生命周期、命令与当前落地状态（验证：人工走一遍无断链）
- [ ] 1.2 建 `governance/core/README.md`：内核契约（条目模型与状态机、待裁/已定/轮次操作、门契约、规则包契约、恢复卡）；不出现 Noema 专名
- [ ] 1.3 建 `governance/noema/README.md`：适配说明（docs 路径、卡片、命令、CI 接线）
- [ ] 1.4 建 `governance/noema/workflow/{discussion,execution,acceptance}.md` 与 `transition/{design,closeout,kickoff,handoff,report}.md` 模板（验证：内容对齐设计方案 M1/M7/M8/M6）
- [ ] 2.1 迁 `AGENTS.md` 流程段到 `governance/noema/workflow/`（验证：`AGENTS.md:9-13` 只剩指针）
- [ ] 2.2 迁 `docs/OPERATIONS.md` 的「维护门槛」「审核入口与决议条目」「协作与 PR 检查」到 `governance/`，命令与失败修法留在 OPERATIONS（验证：grep 无治理正文）
- [ ] 2.3 迁 `docs/STATUS.md` 的「治理分层」「协作文档门禁」「图的维护」「外部收件箱桥」到 `governance/`（验证：STATUS 只剩今天能用到哪、未验证什么）
- [ ] 2.4 技能的治理规则改为指针：`skills/noema-development/SKILL.md`、`skills/noema-governance/SKILL.md` 只留入口与命令（验证：`npm run skill:install` + `docs:check`）
- [ ] 2.5 治理图迁移到 `governance/assets/`，同步 `scripts/figure.mjs` 的 `FIGURES` 路径（验证：`npm run figure:check`，漂移用 `--sections-changed` 记录判断）
- [ ] 3.1 `AGENTS.md` 缩成阶段地图 + 边界 + 指针，≤45 行（验证：行数 + 人工读）
- [ ] 3.2 `docs/DECISIONS.md` 头部与 `CONTRIBUTING.md` 的治理指向同步到 `governance/`（验证：`docs:check`）
- [ ] 4.1 `scripts/maintenance.mjs` 的 `checkDocuments` 增加治理词检测：`docs/` 新出现治理词只提示（notice），不阻断（验证：单测）
- [ ] 4.2 新增 notice 检查的测试（验证：`node --test scripts/maintenance.test.mjs`）
- [ ] 5.1 `npm run docs:check` / `npm run figure:check` / `npm run check` 全绿（验证：日志）
- [ ] 5.2 grep 走查 `docs/PRODUCT.md`、`docs/ARCHITECTURE.md` 无治理内容（验证：命令输出）
- [ ] 5.3 `docs/STATUS.md` 更新最后验证与本批机制（验证：`最后更新：2026-11-18`）
- [ ] 5.4 更新卡片/语境并提交推送、归档本 change（验证：`milestone:check` OK、CI 绿）
