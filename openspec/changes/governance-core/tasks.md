## 1. 内核落位

- [ ] 1.1 新建 `governance/core/entries.mjs`（从 `scripts/decision-kernel.mjs` 迁入条目模型与轮次/已定操作，去掉阶段标记到生命周期模块）
- [ ] 1.2 新建 `governance/core/lifecycle.mjs`（阶段、阶段标记、前进/退回/重开的合法转移）
- [ ] 1.3 新建 `governance/core/packs.mjs`（规则包 gate 提取与校验、恢复卡文本装配）
- [ ] 1.4 新建 `governance/core/transitions.mjs`（模板节、占位符、待确认项检查、骨架文本）
- [ ] 1.5 `scripts/decision-kernel.mjs` 删除；`scripts/{decision,stage,transition}.mjs` 改为只做路径、IO、命令接线
- [ ] 1.6 `governance/core/README.md` 补模块清单与各自职责

## 2. 退回路径

- [ ] 2.1 `governance/core/lifecycle.mjs` 增加 `待验收 → 执行中` 退回转移
- [ ] 2.2 `scripts/decision.mjs` 支持 `--reason`，退回时写进条目；缺 `--reason` 拒绝
- [ ] 2.3 `scripts/lifecycle.mjs` 与验收规则包同步退回命令与语义
- [ ] 2.4 单测覆盖：退回成功、缺原因拒绝、退回记录进条目

## 3. 注入点与阶段地图

- [ ] 3.1 `AGENTS.md` 阶段地图改为「进入方式 + 产物」，删除读文件指引
- [ ] 3.2 `decision`/`transition` 失败信息带「先跑 `npm run stage -- <phase>`」
- [ ] 3.3 `precommit` 输出当前活动条目与阶段
- [ ] 3.4 讨论/执行/验收规则包补退回命令（如适用）

## 4. 边界检查

- [ ] 4.1 `scripts/maintenance.mjs` 增加 `governance/core/*.mjs` 边界检查（禁 `noema`/`apps/desktop`/`docs/`/`.work/`）
- [ ] 4.2 单测：core 文件出现禁用词报错；干净文件通过

## 5. 验证与收口

- [ ] 5.1 `npm run kernel:test`、`npm run tools:test`、`npm run docs:check`、`npm run figure:check`
- [ ] 5.2 `npm run check` 全绿
- [ ] 5.3 条目补 E24–E26，并把 `D-20261118-decision-dialog-flow` 退回 `执行中`
- [ ] 5.4 更新 `docs/STATUS.md`（最后更新日期与本次验证条）
- [ ] 5.5 `npm run milestone:check`、归档 change、推送；更新看板卡片正文