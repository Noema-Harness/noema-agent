# 治理

Authority: 治理规则、状态机、门与流程的唯一出处；不写产品事实与命令细节。
Update when: 状态机、门、规则包或数据模型变化。
Does not own: 命令与失败修法（docs/OPERATIONS.md）、产品定义（docs/PRODUCT.md）、正在做什么（governance/data/state.json）。

治理不是一个文档，而是 agent 的会话、挂在会话上的状态、以及状态边界上的门。
规则随状态注入工具反馈；`npm run state` 是唯一入口，工作台只是它的只读视图。

## 第一次使用

```text
npm run state                                        # 现在在推进什么、下一步该敲什么
npm run state -- start "要交付什么"                   # 出现交付物才开会话；默认直接执行
npm run state -- scope "这次做什么"                   # 范围（小修加 --kind 修复）
npm run state -- task add --text "做什么"             # 日常琐事：平铺加任务
npm run state -- task done --id P1-T1 --evidence "怎么证明做完"
npm run state -- segment add --name "这一段交付什么"   # 大事才拆段
npm run state -- segment start --id P2
npm run state -- accept add --layer D --text "确定性验收项"
npm run state -- accept add --layer H --text "人签收项"
npm run state -- accept set --id P2-A1 --status 通过 --evidence "证据"
npm run state -- accept human --id P2-A2 --text "用户原话"   # H 层只能这样判
npm run state -- segment done --id P2
npm run state -- set 验收 --reason "命名段都完成了"
npm run state -- sign "用户签收原话"
npm run state -- close                               # 归档会话，焦点清空
npm run work:view                                    # 随时重建工作台
```

这段流程在空白状态上由 `scripts/quickstart.test.mjs` 逐步跑通（`npm run tools:test` 会验证），
所以文档里的命令可以直接照着敲。每步都会打印「现在该做：…」；不确定就 `npm run state -- next`。

## 会话、状态与段

- **会话**是容器：名字一句话，代表一件要交付的事。可以同时开多个，互不阻塞，焦点只是指针
  （`start` / `switch` / `close` / `sessions`）。没有在推进的交付物时，焦点为空，聊天不进会话。
- **状态**是会话当前的段落，不是必走流程：讨论（对齐范围）、执行（默认起态）、验收（判断放行），
  任意方向可切，只要求写理由。最小路径是 `start → 执行 → close`。
- **段**是会话内部的时间分片：日常琐事在当前段平铺加任务；大事来了就收掉当前段、开命名段。
  只有命名段才拆 2–5 个验收单元、才要求 D/C/R/H；日常段只要任务完成即可收尾。

| 状态 | 进入条件             | 允许的产出                           | 离开时的义务                       |
| ---- | -------------------- | ------------------------------------ | ---------------------------------- |
| 讨论 | 无                   | 证据（调研、复现、设计稿）与会话记录 | 定案（写范围）或搁置（写原因）     |
| 执行 | 无硬条件                 | 范围内的产品代码、测试、证据         | 交接（改了什么、证据、未验证、风险） |
| 验收 | 命名段都已完成         | 判定、发现处置、签收                 | 通过 → 签收归档；不通过 → 回执行    |

- 切换写日志：`状态：<from> → <to>（日期，原因，义务）`；约束只有各状态的产出边界。
- 规则包：`governance/noema/workflow/{discussion,execution,acceptance}.md`，由 `state` 按状态打印；
  检查项写 `gate:<id>`，必须对应 `scripts/governance.mjs` 里登记的门。
- 门分三层：
  - **提交门**（`.githooks/pre-commit`，`npm run check` 里的第一步）：文档自洽、改动路径播报、
    产品代码必须落在当前会话的范围里。
  - **里程碑门**（`npm run check`，CI 同源）：workspace / branches / docs / figure / source / lint / typecheck / 测试。
  - **人判断**：用户预期是否变、签收、优先级——机器不判。

## 数据与工作台

- 唯一数据源：`governance/data/state.json`
  （`{version:4, focus, sessions:[{id,title,status,state,scope,segments,threads,log}], log}`），只经 `npm run state` 写；
  手改会被 `docs:check` 与 `work:view` 的数据校验拦住；写入有文件锁、原子替换与 `.work/state-history/` 备份。
- `governance/data/history.json`：归档会话的去向，`close` 时追加一条（含范围、签收与否、段的摘要）。
- 工作台是一张**会话桌面**：`npm run work:view` → `.work/review/work-view.html`，只读、可重建：
  1. 顶部大字：当前会话在哪个状态，下面一句话是会话名与范围。
  2. 左侧段轨：这个会话的所有段；当前段亮起，点一段切换右边的内容。
  3. 中间：当前段的任务（未完成在前，已完成折起来，悬停看证据）；命名段才有 D/C/R/H 四列滑片
     （▢ D · ○ C · ◇ R · △ H，形状颜色表示状态，H 未判标「等你」，R 未处置标「未处置」）。
  4. 底部签收线：数出还差几项与第一处缺口；全部过关时变成「这一段可以放行」。
  5. 底部固定「下一步」命令，点击复制。
  - 明暗切换（`T`），`prefers-reduced-motion` 下关闭动画。不进库、不进事实流。
- 验收四层：**D** 确定性检查（命令/测试）、**C** 判据对照、**R** 审查发现（必须逐条处置）、**H** 人签收。
  通过 = D+C+H 全绿 + R 全部处置。H 只由用户原话判定：段的 H 项用 `state -- accept human --id … --text "用户原话"`，
  agent 用自己的判断填会被拒绝；整条范围的签收用 `state -- sign "…"`，签收只认原话。

## 事实所有权

| 事实                               | 主人                         |
| ---------------------------------- | ---------------------------- |
| 产品定位、可观察行为、验收口径     | `docs/PRODUCT.md`            |
| 结构与数据地图                     | `docs/ARCHITECTURE.md`       |
| 命令、环境、失败修法、发布         | `docs/OPERATIONS.md`         |
| 今天能用到哪、未验证什么           | `docs/STATUS.md`             |
| 治理规则、状态机、门与流程         | `governance/`                |
| 正在推进什么、会话、范围、段、任务 | `governance/data/state.json` |

一个事实一个主人：别处只放指针。内核（`governance/core/`）是通用层，出现 Noema 专名或仓库路径即 `docs:check` 报错；
项目相关的东西放 `governance/noema/` 与 `scripts/`。

## 命令

- `npm run state`：当前会话、下一步、最近切换、当前状态规则包。
- `npm run state -- start|switch|sessions|close|set|scope|segment|task|accept|sign|round|wait|archive|resume|log|title`。
- `npm run state -- next|brief|json|verify`：下一步命令、交接卡、JSON、校验。
- `npm run work:view`：重建工作台。
- `npm run check`：里程碑全量（提交门 + 全部检查与测试）。

## 查看当下

治理图：[PNG](governance/assets/noema-governance.png) / [交互版](governance/assets/noema-governance.html)（由本文件与 AGENTS.md 作为源文档重出）。