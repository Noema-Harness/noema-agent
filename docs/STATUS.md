# STATUS

Authority: 今天能用到哪、验过什么、还差什么的唯一出处。产品定位在 PRODUCT，结构在 ARCHITECTURE，命令在 OPERATIONS，治理规则在 governance/。
Update when: 一次交付或一次验证改变了可观察能力、证据或未验证项。
Does not own: 产品定位（PRODUCT）、结构与边界（ARCHITECTURE）、命令与失败修法（OPERATIONS）、治理规则（governance/）。

最后更新：2026-11-21

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`388565c`（v5 提交后更新）。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)）。

## 今天能用到哪

- 治理系统按 v5 模型运行：**会话 + 状态 + 任务 + 发现 + 签收**。任务带「做完的标准」与证据，
  阶段只是任务上的可选字段；审查在阶段完成与整体完成两处发生，任务书由系统生成；发现可派生修复任务；
  签收只认用户原话。`governance/data/state.json` 只经 `npm run state` 写
  （文件锁、原子写、`.work/state-history/` 备份、`history.json` 归档）。
- 治理台是只读页：顶部会话标签，左边任务清单（按阶段分组、标准与证据）与审查发现，
  右边计数与「下一步 · 谁」一句人话（命令收进「agent 会执行什么」）；讨论态另列轮次与待裁；
  证据行内展开，没有悬浮提示；`T` 切明暗。
- 占位符一律过不了门：任务证据、发现处置、签收都拒绝「你的原话」「可以收口」「…」「‹…›」
  这类文本；`nextAction` 的模板命令本身就是显式占位（`'‹跑过的命令或看到的输出›'`、`'‹用户的签收原话›'`）。
- Noema 桌面端 0.7.6 可安装、可运行；Windows 安装包未签名；macOS/Linux 未做真机验收。

## 最后一次验证（2026-11-21，治理模型 v5：任务、发现与签收）

**改了什么**：删掉段与 D/C/R/H 四层，把清单收成一层任务；审查收成两处触发、系统生成任务书；
发现只有一册、可派生修复任务；签收条件改为「任务全完成 + 无未处置发现 + 用户原话」。

**证据**：

- `node --test governance/core/state.test.mjs` **16/16**（会话开关、任务标准与文本导入、证据与占位、
  段审查与总体审查、进验收门槛、发现处置与派生、签收门槛、nextAction 全链、讨论线程、退役版本）。
- `node --test scripts/quickstart.test.mjs` **2/2**（空白状态逐步跑通 README 的数十秒路径）。
- `node --test scripts/work-view.test.mjs` **9/9**（会话/状态/范围、任务标准与证据、发现 scope 与处置、
  下一步折叠命令、计数随数据变、空态引导、归档态、转义、默认浅色与主题按钮）。
- `npm run check`：901/901 通过、0 fail（50,724ms），`governance: milestone OK`。
- 截图：`.work/review/v10-light.png`（1280×900，执行中，任务按阶段分组）。

**未验证**：

- 真实走完一轮：本次里程碑自身在用；还没有在一个真实产品任务上从 `start` 走到 `close` 并由用户签收。
- 治理台是静态页（`.work/review/work-view.html`），未接 DSH 面板；不自动刷新。
- 界面方向仍待用户定（用户已明确此项要与模型分开讨论）。

## 最后一次全量

- `npm run check`：901/901 通过、0 fail（50,724ms），`governance: milestone OK`（2026-11-21，v5 落地）。

## 更早的验证

- 2026-11-20（三栏控制台）：`state` 15/15、`quickstart` 2/2、`work-view` 10/10；提交 `c041b5a`。
- 2026-11-20（判定优先版）：`state` 15/15、`quickstart` 2/2、`work-view` 11/11、`npm run check` 901/901；
  提交 `388565c`，CI `44662119464` success。
- 2026-11-20（v4）：会话/焦点/段重构，`state` 14/14、`quickstart` 2/2、`work-view` 6/6；提交 `5e8993f`。
- 2026-11-20（v3）：状态数据加固、CLI `next/brief/json/verify/clean`、审阅台工作台；902/902、CI 四次 success。
- 2026-11-19（状态化治理）：删除条目与 OpenSpec，换成讨论/执行/验收三态；901/901，提交 `10f2b2f`。
- 2026-11-18（成员经历纵切）：成员删除/墓碑/恢复与归档只读；901/901，提交 `2dfa313`。