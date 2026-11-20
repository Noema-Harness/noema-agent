# STATUS

Authority: 本文档只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理规则、状态机与门（见 [governance/README.md](../governance/README.md)）；正在做什么（`npm run state`）。

最后更新：2026-11-20

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`5e8993f`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)）。
- 未签名；Windows 安装，macOS/Linux 未做真机验收。

## 最后一次验证（2026-11-20，治理台：判定优先 + 占位符不许过门）

**改了什么**：治理台从「状态的仪表盘」改成「一屏一个决定」，并堵住页面替人签字的漏洞——

- 判定只有一个来源：`verdictOf` 直接消费 `nextAction(doc)`（label 作判定句、detail 作说明、command 作唯一命令），
  页面不再自己排序缺口；顺序与 `signScope` 一致（任务 → D/C → 发现 → H → 收段 → 进验收 → 签收）。
- 占位符一律被机制拒绝：`PLACEHOLDER_WORDS` 命中「你的原话」「可以收口」「…」「‹…›」等即报错，
  `passHumanAcceptance`、`signScope`、`completeTask`、`setAcceptance`、`resolveFinding` 全部设防；
  `nextAction` 的模板命令改成显式占位（`'‹用户的签收原话›'`、`'‹跑过的命令或看到的输出›'`），照抄就过不了校验。
- `sessionProgress` 增加 `openFindings`，「发现」计数不再恒为 0。
- 版面：默认浅色纸、暗色可选；`body` flex 收口、页脚贴底；门行改为流式（无固定列、正文 72ch、状态 13px）；
  首屏加「这一轮交付」；段头是按钮（`aria-expanded` / `aria-controls`，Space/Enter 可展开）；
  页脚「N 分钟前生成」每 30 秒重算，数据仍是快照。
- 五套示例数据（`.work/review/ds-{busy,ready,discuss,daily,empty}/`）覆盖执行/待签收/讨论/日常平铺/空焦点，
  三路复审（范式、视觉、交互）在其上重新巡览并给出 P0/P1。

**证据**：

- `node --test governance/core/state.test.mjs` **15/15**（含占位符拒绝：H 原话、`‹…›`、验收证据、任务证据）。
- `node --test scripts/quickstart.test.mjs` **2/2**。
- `node --test scripts/work-view.test.mjs` **11/11**（判定来自 `nextAction`；任务缺口优先；settled 后请用户签收→收段→进验收；
  范围上屏；`openFindings` 计数；唯一命令可复制；只有焦点会话 alive；空自动段不显示；无会话给 `start`；转义；H 原话）。
- `npm run check`：见下方「最后一次全量」。
- 截图：`.work/review/ds-busy/wide.png`、`ds-ready`、`ds-discuss`、`ds-daily`、`ds-empty`，各有 1440×1000 与 520×1400。

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
