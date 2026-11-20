# 治理

Authority: 会话状态机、段与验收、门与规则包的唯一出处。
Update when: 状态机、门、规则包、数据模型或命令面变化。
Does not own: 命令的环境与失败修法（见被治理仓库的 OPERATIONS）、产品事实、正在做的事（那是 `governance/data/state.json`）。

治理不是文档，而是 agent 正在做的事：**会话**记录要交付什么，**状态**决定此刻允许的产出，
**段**记录推进过程，门只挂在写盘边界上。规则随状态注入，`npm run state` 是唯一入口，
工作台是它的只读视图。

## 三十秒

```text
npm run state                                        # 现在在推进什么、下一步该敲什么
npm run state -- start "要交付什么"                   # 有了交付物才开会话，默认直接执行
npm run state -- scope "这次做什么"                   # 范围（小修加 --kind 修复）
npm run state -- task add --text "做什么"
npm run state -- task done --id P1-T1 --evidence "怎么证明做完"
npm run state -- segment add --name "这一段交付什么"   # 大事才拆段
npm run state -- accept add --layer H --text "人签收项"
npm run state -- accept human --id P2-A2 --text "用户原话"   # H 只能由用户原话判定
npm run state -- segment done --id P2
npm run state -- set 验收 --reason "命名段都完成了"
npm run state -- sign "用户签收原话"
npm run state -- close                               # 归档会话，焦点清空
npm run work:view                                    # 重建工作台
```

这条路径由 `scripts/quickstart.test.mjs` 在空白状态上逐步跑通，所以可以照着敲。
每步都会打印「现在该做：…」；不确定就 `npm run state -- next`。

## 三个对象

- **会话**是容器：一句话名字代表一件要交付的事。可以同时开多个、互不阻塞，焦点只是指针
  （`start` / `switch` / `close` / `sessions`）。没有在推进的交付物时焦点为空；聊天、查资料不进会话。
  会话之间不共享进度，归档只归档当前会话（`close` → `governance/data/history.json`）。
- **状态**是会话当前的段落，不是必走流程：讨论（对齐范围）、执行（默认起态）、验收（判断放行）。
  任意方向可切，只要求写理由；最小路径是 `start → 执行 → close`。
- **段**是会话内部的时间分片：日常琐事在当前段平铺加任务；大事来了收掉当前段、开命名段。
  只有命名段才拆 2–5 个验收单元、才要求 D/C/R/H；日常段只要任务完成即可收尾。

| 状态 | 进入条件       | 允许的产出                           | 离开时的义务                         |
| ---- | -------------- | ------------------------------------ | ------------------------------------ |
| 讨论 | 无             | 证据（调研、复现、设计稿）与会话记录 | 定案（写范围）或搁置（写原因）       |
| 执行 | 无硬条件       | 范围内的产品代码、测试、证据         | 交接（改了什么、证据、未验证、风险） |
| 验收 | 命名段都已完成 | 判定、发现处置、签收                 | 通过 → 签收归档；不通过 → 回执行     |

切换会写一条日志；约束只有各状态的产出边界。规则包在 `governance/noema/workflow/`，
由 `state` 按状态打印；包里的检查项写 `gate:<id>`，必须对应 `scripts/governance.mjs` 登记的门。

## 数据与界面

- 唯一数据源 `governance/data/state.json`，只经 `npm run state` 写：
  `{version, focus, sessions:[{id,title,status,state,scope,segments,threads,log}], log}`。
  写入有文件锁、原子替换与 `.work/state-history/` 备份；手改会被数据校验拦住。
- 归档去向 `governance/data/history.json`，`close` 时追加一条。
- 治理台：`npm run work:view` → `.work/review/work-view.html`，离线单文件、只读、可重建。
  左半是此刻的状态（大字、会话名与范围、四个数、一条随状态变化的脉搏线）；右半是段的账本，
  当前段摊开、其它段折叠；底条是唯一一条「下一步」命令（点击复制）与最近的切换记录。
  验收层只用形状表示：▢ 确定性 · ○ 可复核 · ◇ 审查发现 · △ 人签收，证据悬停出现。
  明暗切换按 `T`（跟随系统偏好），`prefers-reduced-motion` 下关动画。

## 门

- **提交门**（`.githooks/pre-commit`，也是 `npm run check` 的第一步）：文档自洽、改动路径播报、
  产品行为必须落在当前会话的范围里。
- **里程碑门**（`npm run check`，CI 同源）：workspace / branches / docs / figure / source / lint / typecheck / 测试。
- **人判断**：预期是否变、签收、优先级——机器不判。

验收四层：D 确定性检查（命令/测试）、C 判据对照、R 审查发现（必须逐条处置）、H 人签收。
通过 = D+C+H 全绿 + R 全部处置。H 只认用户原话，agent 代填会被拒绝。

## 命令

读：`npm run state`（摘要）、`-- next`、`-- brief`、`-- json`、`-- verify`、`-- sessions`、`-- work`、`-- log`。
写：`-- start` / `switch` / `close`、`-- set`、`-- scope`、`-- segment add|start|done|list`、
`-- task add|done`、`-- accept add|set|text|human|resolve`、`-- sign`、`-- round`、`-- wait add|drop`、
`-- archive`、`-- resume`、`-- title`。
视图：`npm run work:view`。

## 边界：内核与适配

`governance/core/` 是通用层（状态机、校验、进度、下一步推荐），出现被治理项目的专名或仓库路径即报错；
`governance/noema/` 放适配（文档清单、路径、规则包）；`scripts/` 是这台机器上的入口。
换一个项目使用时替换适配层即可，内核不动。

治理图：[PNG](governance/assets/governance-map.png) / [交互版](governance/assets/governance-map.html)
（源文档是本文件与 AGENTS.md）。