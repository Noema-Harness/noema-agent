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
- 治理台为版本②「一个焦点 + 一条骨架」，已移植到 v4：大编号当前段、完成度细线、范围一行、
  唯一「下一步」命令（`nextAction`，点击复制）、纵向骨架（当前段摊开任务与 D/C/R/H 四行，证据悬停出现）、
  `J`/`K` 移动、`T` 切明暗。
- 占位符一律过不了门：`passHumanAcceptance`、`signScope`、`completeTask`、`setAcceptance`、`resolveFinding`
  都拒绝「你的原话」「可以收口」「…」这类文本；`nextAction` 的模板命令本身就是显式占位（`'‹用户的签收原话›'`）。
- Noema 桌面端 0.7.6 可安装、可运行；Windows 安装包未签名；macOS/Linux 未做真机验收。

## 最后一次验证（2026-11-20，治理台冻结为版本②并移植到 v4）

**改了什么**：按用户选择把治理台固定为「一个焦点 + 一条骨架」这一版，并把它的数据口径从 v3 换成 v4；
其余几版（仪器台、审阅台、判定优先）不再维护。

- `scripts/work-view.mjs` 以 `d67996e` 的版本为底，改读 `focusSession` / `sessionProgress` / `session.segments`，
  页脚、命令摘要同步 v4；空焦点与无段时不崩（大编号显示 `01`、引导 `npm run state -- start`）。
- `scripts/work-view.test.mjs` 重写 7 条：焦点编号与段名、唯一 `nextAction` 命令、骨架列出全部段（当前展开、
  已完成打勾、`2/3` 计数）、层用形状且证据在 `.ev`、范围转义、空状态给 `start`、讨论态保留待裁。
- `governance/README.md`、`AGENTS.md` 的治理台描述改为这版结构。

**证据**：

- `node --test scripts/work-view.test.mjs` **7/7**。
- `node --test governance/core/state.test.mjs` **15/15**。
- `node --test scripts/quickstart.test.mjs` **2/2**。
- `npm run check`：见下方「最后一次全量」。
- 截图：`.work/review/spine-original.png`（原页复原，v3 快照）、`.work/review/spine-v4.png`（移植后，当前数据）。

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
