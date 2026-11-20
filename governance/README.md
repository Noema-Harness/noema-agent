# 治理

Authority: 会话状态机、任务与发现、门与规则包的唯一出处。
Update when: 状态机、门、规则包、数据模型或命令面变化。
Does not own: 命令的环境与失败修法（见被治理仓库的 OPERATIONS）、产品事实、正在做的事（那是 `governance/data/state.json`）。

治理记录的是**一轮工作本身**：会话记录要交付什么，状态决定此刻允许的产出，任务是清单，
发现是审查的输出，签收是收口。它不记录 agent 的工具调用和文件改动——那是 agent 应用在做的事。
门只挂在写盘边界上，规则随状态注入，`npm run state` 是唯一入口，治理台是它的只读视图。

## 三十秒

```text
npm run state                                         # 现在在做什么、下一步该敲什么
npm run state -- start "要交付什么"                    # 有了交付物才开会话，默认直接执行
npm run state -- scope "这次做什么"                    # 范围（小修加 --kind 修复）
npm run state -- tasks plan tasks.txt                  # 一次导入任务清单（文本格式见下）
npm run state -- task done T1 --evidence "怎么证明做完"
npm run state -- review log --scope 段 --phase 入口 --from findings.txt
npm run state -- finding task F1                       # 从发现派生一条修复任务
npm run state -- finding fix F1 --note "改在哪里"
npm run state -- review log --scope 总体 --from findings.txt
npm run state -- set 验收 --reason "任务与整体审查都齐了"
npm run state -- sign "用户签收原话"
npm run state -- close                                 # 归档会话，焦点清空
npm run work:view                                      # 重建治理台
```

这条路径由 `scripts/quickstart.test.mjs` 在空白状态上逐步跑通。每步都会打印「现在该做：…」；
不确定就 `npm run state -- next`。

任务清单是一段文本，agent 只写它，系统解析成结构：

```text
- [ ] 任务名
      标准：做完的标准
      证据：跑过的命令 / 文件名（可省）
  阶段：阶段名（可省）
```

## 六个对象

- **会话**是容器：一句话名字代表一件要交付的事。可以同时开多个、互不阻塞，焦点只是指针
  （`start` / `switch` / `close` / `sessions`）。没有在推进的交付物时焦点为空；聊天、查资料不进会话。
  归档只归档当前会话（`close` → `governance/data/history.json`）。
- **状态**是会话当前的段落，不是必走流程：讨论（对齐范围）、执行（默认起态）、验收（判断放行）。
  任意方向可切，只要求写理由；最小路径是 `start → 执行 → close`。
- **轮次**是讨论态每轮的落盘：一段摘要（这一轮怎么推到的、判断什么、为什么）+ 这一轮悬着的问题
  - 可选的一条完整方案（`--draft`）。它不存判决书，存推理路径；后来的 agent 靠它复原讨论，
    而不是靠自己的上下文。讨论线里未处置的问题汇总在 `waits`，收口时写成范围。
    `round --summary "…" [--wait "…"] [--draft "…"]`，一轮一条，缺摘要会被数据校验拦住。
- **任务**是执行的清单，每条都带「做完的标准」和证据。阶段是任务上的可选字段，不是另一层结构：
  默认平铺，阶段性任务的出现只是为了让验收能分段分配，不必等一大堆做完才审查。
- **发现**是审查的输出，带 scope（段 / 总体）与段号；处置为已修（要证据）、延期、接受（要理由）。
  发现可以派生一条修复任务，回到任务清单里继续走。
- **签收**是用户原话，条件是没有未处置的发现、任务全部完成。agent 不能代填。

| 状态 | 进入条件                    | 允许的产出                   | 离开时的义务                         |
| ---- | --------------------------- | ---------------------------- | ------------------------------------ |
| 讨论 | 无                          | 证据（调研、复现、设计稿）   | 定案（写范围）或搁置（写原因）       |
| 执行 | 无硬条件                    | 范围内的产品代码、测试、证据 | 交接（改了什么、证据、未验证、风险） |
| 验收 | 任务全完成 + 总体审查已记录 | 判定、发现处置、签收         | 通过 → 签收归档；不通过 → 回执行     |

审查触发两处：一个阶段的任务全部完成后审这一段；全部任务完成后、进验收前审整体。
只有一个阶段时，段审查与总体审查合并成一次。审查的任务书由系统从「范围 + 任务 + 标准」生成，
执行者改不掉，只能在末尾补一节「请特别检查」，由审查者决定采不采纳。

切换会写一条日志；约束只有各状态的产出边界。规则包在 `governance/noema/workflow/`，
由 `state` 按状态打印；包里的检查项写 `gate:<id>`，必须对应 `scripts/governance.mjs` 登记的门。

## 数据与界面

- 唯一数据源 `governance/data/state.json`，只经 `npm run state` 写：
  `{version, focus, sessions:[{id,title,status,state,scope,tasks,findings,reviews,sign,threads,log}], log}`。
  写入有文件锁、原子替换与 `.work/state-history/` 备份；手改会被数据校验拦住。
- 归档去向 `governance/data/history.json`，`close` 时追加一条只含结论的记录。
- 治理台：`npm run work:view` → `.work/review/work-view.html`，离线单文件、只读、可重建。
  顶部是会话标签（点一下切换）；主体左边是任务清单（按阶段分组，每条显示标准与证据），
  以及审查发现（带 scope 与处置）；右边是计数、「下一步 · 谁」一句人话，命令收在
  「agent 会执行什么」里；讨论态另起一段列出最近的轮次与待裁。
  页面不自己排优先级：下一步取自 `nextAction(doc)`；证据点一下行内展开，没有悬浮提示。
  `T` 切明暗（默认浅色、跟随系统偏好），`prefers-reduced-motion` 下关动画。

## 门

- **提交门**（`.githooks/pre-commit`，也是 `npm run check` 的第一步）：文档自洽、改动路径播报、
  产品行为必须落在当前会话的范围里。
- **里程碑门**（`npm run check`，CI 同源）：workspace / branches / docs / figure / source / lint / typecheck / 测试。
- **人判断**：预期是否变、签收、优先级——机器不判。

任务完成要写证据；验收判定要有证据；发现处置要么有修复任务的完成证据，要么有理由。
签收只认用户原话，占位（「你的原话」「可以收口」「…」「‹…›」）一律被拒绝。

## 命令

读：`npm run state`（摘要）、`-- next`、`-- brief`、`-- json`、`-- verify`、`-- sessions`、`-- work`、`-- log`、
`-- review brief|list`。
写：`-- start` / `switch` / `close`、`-- set`、`-- scope`、`-- tasks plan`、`-- task add|done`、
`-- review log`、`-- finding task|fix|defer|accept`、`-- sign`、`-- round`、`-- wait add|drop`、
`-- archive`、`-- resume`、`-- title`。
视图：`npm run work:view`。

## 边界：内核与适配

`governance/core/` 是通用层（状态机、校验、进度、下一步推荐），出现被治理项目的专名或仓库路径即报错；
`governance/noema/` 放适配（文档清单、路径、规则包）；`scripts/` 是这台机器上的入口。
换一个项目使用时替换适配层即可，内核不动。

治理图：[PNG](governance/assets/governance-map.png) / [交互版](governance/assets/governance-map.html)
（源文档是本文件与 AGENTS.md）。
