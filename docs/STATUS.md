# STATUS

Authority: 本文档只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理规则、状态机与门（见 [governance/README.md](../governance/README.md)）；正在做什么（`npm run state`）。

最后更新：2026-11-20

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`388565c`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)）。

## 今天能用到哪

- 治理系统按 v4 状态模型运行：会话容器 + 焦点 + 段；`governance/data/state.json` 只经 `npm run state` 写
  （文件锁、原子写、`.work/state-history/` 备份、`history.json` 归档）。
- 治理台是三栏只读页：左边全部会话（点一行切换），中间焦点会话（大编号当前段、完成度细线、范围、
  段骨架、讨论记录与待裁），右边计数、「下一步 · 你/agent」一句人话（命令收进「agent 会执行什么」）、
  全部切换记录与时钟；证据点条目行内展开，没有悬浮提示；`J`/`K` 切段，`T` 或左下角按钮切明暗；
  动态按会话真实活动分 `live`/`idle`/`standby` 三档。
- 占位符一律过不了门：`passHumanAcceptance`、`signScope`、`completeTask`、`setAcceptance`、`resolveFinding`
  都拒绝「你的原话」「可以收口」「…」这类文本；`nextAction` 的模板命令本身就是显式占位（`'‹用户的签收原话›'`）。
- Noema 桌面端 0.7.6 可安装、可运行；Windows 安装包未签名；macOS/Linux 未做真机验收。

## 最后一次验证（2026-11-20，治理台：三栏控制台）

**改了什么**：按用户反馈（悬浮提示被遮、命令不该给人敲、内容太少、动效感觉不到）重做页面结构。

- 三栏：左「会话」全部可点切换；中「焦点」= 大编号当前段 + 完成度细线 + 范围 + 段骨架 + 讨论记录；
  右「数据」= 段/任务/判据/未处置发现四个计数 + 「下一步 · 你/agent」+ 全部切换记录 + 时钟。
- 证据不再悬浮：点任务或判据行，证据在行内展开（`grid-template-rows` 动画），不遮挡任何条目。
- 命令不摆给人敲：页面显示「下一步 · 谁」和一句人话（`nextAction` 的 label/detail），
  命令本身收进「agent 会执行什么」折叠区。
- 空会话列表、讨论轮次、待裁、切换记录、明暗按钮都在页面上有位置；空日常段不再占一行。
- 动效按 `lastTouch` 分档：10 分钟内 `live`（心跳点、骨架流光、段点脉冲、时钟走动），
  否则 `idle`（慢呼吸），无焦点 `standby`；`prefers-reduced-motion` 全关。

**证据**：

- `node --test scripts/work-view.test.mjs` **10/10**（导航切换、`aria-current`、下一步人话与折叠命令、
  行内证据、`等你`/`未处置`、活动档、待机、讨论记录、主题按钮）。
- `node --test governance/core/state.test.mjs` **15/15**；`node --test scripts/quickstart.test.mjs` **2/2**。
- `npm run check`：见下方「最后一次全量」。
- 截图：`.work/review/v6-live.png`（执行中，1440）、`.work/review/v6-light.png`（浅色）、
  `.work/review/v6-narrow.png`（520）。

**未验证**：

- 真实走完一轮：本次里程碑自身在用；还没有在一个真实产品任务上从 `start` 走到 `close` 并由用户签收。
- 治理台是静态页（`.work/review/work-view.html`），未接 DSH 面板；不自动刷新。
- 会话 `/` 焦点为空时的页面文案只在样例数据上验过，未在真实空状态使用中观察。
- 记忆底座：状态化后原记忆决议被删除，记忆系统未启动；成员经历（0.7.x 已交付）暂不回流。
- 协作者 macOS 真机安装/启动：等协作者反馈；Linux 未安排。

## 最后一次全量

- `npm run check`：见 git log 最后一次提交的 CI `verify`。

## 更早的验证

- 2026-11-20（判定优先版）：`state` 15/15、`quickstart` 2/2、`work-view` 11/11、`npm run check` 901/901；
  提交 `388565c`，CI `44662119464` success。
- 2026-11-20（v4）：会话/焦点/段重构，`state` 14/14、`quickstart` 2/2、`work-view` 6/6；提交 `5e8993f`。
- 2026-11-20（v3）：状态数据加固、CLI `next/brief/json/verify/clean`、审阅台工作台；902/902、CI 四次 success。
- 2026-11-19（状态化治理）：删除条目与 OpenSpec，换成讨论/执行/验收三态；901/901，提交 `10f2b2f`。
- 2026-11-18（成员经历纵切）：成员删除/墓碑/恢复与归档只读；901/901，提交 `2dfa313`。
