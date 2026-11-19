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

## 边界：什么走治理，什么自由执行

治理只覆盖「会改变别人预期」的事；其余自由做，过提交门即可。

| 区域 | 判据 | 例子 | 需要的动作 |
|---|---|---|---|
| 自由执行 | 改完**决定、产品可观察行为、对外承诺、数据与发布物都没变** | 读代码与调查、`.work/` 里的实验、修 bug（行为与决定一致）、重构、补测试、文案错字、内部脚本优化（不加新门/命令）、性能调整 | 直接做；产品代码仍走提交门；规模大时开一个 fix change（Plan 引用原条目），**不回决策、不写设计稿、不写开工清单** |
| 治理区 | 以下任一变了 | 已定决定（E 文本、目标、范围、期望行为）、产品定位或对外承诺、不可逆迁移、条目写入（只走命令）、阶段/批次/验收项/历史、新增或删除门/规则/命令、发布与签名 | 走对应阶段的规则包与门；决定变了回决策重开，实现偏差留在执行内修 |

一句话判据：**问「改完之后，我的预期有没有变？」** 变了→治理区；没变→自由执行。

### 机器管到哪、人管到哪

边界不靠自觉：能机检的部分在提交时自动说清楚，判不了的部分只留给人。

| 改动 | 机器怎么判（`precommit` 提示） | 机器要求 |
|---|---|---|
| 只有测试、文档、`.work`、非产品文件 | 「自由执行路径」 | 无额外要求，过四道提交门即可 |
| 产品行为（`apps/desktop/src/`） | 「行为路径」 | 必须有活动变更与规格增量；计划先于代码 |
| 条目数据（`governance/data/`、`docs/DECISIONS.md`） | 写盘印记 + 渲染比对 | 只能经 `npm run governance -- record\|move` 写入 |
| 用户预期/承诺/定位/不可逆 | **机器判不了** | 只能由人判断：这正是条目决议存在的意义 |

所以「什么时候走治理」的落地答案一直是三句话：机器能检查的产品行为必须有变更与规格；条目只能经命令改；其余改动自由，但改完要自己回答「用户的预期变了没有」，变了就先进条目不写代码。

边界模糊时按「最省力过门」判断：如果走治理只是填一张表，就不该走；如果它确实能拦住一次已经发生过的错误，就走。

## 三阶段规则包

讨论、执行、验收各一份，进入该阶段时用 `npm run stage -- <阶段>` 打印（批次二实现；当前可直接打开文件）：

| 阶段 | 规则包 | 进入时最先做什么 |
|---|---|---|
| 讨论 | `noema/workflow/discussion.md` | 只产出证据与条目，不落地 |
| 执行 | `noema/workflow/execution.md` | 三道门槛过了才动手；主体是 `openspec/changes/` |
| 验收 | `noema/workflow/acceptance.md` | 生成验收页；只有用户能收口 |

过渡文档模板在 `noema/workflow/transition/`：设计方案、条目收口、开工清单、执行交接、验收报告。

## 存储与视图

- **数据是唯一真相**：`governance/data/decisions.json`（`{version, preamble, entries[]}`；每条含 id/标题/阶段/字段/三段正文）。命令只读写数据文件，markdown 不接收写入。
- **markdown 是渲染产物**：`docs/DECISIONS.md` 每次由数据重渲染；`docs:check` 会比对「文件 vs 渲染」，不一致即报错（提示 `npm run decisions:render`）。
- **视图是只读视图**：`npm run decisions:view` 生成 `.work/review/decisions-view.html`（两块：待裁决、讨论经过），两侧都不进库。
- **迁移是一次性的**：`node scripts/migrate-decisions.mjs` 把旧 markdown 解析成数据并规范化空白；判据是幂等 + 逐条内容深相等。

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
| `npm run decisions:sync` | 标题阶段标记与勾选收口同步（读写数据文件） | 已有 |
| `npm run decisions:render` | 从数据重渲染 `docs/DECISIONS.md` | 已有 |
| `npm run decisions:view` | 生成只读视图 `.work/review/decisions-view.html` | 已有 |
| `npm run docs:check`、`figure:check`、`plan:check`、`milestone:check` | 单独跑某道产物门 | 已有 |
| `npm run check` | 里程碑全量门 | 已有 |
| `npm run governance -- record\|move\|check\|audit` | 治理三动词：record 五合一、move 进阶段/退回修复/恢复、check 三类自检 + 净额、audit 计数 | 已有 |
| `npm run stage -- <阶段>` | 打印阶段规则包 + 当前条目 + 恢复卡 | 已有（`governance -- check stage` 的别名） |
| `npm run transition -- <kind>` | 打印过渡文档骨架并就地更新 `.work/review/` | 已有（`governance -- check transition` 的别名） |
| `npm run decision -- round\|settle\|advance\|wait` | 条目结构化操作（行为门） | 已有（`record`/`move` 的别名） |

## 当前落地状态

- 批次一 `governance-authority`：目录、索引、规则包、迁移（本文件所在批次）。核验：`docs:check`、`figure:check`、`npm run check`。
- 批次二 `governance-kernel`：条目内核、`decision` 行为门、`stage`/`transition` 命令、两个新门规则（观察期）。核验：`npm run kernel:test`、`npm run tools:test`、`npm run check`。
- 批次三 `governance-interface`：`record`/`move`/`check` 三动词、写盘印记与恢复、批次续接、净零审计、过渡文档唯一性。核验：`npm run governance -- check net`。
- 批次四 `governance-conformance`：边界（治理区 vs 自由执行）、受控偏差修复边、开工清单门、批次两行、验收项按 E 覆盖。核验：`governance/core/kernel.test.mjs`、`npm run acceptance -- --entry <D-…>`。
- 批次五 `governance-store`：条目数据文件 `governance/data/decisions.json` + 渲染产物 + 只读视图；命令只写数据。核验：`node scripts/migrate-decisions.mjs --check`、`npm run docs:check`、`npm run kernel:test`。
- 挂起：试点 P1（`D-20261117-agent-memory` 等记忆决议）与批次六 `governance-extraction`（内核可复用与抽离评估）。

## 维护

- 治理规则改了只改这里；模板改了只改 `noema/workflow/`；命令与失败修法写在 `docs/OPERATIONS.md` 并指回这里。
- 改完跑 `npm run docs:check`；治理图见 [PNG](governance/assets/noema-governance.png) / [交互版](governance/assets/noema-governance.html)，图源与图门规则见 `governance/assets/noema-governance.source.json` 与 `docs/OPERATIONS.md`。