# 治理

治理内容的唯一权威入口。产品事实不在这里：定位、架构、命令、状态仍在 `docs/` 与 `AGENTS.md`。

## 三层结构

| 位置 | 拥有什么 | 不拥有什么 |
|---|---|---|
| `governance/core/` | 领域内核契约：条目模型与状态机、待裁/已定/轮次操作、门契约、规则包契约、恢复卡、审计 | 任何具体项目的路径、命令、文档名 |
| `governance/noema/` | 适配层：本仓库的文档路径、看板、命令、CI 接线、阶段规则包与过渡模板 | 内核语义（它只消费契约） |
| `governance/README.md` | 单一索引：三层、门、规则包、生命周期、命令、文件职责 | 规则正文（正文在各文件里） |

治理只在这里写。`AGENTS.md` 是系统层，只能挂载治理指针；`docs/DECISIONS.md` 是治理核心基础（条目格式与记录），生命周期与门的实现归 `governance/core`。

## 四道门

| 门 | 谁执行 | 查什么 | 规则登记 |
|---|---|---|---|
| 决策门槛 | 人 | 只有五类问题进待用户决定；未答决策只阻塞产品代码与 specs；用户验收必须带日期 | 规则，无脚本 |
| 行为门 | 治理命令写盘前 | accept 原话≥10 字+日期、advance 合法转移+原话、round 带待裁变化行、例外格式完整 | 批次二实现在 `scripts/` |
| 产物门 | 本地提交 / CI / 里程碑 | 计划先于代码、`docs:check`、`figure:check`、`milestone:check` | `scripts/governance.mjs` 的 `RULES`（详见 `noema/reference/gates.md`） |
| 平台状态门 | 远端 | `platform`：至多一个活动变更、main 无未收口 change；`collaboration`：PR 治理字段 | `.github/workflows/` |

新门一律先 notice（观察期），两个里程碑没有误伤才转 block。新增门前先写「最省力过门方式」——如果那是打卡或造假，就不加。

## 三阶段规则包

讨论、执行、验收各一份，进入该阶段时用 `npm run stage -- <阶段>` 打印（批次二实现；当前可直接打开文件）：

| 阶段 | 规则包 | 进入时最先做什么 |
|---|---|---|
| 讨论 | `noema/workflow/discussion.md` | 只产出证据与条目，不落地 |
| 执行 | `noema/workflow/execution.md` | 三道门槛过了才动手；主体是 `openspec/changes/` |
| 验收 | `noema/workflow/acceptance.md` | 生成验收页；只有用户能收口 |

过渡文档模板在 `noema/workflow/transition/`：设计方案、条目收口、开工清单、执行交接、验收报告。

## 条目生命周期

四态：`决策中 → 执行中 → 待验收 → 已收口`；任一阶段可退回决策中并写原因。

| 阶段 | 允许写什么 | 出口 |
|---|---|---|
| 决策中 | 只写决策层（要定/待裁/已定/轮次） | 设计方案获批 + 条目收口重构 + 开工清单获批 |
| 执行中 | 执行层只写批次指针与影响决定的发现 | 切片全绿或明确阻塞 + 执行交接 |
| 待验收 | 验收层可勾选清单 | 用户验收确认（原话与日期） |
| 已收口 | 只追加遗留项去向 | 归档 change |

条目结构细节见 `core/README.md`；本仓库的路径与门接线见 `noema/README.md`。

## 命令

| 命令 | 用途 | 落地 |
|---|---|---|
| `npm run review` | 只读汇总：待你决定 / 待你验收 / 执行中 | 已有 |
| `npm run decision:draft` / `decision:accept` | 条目起草与落库（原话准入） | 已有 |
| `npm run decisions:sync` | 标题阶段标记与勾选收口同步 | 已有 |
| `npm run docs:check`、`figure:check`、`plan:check`、`milestone:check` | 单独跑某道产物门 | 已有 |
| `npm run check` | 里程碑全量门 | 已有 |
| `npm run stage -- <阶段>` | 打印阶段规则包 + 当前条目 + 恢复卡 | 批次二 |
| `npm run transition -- <kind>` | 打印过渡文档骨架并写入 `.work/review/` | 批次二 |
| `npm run decision round/settle/advance` | 条目结构化操作（行为门） | 批次二 |

## 当前落地状态

- 批次一 `governance-authority`：目录、索引、规则包、迁移（本文件所在批次）。核验：`docs:check`、`figure:check`、`npm run check`。
- 批次二 `governance-kernel`：条目 CLI、`stage`/`transition` 命令、notice 门接线。
- 试点 P1：`D-20261117-agent-memory` 按新流程走一轮，出试点报告。
- 批次三 `governance-extraction`：内核可复用与抽离评估。

## 维护

- 治理规则改了只改这里；模板改了只改 `noema/workflow/`；命令与失败修法写在 `docs/OPERATIONS.md` 并指回这里。
- 改完跑 `npm run docs:check`；治理图见 [PNG](governance/assets/noema-governance.png) / [交互版](governance/assets/noema-governance.html)，图源与图门规则见 `governance/assets/noema-governance.source.json` 与 `docs/OPERATIONS.md`。