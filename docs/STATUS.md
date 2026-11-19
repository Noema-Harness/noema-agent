# STATUS

Authority: 本文档只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理规则、状态机与门（见 [governance/README.md](../governance/README.md)）；正在做什么（`npm run state`）。

最后更新：2026-11-20

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`5982b56`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)）。
- 未签名；Windows 安装，macOS/Linux 未做真机验收。

## 最后一次验证（2026-11-20，治理 v4：会话、状态与段）

**改了什么**：治理从「一条全局工作线 + 阶段」改成「多个会话 + 焦点 + 段」——

- 会话是容器：一个会话是一个要交付的东西，可同时开多个、互不阻塞；`focus` 只是指针，没有在推进的交付物时为空。
  命令：`state -- start "…" [--discuss]`、`switch S2`、`sessions`、`close`（归档进 `governance/data/history.json`）。
- 状态只是会话的段落（讨论/执行/验收），默认执行；任意方向可切，只要求写理由。最小路径 `start → 执行 → close`。
- 段是会话内部的时间分片：日常琐事在当前段平铺加任务；大事才 `segment add --name "…"` 开命名段。
  只有命名段走 2–5 个验收单元与 D/C/R/H；日常段只要任务完成就能收尾，不再被流程绑死。
- 数据 v4（`governance/data/state.json`）：`{version:4, focus, sessions:[{id,title,status,state,scope,segments,threads,log}], log}`；
  写盘有锁、备份与原子替换；旧 v3 数据读入时自动升级（真实数据已升级为 S1 会话、5 段）。
- 提交门跟随焦点：`apps/desktop/src/` 的改动必须落在当前会话的范围里，否则拒绝提交。
- 工作台改成一张**会话桌面**（`npm run work:view`）：顶部状态大字与会话名/范围；左侧段轨（点一段切换）；
  中间当前段的任务（未完成在前、已完成折叠、悬停看证据）与命名段的 D/C/R/H 滑片（形状表示层，H 未判标「等你」、
  R 未处置标「未处置」）；底部签收线（还差几项、第一处缺口）与唯一「下一步」命令（点击复制）；明暗切换 `T`。
- 规则包按 v4 重写（`governance/noema/workflow/{discussion,execution,acceptance}.md`）；
  `governance/README.md`、`AGENTS.md`、`OPERATIONS.md` 同步；治理图重出（会话/段替换原「讨论会话/验收单元」）。

**证据**：

- `npm run check`：**901/901 通过、0 fail**（47,481ms），`governance: milestone OK`。
- `node --test governance/core/state.test.mjs` **14/14**（会话并存与切换、状态任意切换要理由、日常段平铺收尾、
  命名段四层验收、任务/判定证据、H 只能用户原话、R 必须处置、签收、`next`、v3→v4 升级）。
- `node --test scripts/quickstart.test.mjs` **2/2**（README 的 16 步在空白状态上跑通、空状态给第一条命令）。
- `node --test scripts/work-view.test.mjs` **6/6**（状态与范围、段轨与当前段、唯一命令可复制、证据在悬浮卡且转义、
  形状代替文字图例且 H 标「等你」、空白态引导）。
- `node --test scripts/maintenance.test.mjs` **6/6**（治理词提示、内核边界、产品代码必须有范围、文档登记与文档头、precommit 播报）。
- `npm run docs:check` OK（2 条治理词指针提示）；`npm run figure:check` OK（治理图 source `bb19ccda34c7`）。
- 截图核验：`.work/review/v4b-dark.png`（1280×1100，状态大字、段轨、P4 展开、H「等你」、右栏计数）。

**未验证**：

- 真实走完一轮：本次里程碑自身在用；还没有在一个真实产品任务上从 `start` 走到 `close` 并由用户签收。
- 工作台是静态页（`.work/review/work-view.html`），未接 DSH 面板；不自动刷新。
- 记忆底座：状态化后原记忆决议被删除，记忆系统未启动；成员经历（0.7.x 已交付）暂不回流。
- 协作者 macOS 真机安装/启动：等协作者反馈；Linux 未安排。

## 更早验证（摘要）

- 2026-11-20（v3）：状态数据加固、CLI `next/brief/json/verify/clean`、审阅台工作台；902/902、CI 四次 success。
- 2026-11-17：成员经历可查看/删除/恢复交付（`2dfa313`）；901/901、CI `44064152624` success；界面真机手测未做（本机 Electron 无法建窗）。
- 2026-11-17：0.1.5 安装版交付（状态化前），Windows 安装/升级/回滚验证通过；未签名。
- 2026-11-18～19：治理条目、存储分离、状态生命周期三批重构（`governance-*` changes，均已归档）；条目机制已在 2026-11-20 的激进重构中删除。