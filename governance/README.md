# 治理

Authority: 治理规则、状态机、门与流程的唯一出处；不写产品事实与命令细节。
Update when: 状态机、门、规则包或数据模型变化。
Does not own: 命令与失败修法（docs/OPERATIONS.md）、产品定义（docs/PRODUCT.md）、正在做什么（governance/data/state.json）。

治理不是一个文档，而是 agent 的三个状态和挂在状态上的门。规则随状态注入工具反馈；
`npm run state` 是唯一入口，工作台只是它的只读视图。

## 第一次使用（五分钟）

```text
npm run state                                            # 现在在哪、下一步该敲什么
npm run state -- round --conclusion "这一轮的结论"        # 讨论态：记一轮，要停就问用户
npm run state -- wait add --item "T1 要定什么"            # 需要用户拍板的事，先登记
npm run state -- scope "这次做什么"                       # 定案：写范围（小修加 --kind 修复）
npm run state -- set 执行 --reason "范围已定"             # 进入执行
npm run state -- phase add --name "验收单元名"
npm run state -- phase start --id P1
npm run state -- task add --phase P1 --text "任务"
npm run state -- task done --id P1-T1 --evidence "怎么证明做完"
npm run state -- accept add --phase P1 --layer D --text "确定性验收项"
npm run state -- accept add --phase P1 --layer H --text "人签收项"
npm run state -- accept set --id P1-A1 --status 通过 --evidence "证据"
npm run state -- accept human --id P1-A2 --text "用户原话"  # H 层只能这样判
npm run state -- phase done --id P1
npm run state -- set 验收 --reason "验收项全绿"             # 全部单元完成后再进
npm run state -- sign "用户签收原话"
npm run state -- clean                                   # 归档并回到讨论，工作区清空
npm run work:view                                        # 随时重建工作台
```

这段 16 步在空白状态上由 `scripts/quickstart.test.mjs` 逐步跑通（`npm run tools:test` 会验证），
所以文档里的命令可以直接照着敲。

每步都会打印「现在该做：…」；不确定就 `npm run state -- next`。

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
- 工作台：`npm run work:view` → `.work/review/work-view.html`，只读、可重建、只讲一件事：
  - 一个焦点：当前验收单元的编号与名字，下方一条按完成度推进的细线；再往下是唯一亮元素——
    「下一步」命令，点一下复制。
  - 一条骨架：验收单元是纵向时间线，当前单元菱点脉冲，已完成为绿点；点节点展开/收起，
    地址栏 `#P3` 可深链；`J`/`K` 或方向键在节点间移动。
  - 验收层只靠形状区分（▢ D · ○ C · ◇ R · △ H），颜色表示状态，不写图例；证据在行内悬浮出现。
  - 明暗切换（`T`），`prefers-reduced-motion` 下关闭动画。不进库、不进事实流。
- 验收四层：**D** 确定性检查（命令/测试）、**C** 判据对照、**R** 审查发现（必须逐条处置）、**H** 人签收。
  通过 = D+C+H 全绿 + R 全部处置。H 只由用户原话判定：阶段的 H 项用 `state -- accept human --id … --text "用户原话"`，
  agent 用自己的判断填会被拒绝；整条范围的签收用 `state -- sign "…"`，签收只认原话。

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
