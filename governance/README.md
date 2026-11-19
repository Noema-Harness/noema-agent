# 治理

Authority: 治理规则、状态机、门与流程的唯一出处；不写产品事实与命令细节。
Update when: 状态机、门、规则包或数据模型变化。
Does not own: 命令与失败修法（docs/OPERATIONS.md）、产品定义（docs/PRODUCT.md）、正在做什么（governance/data/state.json）。

治理不是一个文档，而是 agent 的三个状态和挂在状态上的门。规则随状态注入工具反馈；
`npm run state` 是唯一入口，工作台只是它的只读视图。

## 状态与门

状态只描述「现在在做什么」，不携带授权；授权来自用户的请求与范围。

| 状态 | 进入条件           | 允许的产出                           | 离开时的义务                                             | 收口目标 |
| ---- | ------------------ | ------------------------------------ | -------------------------------------------------------- | -------- |
| 讨论 | 无                 | 证据（调研、复现、设计稿）与会话记录 | 定案（写范围）或搁置（写原因）                           | 范围     |
| 执行 | 已有范围           | 范围内的产品代码、测试、证据         | 交接（改了什么、证据、未验证、风险）                     | 验收     |
| 验收 | 所有验收单元已声明 | 判定、发现处置、签收                 | 通过 → 回讨论/收口；不通过 → 回执行；预期有问题 → 回讨论 | 用户签收 |

- 切换写日志：`状态：<from> → <to>（日期，原因，义务）`；任意方向可切，约束只有各状态的产出边界。
- 讨论会话是一等对象：不挂条目；定案或搁置即归档，回讨论自动恢复并续编号。
- 规则包：`governance/noema/workflow/{discussion,execution,acceptance}.md`，由 `state` 按状态打印；
  检查项写 `gate:<id>`，必须对应 `scripts/governance.mjs` 里登记的门。
- 门分三层：
  - **提交门**（`.githooks/pre-commit`，`npm run check` 里的第一步）：文档自洽、改动路径播报、内核边界。
  - **里程碑门**（`npm run check`，CI 同源）：workspace / branches / docs / figure / source / lint / typecheck / 测试。
  - **人判断**：用户预期是否变、签收、优先级——机器不判。

## 数据与工作台

- 唯一数据源：`governance/data/state.json`（`{version:3, current, work, threads, log}`），只经 `npm run state` 写；
  手改会被 `docs:check` 与 `work:view` 的数据校验拦住；写入有文件锁、原子替换与 `.work/state-history/` 备份。
- `work`：`scope`（范围）+ `phases`（2–5 个验收单元，含任务与 D/C/R/H 验收项）。
- 工作台：`npm run work:view` → `.work/review/work-view.html`，只读、可重建、按状态收束版面：
  顶部给「现在该做」（可直接复制命令），中间是阶段时间线（点一下跳转并展开该阶段），
  只展开当前阶段、其余折叠，验收层 D/C/R/H 用一行图例说明；支持明暗切换（快捷键 T）、
  点击阶段/悬停行有反馈、`prefers-reduced-motion` 下关闭动画。不进库、不进事实流。
- 验收四层：**D** 确定性检查（命令/测试）、**C** 判据对照、**R** 审查发现（必须逐条处置）、**H** 人签收。
  通过 = D+C+H 全绿 + R 全部处置；只有用户能签收，签收只认原话。

## 事实所有权

| 事实                               | 主人                         |
| ---------------------------------- | ---------------------------- |
| 产品定位、可观察行为、验收口径     | `docs/PRODUCT.md`            |
| 结构与数据地图                     | `docs/ARCHITECTURE.md`       |
| 命令、环境、失败修法、发布         | `docs/OPERATIONS.md`         |
| 今天能用到哪、未验证什么           | `docs/STATUS.md`             |
| 治理规则、状态机、门与流程         | `governance/`                |
| 正在做什么、范围、单元、任务、会话 | `governance/data/state.json` |

一个事实一个主人：别处只放指针。内核（`governance/core/`）是通用层，出现 Noema 专名或仓库路径即 `docs:check` 报错；
项目相关的东西放 `governance/noema/` 与 `scripts/`。

## 命令

- `npm run state`：状态、会话、待裁、当前状态规则包。
- `npm run state -- set|scope|phase|task|accept|sign|round|wait|archive|resume|log|work`。
- `npm run state -- next|brief|json|verify|clean`：下一步命令、交接卡、JSON、校验、归档已签收的工作。
- `npm run work:view`：重建工作台。
- `npm run check`：里程碑全量（提交门 + 全部检查与测试）。

## 查看当下

治理图：[PNG](governance/assets/noema-governance.png) / [交互版](governance/assets/noema-governance.html)（由本文件与 AGENTS.md 作为源文档重出）。
