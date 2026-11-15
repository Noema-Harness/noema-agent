# Tasks

本变更做设计与文档，外加维护机制本身的工具改动（`skip_specs: true`）：不改产品代码，不改变用户可见行为；产品实现另立变更，见 `design.md` 的「决定后的实现顺序」。

## 1. 决定

- [x] 决定 1（团队与项目的关系）：用户选择 B，取消独立团队对象，已写入 `docs/DECISIONS.md` D-019
- [x] 决定 2（成长的证据门槛）：本变更不解决；用户要求先弄清个体组成，移到看板 C6 #137 的独立变更
- [x] 决定 3（维护门槛强度）：用户要求“硬但不便秘、硬在工程意识”，已收敛为「决定 3 的落地：维护门槛 v2」

## 2. 落文档

- [x] 把决定 1 写进 `docs/DECISIONS.md`（D-019，含替代方案与重新审视条件）
- [x] 按决定 1 更新 `docs/ARCHITECTURE.md` 的组织对象/会话拓扑一节（见第 5 节）
- [x] 按决定 1 更新 `docs/PRODUCT.md` 的团队/项目可观察行为（能力清单不进 PRODUCT，见第 5 节）
- [x] 按决定 2 更新成长相关文档：决定 2 移交成长变更，本变更不再写成长文档
- [x] 更新 `docs/STATUS.md` 的未交付；「下一步」按 D-026 从 STATUS 移除，计划归看板与本轮变更
- [x] `npm run check` 通过并归档本变更

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
- [x] `npm run check` 全绿
- [x] 维护门槛 v2 的用户复核：移交本轮治理变更作为用户验收项（用户 2026-11-15 已就门槛边界给出反馈）

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
- [x] 删除 `docs:check` 里“PRODUCT 出现能力清单即失败”的关键字规则：边界由每份文档头的 `Does not own` 与评审承担，脚本只校验机械事实（用户 2026-11-15 指出穷举是笨办法，根因是文档边界）
- [x] `docs/ARCHITECTURE.md` 组织对象对齐 D-019：去掉“团队=长期能力器官/团队负责人/目标结构不是现状”这类计划性表述，只写当前结构与不变量

## 6. 治理清理与用户向架构图（2026-11-15）

三个项目级技能长期没有作用于开发，且引用的文档早已删除；`skills:check` 只比对镜像，不检查内容引用，等于空转。README 也没有任何图，用户看不到产品怎么工作。

- [x] 删除 `.codex/skills`、`.dsh` 镜像、`scripts/sync-skills.mjs` 及其测试与 `skills:sync`/`skills:check` 脚本
- [x] `npm run check` 去掉 skills:check；`AGENTS.md`/`docs/OPERATIONS.md`/`docs/STATUS.md` 同步为“项目不自建技能，用户级技能在 DSH 侧维护”
- [x] 看板 14 张卡片改为统一模板并按证据重标状态（Done 5 / In Progress 6 / Todo 3）
- [x] 用 Archify 产出只画 Noema 自身范围的用户向架构图：`docs/assets/noema-architecture.html` + `.png`（candidate 与过程材料留在 `.archify/`）
- [x] README 增加「它怎么工作」图与一句话说明，链接交互版
- [x] `npm run check` 全绿并提交（873/873，27,908ms）

## 7. 安装包构建修复（2026-11-15，用户点名工程问题）

0.7.4–0.7.6 连续三代只交付便携目录，被当作“环境限制”记在 STATUS 里。定位到三个独立工程缺陷：受限令牌下 `%TEMP%` 不可写、electron-winstaller 自带 NuGet 2.8 打包 `app.asar` 抛 `ObjectDisposedException`、Squirrel 自建 `SquirrelTemp` 与锁文件不可写。全部在构建脚本里固定，不要求操作者先关应用。

- [x] `apps/desktop/vendor/squirrel/nuget.exe`（NuGet 6.11.1）+ 说明，替换 electron-winstaller 自带的 2.8
- [x] `apps/desktop/scripts/make.mjs`：固定 `TEMP`/`TMP`/`TMPDIR`、`SQUIRREL_TEMP`，铺 vendor 目录并导出 `NOEMA_SQUIRREL_VENDOR`
- [x] `apps/desktop/forge.config.mts` 的 `MakerSquirrel` 接收 `vendorDirectory`；`apps/desktop/package.json` 的 `make` 改为走脚本
- [x] `out/` 被外部句柄锁住时自动落到 `.tmp/forge-out` 重建，`npm run make:desktop` 仍成功
- [x] 产出并核对 0.7.6 安装包（Setup/nupkg/RELEASES 大小与 sha256 见 `docs/STATUS.md`）
- [x] 载荷验证：受限令牌下把 `TEMP`/`SQUIRREL_TEMP` 指到工作区运行 `Setup.exe --silent`，`app-0.7.6` 的 `Noema.exe` 版本 0.7.6、`app.asar` 49,477,041 字节与构建一致
- [x] `docs/OPERATIONS.md` 打包节、`docs/STATUS.md`、`docs/DECISIONS.md`（D-024）同步；看板 C12 贴证据
- [x] 真实 `%LOCALAPPDATA%` 安装/跨版本升级演练：按 D-025 采用未签名发布 + 放行说明；演练移交 C12 #143 的发布变更
- [x] 真实安装的用户验收：移交 C12 #143 的发布变更作为用户验收项（D-025 采用未签名发布）

## 8. CI 与文档门（2026-11-15）

- [x] GitHub Actions 的 `npm run check` 通过：`docs:check` 在 CI 下不再要求本地 `core.hooksPath`（改为提示），workflow checkout 改为 `fetch-depth: 0` 以便校验 STATUS 基线是 HEAD 祖先
- [x] `scripts/maintenance.test.mjs` 覆盖 CI 模式（无钩子时少一条错误、不出现 `core.hooksPath` 报错）；测试显式传 `{ ci: false }`，避免 CI 环境变量改变本地断言
