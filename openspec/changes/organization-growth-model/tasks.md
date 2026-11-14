# Tasks

本变更做设计与文档，外加维护机制本身的工具改动（`skip_specs: true`）：不改产品代码，不改变用户可见行为；产品实现另立变更，见 `design.md` 的「决定后的实现顺序」。

## 1. 决定

- [x] 决定 1（团队与项目的关系）：用户选择 B，取消独立团队对象，已写入 `docs/DECISIONS.md` D-019
- [ ] 决定 2（成长的证据门槛）：用户要求继续讨论，待定
- [x] 决定 3（维护门槛强度）：用户要求“硬但不便秘、硬在工程意识”，已收敛为「决定 3 的落地：维护门槛 v2」

## 2. 落文档

- [x] 把决定 1 写进 `docs/DECISIONS.md`（D-019，含替代方案与重新审视条件）
- [ ] 按决定 1 更新 `docs/ARCHITECTURE.md` 的组织对象/会话拓扑一节
- [x] 按决定 1 更新 `docs/PRODUCT.md` 的团队/项目可观察行为，并新增「V1 能力清单」
- [ ] 按决定 2 更新成长相关文档
- [ ] 更新 `docs/STATUS.md` 的未交付与下一步，指向实现变更
- [ ] `npm run check` 通过并归档本变更

## 3. 维护门槛 v2

计划层与规格边界：

- [x] `docs/PRODUCT.md` 增加「V1 能力清单」，能力变更在归档时更新状态
- [x] `plan:check` 要求 proposal 写「推进的能力」并校验 C 编号存在
- [x] `precommit` 要求含 `apps/desktop/src/` 的提交带 specs 增量；`skip_specs` 只允许纯文档/治理变更

决策与验收：

- [x] 待用户决定五类判据写进 `AGENTS.md`，`plan:check` 限制每轮最多 3 项
- [x] 未答决策只阻塞产品代码，工具与文档改动放行（`checkPrecommit` 按路径判断）
- [x] 用户验收项格式 `- [ ] [用户] <场景> → 证据`；勾选必须带 `（用户确认：YYYY-MM-DD）`
- [x] `npm run milestone:check`：任务全勾、用户确认、无待决、有规格增量、STATUS 当天

记录与测试：

- [x] `docs/OPERATIONS.md` 写清四道门槛的命令、报错与修法
- [x] `docs/DECISIONS.md` 记录 D-020（维护门槛 v2）与判据、边界
- [x] `scripts/maintenance.test.mjs` 覆盖新增规则（能力清单、能力引用、待决上限、用户验收格式、里程碑、按范围阻塞、skip_specs）
- [x] `npm run docs:check`、`npm run plan:check`、`npm run maintenance:test` 通过
- [ ] `npm run check` 全绿
- [ ] [用户] 复核维护门槛 v2：确认四道门槛的阻塞边界、待决上限与里程碑定义可用（看 `AGENTS.md` 第 2 节与 `docs/OPERATIONS.md`「维护门槛」）
