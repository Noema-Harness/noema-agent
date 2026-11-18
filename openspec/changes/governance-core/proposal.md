Plan: none

## 为什么

用户验收 `D-20261118-decision-dialog-flow` 时指出两处机制偏差（m108565），我核查时又发现一处：

1. `AGENTS.md` 的阶段地图写的是「你该先读什么」并直接指向 `workflow/*.md`——这是文档驱动，和 E21 定的「阶段注入 = 工具反馈」相矛盾；机制（`npm run stage`）存在，但入口文本把 agent 引回读文件。
2. `governance/core/` 只有一份 README，内核实现落在了 `scripts/`（`decision-kernel.mjs`/`decision.mjs`/`stage.mjs`/`transition.mjs`），E17 定的「core = 领域内核、noema = 适配、scripts = 薄壳」名存实亡。
3. 验收规则包写「不过退回执行中并写原因」，但 `decision advance` 只允许向前一步，待验收 → 执行中会被拒，「验收不过」这条路工具里不存在（这次验收正好撞上）。

## 改什么

- AGENTS 阶段地图改为「进入方式 + 产物」：进入阶段只写 `npm run stage -- <phase>`，删除读文件指引；`governance/` 的路径不再作为 agent 的阅读清单。
- 注入点补齐：`decision` / `transition` 失败信息带「先跑 stage」与对应阶段；`precommit` 输出当前活动条目与阶段（每次提交自然注入一次）。
- 内核落位：条目模型、状态机、规则包校验、过渡文档结构校验迁到 `governance/core/*.mjs`（无 Noema 路径常量）；`scripts/*.mjs` 只留路径、命令名、npm 门与 CLI 接线。
- 退回路径：允许 `待验收 → 执行中`，必填 `--reason`（写进条目），同步规则包与 `scripts/lifecycle.mjs`。
- 边界检查：`docs-check` 扫描 `governance/core/*.mjs`，出现 `noema`/`apps/desktop`/`docs/`/`.work/` 直接报错。

## 影响

只改治理工具与治理文档，不改产品行为。`scripts/decision-kernel.mjs` 迁走后由 `governance/core/entries.mjs` 替代；`kernel.test.mjs` 迁到 `governance/core/`。

## 不在本批

- 治理框架的独立概念与通用化（等这次修完再讨论）。
- DSH harness hook 注入（属于适配层，批次三之后）。