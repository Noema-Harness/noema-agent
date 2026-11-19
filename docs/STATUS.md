# STATUS

Authority: 本文档只回答一个问题——按现有证据，今天这个版本能说到什么程度。内容是当前版本、最后一次验证的证据、未验证项与交付判断。
Update when: 每次交付、打包或验证结果变化。
Does not own: 产品行为与边界（见 [PRODUCT](PRODUCT.md)）；结构与代码实况（见 [ARCHITECTURE](ARCHITECTURE.md)）；命令、安装与诊断（见 [OPERATIONS](OPERATIONS.md)）；治理规则、状态机与门（见 [governance/README.md](../governance/README.md)）；正在做什么（`npm run state`）。

最后更新：2026-11-20

## 版本与基线

- 源码版本：`0.7.6`；当前源码基线：`7d18cafd0f56`。
- 便携构建在 `apps/desktop/out/Noema-win32-x64/Noema.exe`；安装包由 `npm run make:desktop` 产出（构建陷阱与回退见 [OPERATIONS](OPERATIONS.md)）。
- 未签名；Windows 安装，macOS/Linux 未做真机验收。

## 最后一次验证（2026-11-20，治理重构：状态驱动）

**改了什么**：治理从「条目/文档驱动」重做为「agent 状态驱动」——

- 状态只有三个：讨论 / 执行 / 验收；状态只描述「现在在做什么」，不携带授权；切换写日志，离开讨论自动归档会话，回讨论自动恢复并续编号。
- 唯一数据源 `governance/data/state.json`（v2）：范围（`work.scope`）、验收单元（2–5 个 `P1`）、任务（`P1-T1`）、验收项（`P1-A1`，层 D/C/R/H）与讨论会话（轮次、待裁）；只经 `npm run state` 写。
- 规则随状态注入：`npm run state` 打印当前状态的规则包（`governance/noema/workflow/*.md`）；检查项写 `gate:<id>`，必须对应 `scripts/governance.mjs` 登记的门。
- 门分三层：提交门（`.githooks/pre-commit`：文档自洽 + 改动路径播报 + 内核边界）、里程碑（`npm run check`，与 CI `verify` 同源）、人判断（范围理解、签收、优先级）。
- 验收四层：D 确定性检查、C 判据对照、R 审查发现（每条必须处置：已修/延期/接受+理由）、H 人签收；通过 = D+C+H 全绿 + R 全处置；只有用户能签收。
- 删除：`docs/DECISIONS.md`、`governance/data/decisions.json`、整个 `openspec/`、条目/计划/过渡/接口等旧机制（`governance/core/*` 与 `scripts/*` 中约 20 个文件）。
- 重写：`AGENTS.md`、`governance/README.md`、`governance/core/README.md`、`governance/noema/maintenance.md`、`CONTRIBUTING.md`、`docs/OPERATIONS.md`、两份技能；治理图按新架构重画。

**证据**：

- `npm run state:test` **18/18**（状态机、范围、验收单元、任务、D/C/R/H、R 未处置拒绝完成阶段与签收、延期/接受需理由、会话归档与续编号、v1→v2 升级）。
- `node --test scripts/maintenance.test.mjs` **5/5**（治理词提示、内核边界、改动路径、文档登记与文档头、precommit 播报）。
- `npm run docs:check` OK；`npm run skill:install` 两条 OK（`0296264ec27a` / `b674f74badda`）。
- 治理图：`node scripts/figure.mjs build governance --sections-changed …`，source `9409b09a5e91`（html 849,513 / png 156,685）。
- `npm run check`：**901/901 通过、0 fail**（39,186ms），`governance: milestone OK`。

**未验证**：

- 真实走完一轮「讨论 → 执行 → 验收」：目前只有合成状态与测试数据演练；产品行为还没有在一个真实任务上跑过。
- 工作台是静态页（`npm run work:view` → `.work/review/work-view.html`），未接 DSH 面板。
- 记忆底座：状态化后原 `D-20261117-agent-memory` 决议被删除，记忆系统未启动；成员经历（0.7.x 已交付）暂不回流。
- 协作者 macOS 真机安装/启动：等协作者反馈；Linux 未安排。

## 更早验证（摘要）

- 2026-11-17：成员经历可查看/删除/恢复交付（`2dfa313`）；901/901、CI `44064152624` success；界面真机手测未做（本机 Electron 无法建窗）。
- 2026-11-17：0.1.5 安装版交付（状态化前），Windows 安装/升级/回滚验证通过；未签名。
- 2026-11-18～19：治理条目、存储分离、状态生命周期三批重构（`governance-*` changes，均已归档）；条目机制已在 2026-11-20 的激进重构中删除。