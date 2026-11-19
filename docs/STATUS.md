# STATUS

Authority: 本文档只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理规则、状态机与门（见 [governance/README.md](../governance/README.md)）；正在做什么（`npm run state`）。

最后更新：2026-11-20

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`10f2b2f`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)）。
- 未签名；Windows 安装，macOS/Linux 未做真机验收。

## 最后一次验证（2026-11-20，治理 v3 与可交付工作台）

**改了什么**：状态数据与工作台从「能跑」推进到「可直接用」——

- 状态数据 v3（`governance/data/state.json`，版本 3）：范围分「里程碑/修复」；阶段三态（未开始/进行中/已完成）；
  任务完成与验收判定都必须带证据；R 层不判通过、只处置发现；签收要求 D/C/H 全绿且 R 全处置；
  写盘有锁（`.work/locks/`）、备份（`.work/state-history/` 最近 20 份）与原子替换；归档写 `governance/data/history.json`。
- CLI 补齐：`state -- next`（下一步与命令）、`brief`（交接卡）、`json`（机器读）、`verify`（自检）、
  `clean`（归档已签收的工作）、`phase start`、`scope --kind`；未知命令按提示退出。
- 行为门绑定状态：提交门对 `apps/desktop/src/` 的改动要求先有 `work.scope`（小修可用 `--kind 修复`），
  没有范围就拒绝提交。
- 工作台重做（`npm run work:view`）：先修掉「看不到状态」这个主次错误——顶部恢复三态状态条与会话语；
  再把页面从「一个大标题＋文本列表」改成一台仪器：
  - 顶部状态条（讨论/执行/验收，当前态高亮）＋会话（轮次/待裁/单元进度）。
  - 一行范围，决定这一轮按什么验收。
  - 验收单元是同构行：任务用格子填充、四层判据用形状（▢ D · ○ C · ◇ R · △ H）着色；
    当前单元加高并带左侧琥珀线，未开始单元降噪。点行展开细节、数字键跳单元、悬停看证据。
  - 底部只有一条「下一步」命令（点击复制）与状态切换刻度线；删掉进度环、统计面板、图例与近期动态。
- 验收判据去掉了时间指标：H 项从「15 秒内判断当前在做什么」改为「打开就能说出当前状态与下一步，不用读说明」；
  `state -- accept text` 只改判据措辞，不动判定与证据。
- 演练数据整理：上一轮 v2 演练归档进 `history.json`（`legacy-demo`），删掉过期模板
  `governance/noema/workflow/transition/`；当前 `state.json` 是一条真实里程碑（范围、5 个验收单元、7 任务、12 验收项）。
- 可直接上手（`b11bca3`）：`governance/README.md` 的「第一次使用」16 步由 `scripts/quickstart.test.mjs`
  在空白状态上逐步跑通并挂进 `tools:test`；`clean` 归档后把状态带回讨论，不留「验收态空工作区」。

**证据**：

- `npm run check`：**902/902 通过、0 fail**（43,666ms），`governance: milestone OK`（workspace/branches/docs/figure/source/lint/typecheck/tools/test 全绿）。
- `node --test governance/core/state.test.mjs` **23/23**（v2→v3 升级、证据规则、R 处置、H 只能由用户原话判、签收、归档、`next` 全链路）。
- `node --test scripts/maintenance.test.mjs` **6/6**（治理词提示、内核边界、产品代码必须有范围、文档登记与文档头、precommit 播报）。
- `node --test scripts/work-view.test.mjs` **6/6**（状态条在当前态、单元行与当前行、唯一 action、默认折叠、层用形状、空白状态引导）。
- `node --test scripts/quickstart.test.mjs` **2/2**（README 16 步跑通、空状态 `next`/`verify` 可用）。
- `npm run docs:check` OK；`npm run figure:check` OK（治理图 source `88b91a268b38`）。
- 截图核验（`--force-prefers-reduced-motion` 下抓取，避免动画首帧）：`.work/review/board-dark.png`、`board-light.png`（1280px）、`board-narrow.png`（520px）。
- CI：`44611231148`、`44613973625`、`44614559086`、`44616782475` 均 `verify` success。

**未验证**：

- 真实走完一轮「讨论 → 执行 → 验收 → 签收 → 归档」：只有合成状态与本次里程碑自身在用；尚未在一个真实产品任务上跑完并由用户签收。
- 工作台是静态页（`.work/review/work-view.html`），未接 DSH 面板；不自动刷新。
- 记忆底座：状态化后原记忆决议被删除，记忆系统未启动；成员经历（0.7.x 已交付）暂不回流。
- 协作者 macOS 真机安装/启动：等协作者反馈；Linux 未安排。

## 更早验证（摘要）

- 2026-11-17：成员经历可查看/删除/恢复交付（`2dfa313`）；901/901、CI `44064152624` success；界面真机手测未做（本机 Electron 无法建窗）。
- 2026-11-17：0.1.5 安装版交付（状态化前），Windows 安装/升级/回滚验证通过；未签名。
- 2026-11-18～19：治理条目、存储分离、状态生命周期三批重构（`governance-*` changes，均已归档）；条目机制已在 2026-11-20 的激进重构中删除。
