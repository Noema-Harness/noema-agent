# Tasks

本变更做设计与文档，外加维护机制本身的工具改动（`skip_specs: true`）：不改产品代码，不改变用户可见行为；产品实现另立变更，见 `design.md` 的「决定后的实现顺序」。

## 1. 决定

- [x] 决定 1（团队与项目的关系）：用户选择 B，取消独立团队对象，已写入 `docs/DECISIONS.md` D-019
- [ ] 决定 2（成长的证据门槛）：用户要求继续讨论，待定
- [x] 决定 3（维护门槛强度）：用户要求“硬但不便秘、硬在工程意识”，已收敛为「决定 3 的落地：维护门槛 v2」

## 2. 落文档

- [x] 把决定 1 写进 `docs/DECISIONS.md`（D-019，含替代方案与重新审视条件）
- [ ] 按决定 1 更新 `docs/ARCHITECTURE.md` 的组织对象/会话拓扑一节
- [x] 按决定 1 更新 `docs/PRODUCT.md` 的团队/项目可观察行为（能力清单不进 PRODUCT，见第 5 节）
- [ ] 按决定 2 更新成长相关文档
- [ ] 更新 `docs/STATUS.md` 的未交付与下一步，指向实现变更
- [ ] `npm run check` 通过并归档本变更

## 3. 维护门槛 v2

计划层与规格边界：

- [x] （已撤销，见第 5 节）曾把「V1 能力清单」放进 `docs/PRODUCT.md`；现改为只留在看板卡片
- [x] `plan:check` 只要求 proposal 写 `Plan:` 卡片链接（不校验能力编号）
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

## 4. 规划迁到看板

规划天生高频变化，放在低维护频率的文档里必然过期（0.7.4–0.7.6 零文档更新就是证据）。产品真值留在文档，排序与状态移到唯一一个 GitHub Project：

- [x] 组织 `Noema-Harness` 建 Project「Noema V1 路线」（Status + 阶段字段，卡片用 issue）
- [x] C1–C14 各建 `[C<n>]` 卡片加入看板，Done/Todo/In Progress 与当前认知一致
- [x] （后被第 5 节取代）曾把能力清单删状态列留在 PRODUCT
- [x] （后被第 5 节取代）`docs:check` 曾要求能力清单带看板链接
- [x] `AGENTS.md` 一轮循环改为「选卡 → 立项 → 纵切 → 证据 → 卡片 Done 并归档」，文档表登记看板所有权
- [x] `docs/DECISIONS.md` 记录 D-022（规划与状态迁到看板，撤销 Issue #130 的“不自造看板”）
- [x] Issue #130 改写为迁移说明并关闭
- [x] `npm run check` 全绿并提交（`a962785`）

## 5. 规划内容只留在看板（2026-11-15 纠正）

用户纠正：规划写进 `docs/PRODUCT.md` 等于给常驻文档增加高频维护项；规划结构变化时该改的是 GitHub，不是文档。规划只允许存在一处。

- [x] `docs/PRODUCT.md` 删除「V1 能力清单」；能力清单只存在于看板卡片正文
- [x] `docs:check` 增加反向校验：PRODUCT 出现能力清单即失败
- [x] `plan:check` 收窄为只校验 `Plan:` 卡片链接，删除能力编号校验
- [x] `AGENTS.md`、`docs/OPERATIONS.md` 同步（PRODUCT 不拥有能力清单；门槛表相应改写）
- [x] `docs/DECISIONS.md` 新增 D-023，并修正 D-020/D-022 中“计划层在 PRODUCT”的表述
- [x] 14 张卡片正文去掉“产品定义：docs/PRODUCT.md「V1 能力清单」”指针
- [x] `npm run check` 全绿并提交（873/873，`81d81b2`）
